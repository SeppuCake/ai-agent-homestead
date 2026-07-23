import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexBridge } from "./codex-bridge.mjs";
import { HomesteadStore } from "./homestead-store.mjs";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const distDirectory = join(rootDirectory, "dist");
const host = process.env.HOMESTEAD_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "4174", 10);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROMPT_LENGTH = 4000;
const clients = new Set();
const store = new HomesteadStore(rootDirectory);
await store.initialize();

let bridgeMode = "connecting";
let bridgeMessage = "Starting local Codex bridge…";
let currentAgent = {
	status: "idle",
	message: "Enjoying a quiet café break.",
	agentId: null,
	agentName: "Mosin",
	stage: "chat",
};
let workflowActive = null;

const contentTypes = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
};

function writeJson(response, statusCode, payload) {
	response.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(JSON.stringify(payload));
}

function writeSse(response, event) {
	response.write(`event: homestead\ndata: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event) {
	for (const client of clients) {
		writeSse(client, event);
	}
}

function setConnection(mode, message) {
	bridgeMode = mode;
	bridgeMessage = message;
	broadcast({ type: "connection", mode, message });
}

function setAgent(status, message, context = {}) {
	currentAgent = {
		status,
		message,
		agentId: context?.agentId ?? currentAgent.agentId,
		agentName: context?.agentName ?? currentAgent.agentName,
		stage: context?.stage ?? currentAgent.stage,
	};
	broadcast({ type: "activity", ...currentAgent });
}

function log(message, kind = "info", context = {}) {
	broadcast({
		type: "log",
		message,
		kind,
		sessionId: context?.sessionId ?? null,
		agentId: context?.agentId ?? null,
		agentName: context?.agentName ?? null,
		stage: context?.stage ?? null,
	});
}

const bridge = new CodexBridge({
	rootDirectory,
	store,
	broadcast,
	setConnection,
	setAgent,
	log,
});

function readBody(request) {
	return new Promise((resolveBody, rejectBody) => {
		let bytes = 0;
		let body = "";

		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			bytes += Buffer.byteLength(chunk);
			if (bytes > MAX_BODY_BYTES) {
				rejectBody(new Error("Request body is too large"));
				request.destroy();
				return;
			}
			body += chunk;
		});
		request.on("end", () => resolveBody(body));
		request.on("error", rejectBody);
	});
}

async function readJsonBody(request) {
	const raw = await readBody(request);
	try {
		return JSON.parse(raw || "{}");
	} catch {
		throw new Error("Request body must be valid JSON");
	}
}

function validatePrompt(payload) {
	const prompt =
		typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
	if (prompt.length < 3 || prompt.length > MAX_PROMPT_LENGTH) {
		throw new Error(
			`Prompt must be between 3 and ${MAX_PROMPT_LENGTH} characters`,
		);
	}
	return prompt;
}

function requireSession(sessionId) {
	const session = store.getSessionRecord(sessionId);
	if (!session) {
		throw new Error("Session not found");
	}
	return session;
}

function resolveSessionAgent(session, requestedAgentId) {
	const agentId =
		requestedAgentId && session.agentIds.includes(requestedAgentId)
			? requestedAgentId
			: session.leadAgentId;
	const agent = store.getAgent(agentId);
	if (!agent) {
		throw new Error("Session agent not found");
	}
	return agent;
}

function clipped(value) {
	return String(value ?? "").slice(0, 12_000);
}

async function executeChat(sessionId, prompt, requestedAgentId) {
	const session = requireSession(sessionId);
	const agent = resolveSessionAgent(session, requestedAgentId);
	const project = store.getProject(session.projectId);
	if (!project) {
		throw new Error("Session project not found");
	}

	const userMessage = await store.addMessage(session.id, {
		role: "user",
		text: prompt,
		kind: "chat",
	});
	broadcast({ type: "session-message", sessionId: session.id, message: userMessage });

	try {
		const result = await bridge.runTurn({
			session,
			agent,
			project,
			prompt,
			permission: session.permission,
			stage: "chat",
		});
		const message = await store.addMessage(session.id, {
			role: "assistant",
			agentId: agent.id,
			text: result,
			kind: "chat",
		});
		broadcast({ type: "session-message", sessionId: session.id, message });
		setAgent("idle", `${agent.name} is ready for the next message.`, {
			agentId: agent.id,
			agentName: agent.name,
			stage: "chat",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Chat task failed";
		await store.addMessage(session.id, {
			role: "assistant",
			agentId: agent.id,
			text: `Task failed: ${message}`,
			kind: "error",
		});
		log(message, "error", {
			sessionId: session.id,
			agentId: agent.id,
			agentName: agent.name,
			stage: "chat",
		});
		setAgent("waiting", `${agent.name} could not complete the message.`, {
			agentId: agent.id,
			agentName: agent.name,
			stage: "chat",
		});
	}
}

function findStageAgent(agents, role, fallbackIndex, leadAgent) {
	return (
		agents.find((agent) => agent.role === role) ??
		agents[fallbackIndex] ??
		leadAgent
	);
}

async function runWorkflow(sessionId, prompt) {
	const session = requireSession(sessionId);
	const project = store.getProject(session.projectId);
	const agents = session.agentIds
		.map((agentId) => store.getAgent(agentId))
		.filter(Boolean);
	const leadAgent =
		agents.find((agent) => agent.id === session.leadAgentId) ?? agents[0];

	if (!project || !leadAgent || agents.length === 0) {
		throw new Error("Workflow requires a project and at least one agent");
	}

	const planner = findStageAgent(agents, "coordinator", 0, leadAgent);
	const builder = findStageAgent(agents, "builder", 1, leadAgent);
	const tester = findStageAgent(agents, "tester", 2, leadAgent);
	const presenter = findStageAgent(agents, "presenter", 0, leadAgent);
	const run = await store.createWorkflowRun(session.id, prompt);
	workflowActive = { sessionId: session.id, runId: run.id };

	const userMessage = await store.addMessage(session.id, {
		role: "user",
		text: prompt,
		kind: "workflow",
		stage: "brief",
	});
	broadcast({ type: "session-message", sessionId: session.id, message: userMessage });
	broadcast({
		type: "workflow",
		action: "started",
		sessionId: session.id,
		runId: run.id,
		stage: "plan",
	});

	const outputs = {};
	const stages = [
		{
			name: "plan",
			agent: planner,
			permission: "read-only",
			prompt: () =>
				[
					"Create an implementation plan for the following user request.",
					`USER REQUEST:\n${prompt}`,
					"Inspect the project as needed. Return a concrete staged plan with requirements, risks, file areas, acceptance checks, and task assignments for builder and tester. Do not edit files in this stage.",
				].join("\n\n"),
		},
		{
			name: "build",
			agent: builder,
			permission: session.permission,
			prompt: () =>
				[
					"Carry out the approved in-scope implementation task.",
					`USER REQUEST:\n${prompt}`,
					`PLANNER OUTPUT:\n${clipped(outputs.plan)}`,
					session.permission === "workspace-write"
						? "Implement the plan in the local project and run narrow checks as you work."
						: "This is read-only mode. Produce a precise implementation proposal and patch outline without changing files.",
					"Report changed files or proposed files, important decisions, and what the tester must verify.",
				].join("\n\n"),
		},
		{
			name: "test",
			agent: tester,
			permission: session.permission,
			prompt: () =>
				[
					"Verify the work independently.",
					`USER REQUEST:\n${prompt}`,
					`PLAN:\n${clipped(outputs.plan)}`,
					`BUILDER REPORT:\n${clipped(outputs.build)}`,
					session.permission === "workspace-write"
						? "Inspect the actual diff and run relevant non-destructive typecheck, tests, build, and focused runtime checks. Fix only small in-scope defects if necessary."
						: "Review the proposal for correctness, missing requirements, regressions, and verification gaps.",
					"Return pass/fail evidence and list any remaining blocker.",
				].join("\n\n"),
		},
		{
			name: "deliver",
			agent: presenter,
			permission: "read-only",
			prompt: () =>
				[
					"Prepare the final delivery for the user.",
					`USER REQUEST:\n${prompt}`,
					`PLAN:\n${clipped(outputs.plan)}`,
					`BUILDER REPORT:\n${clipped(outputs.build)}`,
					`TEST REPORT:\n${clipped(outputs.test)}`,
					"Lead with the outcome. Summarize what is complete, cite the verification evidence, name any remaining limitation, and give the next action.",
					"Do not publish or deploy externally. If deployment was requested, report the locally prepared deployment state and the exact confirmation still required for an external release.",
				].join("\n\n"),
		},
	];

	try {
		for (const stage of stages) {
			await store.updateWorkflowRun(session.id, run.id, {
				stage: stage.name,
				status: "running",
			});
			broadcast({
				type: "workflow",
				action: "stage-started",
				sessionId: session.id,
				runId: run.id,
				stage: stage.name,
				agentId: stage.agent.id,
				agentName: stage.agent.name,
			});

			const result = await bridge.runTurn({
				session,
				agent: stage.agent,
				project,
				prompt: stage.prompt(),
				permission: stage.permission,
				stage: stage.name,
			});
			outputs[stage.name] = result;
			const message = await store.addMessage(session.id, {
				role: "assistant",
				agentId: stage.agent.id,
				text: result,
				kind: "workflow-stage",
				stage: stage.name,
			});
			await store.updateWorkflowRun(session.id, run.id, {
				outputs,
				stage: stage.name,
			});
			broadcast({ type: "session-message", sessionId: session.id, message });
			broadcast({
				type: "workflow",
				action: "stage-completed",
				sessionId: session.id,
				runId: run.id,
				stage: stage.name,
				agentId: stage.agent.id,
				agentName: stage.agent.name,
			});
		}

		await store.updateWorkflowRun(session.id, run.id, {
			status: "completed",
			stage: "done",
			outputs,
		});
		broadcast({
			type: "workflow",
			action: "completed",
			sessionId: session.id,
			runId: run.id,
			stage: "done",
		});
		setAgent("idle", "The agent team completed the workflow.", {
			agentId: presenter.id,
			agentName: presenter.name,
			stage: "done",
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Workflow execution failed";
		await store.updateWorkflowRun(session.id, run.id, {
			status: "failed",
			error: message,
			outputs,
		});
		broadcast({
			type: "workflow",
			action: "failed",
			sessionId: session.id,
			runId: run.id,
			error: message,
		});
		log(message, "error", { sessionId: session.id, stage: "workflow" });
	} finally {
		workflowActive = null;
	}
}

function serveStatic(request, response) {
	const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
	const pathname = decodeURIComponent(requestUrl.pathname);
	const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
	let filePath = resolve(distDirectory, relativePath);

	if (!filePath.startsWith(resolve(distDirectory))) {
		writeJson(response, 403, { error: "Forbidden" });
		return;
	}

	if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
		filePath = join(distDirectory, "index.html");
	}

	if (!existsSync(filePath)) {
		writeJson(response, 503, {
			error: "Dashboard build is missing. Run npm run build first.",
		});
		return;
	}

	const extension = extname(filePath).toLowerCase();
	response.writeHead(200, {
		"Content-Type": contentTypes[extension] ?? "application/octet-stream",
		"Cache-Control":
			extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
		"Content-Security-Policy":
			"default-src 'self'; connect-src 'self' https://api.openai.com; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	});

	if (request.method === "HEAD") {
		response.end();
		return;
	}
	createReadStream(filePath).pipe(response);
}

function routeMatch(pathname, pattern) {
	const match = pathname.match(pattern);
	return match ? match.slice(1).map(decodeURIComponent) : null;
}

function errorStatus(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("not found")) {
		return 404;
	}
	if (message.includes("already working") || message.includes("already running")) {
		return 409;
	}
	if (
		message.includes("must be") ||
		message.includes("requires") ||
		message.includes("valid")
	) {
		return 400;
	}
	return 503;
}

const server = createServer(async (request, response) => {
	const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
	const pathname = requestUrl.pathname;

	try {
		if (request.method === "GET" && pathname === "/api/health") {
			writeJson(response, 200, { ok: true, mode: bridgeMode });
			return;
		}

		if (request.method === "GET" && pathname === "/api/status") {
			writeJson(response, 200, {
				mode: bridgeMode,
				message: bridgeMessage,
				agent: currentAgent,
				busy: bridge.isBusy() || Boolean(workflowActive),
				workflow: workflowActive,
			});
			return;
		}

		if (request.method === "GET" && pathname === "/api/bootstrap") {
			writeJson(response, 200, {
				...store.snapshot(),
				catalog: bridge.catalog,
				bridge: bridge.status(),
			});
			return;
		}

		if (request.method === "POST" && pathname === "/api/catalog/refresh") {
			const catalog = await bridge.refreshCatalog();
			writeJson(response, 200, catalog);
			return;
		}

		if (request.method === "GET" && pathname === "/api/events") {
			response.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			response.write(": connected\n\n");
			clients.add(response);
			writeSse(response, {
				type: "connection",
				mode: bridgeMode,
				message: bridgeMessage,
			});
			writeSse(response, { type: "activity", ...currentAgent });
			const keepAlive = setInterval(
				() => response.write(": keepalive\n\n"),
				20_000,
			);
			request.on("close", () => {
				clearInterval(keepAlive);
				clients.delete(response);
			});
			return;
		}

		if (request.method === "POST" && pathname === "/api/projects") {
			const payload = await readJsonBody(request);
			const projectPath = String(payload?.path ?? "").trim();
			if (!isAbsolute(projectPath) || !existsSync(projectPath)) {
				throw new Error("Project path must be an existing absolute directory");
			}
			if (!statSync(projectPath).isDirectory()) {
				throw new Error("Project path must be a directory");
			}
			const project = await store.createProject({
				name: payload?.name,
				path: resolve(projectPath),
			});
			const session = await store.createSession({
				projectId: project.id,
				title: `${project.name} Chat`,
				mode: "chat",
			});
			writeJson(response, 201, { project, session });
			return;
		}

		if (request.method === "POST" && pathname === "/api/sessions") {
			const payload = await readJsonBody(request);
			const session = await store.createSession(payload);
			writeJson(response, 201, session);
			return;
		}

		const sessionMatch = routeMatch(pathname, /^\/api\/sessions\/([^/]+)$/);
		if (sessionMatch && request.method === "GET") {
			const session = store.getSession(sessionMatch[0]);
			if (!session) {
				throw new Error("Session not found");
			}
			writeJson(response, 200, session);
			return;
		}
		if (sessionMatch && request.method === "PATCH") {
			const payload = await readJsonBody(request);
			const session = await store.updateSession(sessionMatch[0], payload);
			writeJson(response, 200, session);
			return;
		}

		const messageMatch = routeMatch(
			pathname,
			/^\/api\/sessions\/([^/]+)\/messages$/,
		);
		if (messageMatch && request.method === "POST") {
			if (bridge.isBusy() || workflowActive) {
				throw new Error("Another agent task is already running");
			}
			const payload = await readJsonBody(request);
			const prompt = validatePrompt(payload);
			const session = requireSession(messageMatch[0]);
			if (payload?.permission || payload?.agentIds || payload?.leadAgentId) {
				await store.updateSession(session.id, payload);
			}
			void executeChat(session.id, prompt, payload?.agentId);
			writeJson(response, 202, { accepted: true, sessionId: session.id });
			return;
		}

		const workflowMatch = routeMatch(
			pathname,
			/^\/api\/sessions\/([^/]+)\/workflow$/,
		);
		if (workflowMatch && request.method === "POST") {
			if (bridge.isBusy() || workflowActive) {
				throw new Error("Another agent workflow is already running");
			}
			const payload = await readJsonBody(request);
			const prompt = validatePrompt(payload);
			const session = requireSession(workflowMatch[0]);
			if (payload?.permission || payload?.agentIds || payload?.leadAgentId) {
				await store.updateSession(session.id, payload);
			}
			void runWorkflow(session.id, prompt);
			writeJson(response, 202, { accepted: true, sessionId: session.id });
			return;
		}

		if (request.method === "POST" && pathname === "/api/agents") {
			const payload = await readJsonBody(request);
			const agent = await store.createAgent(payload);
			broadcast({ type: "agents-changed", agents: store.snapshot().agents });
			writeJson(response, 201, agent);
			return;
		}

		const agentMatch = routeMatch(pathname, /^\/api\/agents\/([^/]+)$/);
		if (agentMatch && request.method === "PATCH") {
			const payload = await readJsonBody(request);
			const agent = await store.updateAgent(agentMatch[0], payload);
			broadcast({ type: "agents-changed", agents: store.snapshot().agents });
			writeJson(response, 200, agent);
			return;
		}
		if (agentMatch && request.method === "DELETE") {
			await store.deleteAgent(agentMatch[0]);
			broadcast({ type: "agents-changed", agents: store.snapshot().agents });
			writeJson(response, 200, { deleted: true });
			return;
		}

		if (request.method === "POST" && pathname === "/api/tasks") {
			if (bridge.isBusy() || workflowActive) {
				throw new Error("Another agent task is already running");
			}
			const payload = await readJsonBody(request);
			const prompt = validatePrompt(payload);
			const fallbackSessionId =
				store.state.settings.activeSessionId ?? store.state.sessions[0]?.id;
			if (!fallbackSessionId) {
				throw new Error("Session not found");
			}
			void executeChat(fallbackSessionId, prompt, payload?.agentId);
			writeJson(response, 202, {
				accepted: true,
				sessionId: fallbackSessionId,
			});
			return;
		}

		if (request.method === "GET" || request.method === "HEAD") {
			serveStatic(request, response);
			return;
		}

		writeJson(response, 404, { error: "Not found" });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unexpected server error";
		writeJson(response, errorStatus(error), { error: message });
	}
});

server.listen(port, host, () => {
	console.log(`Agent Homestead Studio: http://${host}:${port}`);
	console.log("Storage: local .agent-homestead/state.json");
	console.log("Codex: persistent threads with explicit workspace permissions");
	bridge.start();
});

function shutdown() {
	bridge.stop();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
