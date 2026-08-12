import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, win32 as windowsPath } from "node:path";
import { createInterface } from "node:readline";

const API_DEFAULT_MODEL = "gpt-5.6-terra";
const APPROVAL_METHODS = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
	"item/permissions/requestApproval",
]);
const APPROVAL_DECISIONS = new Set([
	"accept",
	"acceptForSession",
	"decline",
	"cancel",
]);

function clampContext(value, maximum = 14_000) {
	return String(value ?? "").slice(0, maximum);
}

// Thread methods use the legacy scalar enum; turn methods use the tagged v2 policy.
function codexThreadSandbox(permission) {
	return permission === "workspace-write" ? "workspace-write" : "read-only";
}

function codexTurnSandboxPolicy(permission, projectPath) {
	if (permission === "workspace-write") {
		return {
			type: "workspaceWrite",
			writableRoots: [projectPath],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		};
	}

	return { type: "readOnly", networkAccess: false };
}

function approvalKind(method) {
	if (method.includes("commandExecution")) {
		return "command";
	}
	if (method.includes("fileChange")) {
		return "file-change";
	}
	return "permissions";
}

function approvalSummary(method, params = {}) {
	return {
		kind: approvalKind(method),
		threadId: params.threadId ?? null,
		turnId: params.turnId ?? null,
		itemId: params.itemId ?? null,
		reason: clampContext(params.reason, 2_000),
		command: clampContext(params.command, 8_000),
		cwd: clampContext(params.cwd, 1_000),
		grantRoot: clampContext(params.grantRoot, 1_000),
		permissions: params.permissions ?? params.additionalPermissions ?? null,
		availableDecisions: Array.isArray(params.availableDecisions)
			? params.availableDecisions.filter(
					(decision) => typeof decision === "string",
				)
			: null,
	};
}

function managedCodexCandidates() {
	if (process.platform !== "win32") {
		return [];
	}

	const localAppData =
		process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
	const binRoot = join(localAppData, "OpenAI", "Codex", "bin");

	try {
		return readdirSync(binRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => {
				const executable = join(binRoot, entry.name, "codex.exe");
				let modifiedAt = 0;
				try {
					modifiedAt = statSync(executable).mtimeMs;
				} catch {
					// The resolver will ignore missing or incomplete runtime directories.
				}
				return { executable, modifiedAt };
			})
			.sort((left, right) => right.modifiedAt - left.modifiedAt)
			.map(({ executable }) => executable);
	} catch {
		return [];
	}
}

function codexCandidates() {
	return [...new Set([
		process.env.CODEX_CLI_PATH,
		...managedCodexCandidates(),
		process.platform === "win32"
			? join(homedir(), ".codex", "plugins", ".plugin-appserver", "codex.exe")
			: null,
		process.platform === "win32"
			? join(homedir(), ".codex", ".sandbox-bin", "codex.exe")
			: null,
		"codex",
	].filter(Boolean))];
}

export function resolveCodexExecutable(
	candidates = codexCandidates(),
	{ platform = process.platform, pathExists = existsSync } = {},
) {
	for (const candidate of candidates) {
		const candidateIsAbsolute =
			platform === "win32"
				? windowsPath.isAbsolute(candidate)
				: isAbsolute(candidate);
		if (!candidateIsAbsolute) {
			if (platform !== "win32") {
				return candidate;
			}
			continue;
		}
		if (!pathExists(candidate)) {
			continue;
		}
		if (platform === "win32") {
			const codeModeHost = windowsPath.join(
				windowsPath.dirname(candidate),
				"codex-code-mode-host.exe",
			);
			if (!pathExists(codeModeHost)) {
				continue;
			}
		}
		return candidate;
	}
	return null;
}

function itemLabel(item, agentName = "Agent") {
	const labels = {
		agentMessage: `${agentName} is writing`,
		commandExecution: `${agentName} is running a command`,
		contextCompaction: `${agentName} is organizing context`,
		dynamicToolCall: `${agentName} is using a connected tool`,
		fileChange: `${agentName} is editing project files`,
		imageGeneration: `${agentName} is creating an image`,
		imageView: `${agentName} is inspecting an image`,
		mcpToolCall: `${agentName} is using an MCP tool`,
		plan: `${agentName} is updating the plan`,
		reasoning: `${agentName} is thinking through the task`,
		subAgentActivity: `${agentName} is coordinating agents`,
		userMessage: `${agentName} is reading the brief`,
		webSearch: `${agentName} is researching`,
	};
	return labels[item?.type] ?? `${agentName} is processing an event`;
}

function extractResult(turn) {
	if (!Array.isArray(turn?.items)) {
		return "";
	}

	return (
		turn.items
			.filter((item) => item?.type === "agentMessage" && item.text)
			.map((item) => item.text.trim())
			.filter(Boolean)
			.at(-1) ?? ""
	);
}

function extractApiResult(response) {
	if (typeof response?.output_text === "string") {
		return response.output_text.trim();
	}

	const parts = [];
	for (const item of response?.output ?? []) {
		if (item?.type !== "message") {
			continue;
		}
		for (const content of item.content ?? []) {
			if (
				(content?.type === "output_text" || content?.type === "text") &&
				typeof content.text === "string"
			) {
				parts.push(content.text);
			}
		}
	}
	return parts.join("\n").trim();
}

function buildInstructions(agent, permission, stage) {
	const skillLine =
		agent.skills.length > 0
			? `Preferred installed skills: ${agent.skills.join(", ")}.`
			: "No specific skill is forced; select only what is relevant.";
	const pluginLine =
		agent.plugins.length > 0
			? `Allowed installed plugins: ${agent.plugins.join(", ")}.`
			: "Do not assume optional plugins are available.";

	return [
		`You are ${agent.name}, the ${agent.role} agent inside Agent Homestead.`,
		`Personality: ${agent.personality || "Helpful, direct, and evidence-led."}`,
		`Persistent agent memory: ${agent.memories || "No additional durable memory."}`,
		skillLine,
		pluginLine,
		`Current workflow stage: ${stage || "chat"}.`,
		permission === "workspace-write"
			? "The user explicitly enabled workspace-write for this session. Make only in-scope local project changes and run relevant non-destructive checks. Do not perform external deployment, publish, spend money, reveal secrets, or make destructive changes without a separate explicit confirmation."
			: "This session is read-only. Inspect and advise, but do not modify files or external systems.",
		"Lead with the useful result. Preserve material evidence, caveats, and the next action. Avoid repeated introductions.",
	].join("\n\n");
}

export class CodexBridge {
	constructor({
		rootDirectory,
		store,
		broadcast,
		setConnection,
		setAgent,
		log,
	}) {
		this.rootDirectory = rootDirectory;
		this.store = store;
		this.broadcast = broadcast;
		this.setConnection = setConnection;
		this.setAgent = setAgent;
		this.log = log;
		this.process = null;
		this.requestId = 0;
		this.pendingRequests = new Map();
		this.approvalRequests = new Map();
		this.loadedThreads = new Set();
		this.activeCompletion = null;
		this.activeTask = null;
		this.mode = "connecting";
		this.message = "Starting local Codex bridge…";
		this.catalog = { skills: [], plugins: [], catalogErrors: [] };
	}

	status() {
		return {
			mode: this.mode,
			message: this.message,
			busy: Boolean(this.activeTask),
			approvalMode: "auto-review",
			pendingApprovals: this.approvalRequests.size,
			activeTask: this.activeTask
				? {
						sessionId: this.activeTask.sessionId,
						agentId: this.activeTask.agentId,
						agentName: this.activeTask.agentName,
						stage: this.activeTask.stage,
					}
				: null,
		};
	}

	pendingApprovals() {
		return [...this.approvalRequests.values()].map(
			(approval) => approval.publicRequest,
		);
	}

	isBusy() {
		return Boolean(this.activeTask);
	}

	sendMessage(message) {
		if (!this.process?.stdin.writable) {
			throw new Error("Codex app-server is not writable");
		}
		this.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	sendRequest(method, params, timeoutMs = 30_000) {
		return new Promise((resolveRequest, rejectRequest) => {
			const id = ++this.requestId;
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				rejectRequest(new Error(`${method} timed out`));
			}, timeoutMs);

			this.pendingRequests.set(id, {
				resolve: resolveRequest,
				reject: rejectRequest,
				timeout,
			});
			this.sendMessage({ method, id, params });
		});
	}

	settleResponse(message) {
		const pending = this.pendingRequests.get(message.id);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timeout);
		this.pendingRequests.delete(message.id);

		if (message.error) {
			pending.reject(
				new Error(message.error.message ?? "Codex app-server request failed"),
			);
		} else {
			pending.resolve(message.result);
		}
	}

	handleApprovalRequest(message) {
		const requestId = String(message.id);
		const publicRequest = {
			type: "approval-request",
			requestId,
			method: message.method,
			...approvalSummary(message.method, message.params),
		};

		this.approvalRequests.set(requestId, {
			rpcId: message.id,
			method: message.method,
			params: message.params ?? {},
			publicRequest,
		});
		this.broadcast(publicRequest);
		this.log(
			`Codex needs approval for a ${publicRequest.kind} request.`,
			"approval",
			this.activeTask,
		);
	}

	resolveApproval(requestId, decision) {
		if (!APPROVAL_DECISIONS.has(decision)) {
			throw new Error("Approval decision must be valid");
		}

		const approval = this.approvalRequests.get(String(requestId));
		if (!approval) {
			throw new Error("Approval request not found");
		}

		let result;
		if (approval.method === "item/permissions/requestApproval") {
			const requested = approval.params.permissions ?? {};
			const granted = {};
			if (decision === "accept" || decision === "acceptForSession") {
				if (requested.network) {
					granted.network = requested.network;
				}
				if (requested.fileSystem) {
					granted.fileSystem = requested.fileSystem;
				}
			}
			result = {
				permissions: granted,
				scope: decision === "acceptForSession" ? "session" : "turn",
			};
		} else {
			result = { decision };
		}

		this.sendMessage({ id: approval.rpcId, result });
		this.approvalRequests.delete(String(requestId));
		const resolution = {
			type: "approval-resolved",
			requestId: String(requestId),
			decision,
			threadId: approval.publicRequest.threadId,
			turnId: approval.publicRequest.turnId,
		};
		this.broadcast(resolution);
		this.log(
			decision === "accept" || decision === "acceptForSession"
				? "Approval granted. Codex is continuing."
				: "Approval declined. Codex is continuing within its sandbox.",
			"approval",
			this.activeTask,
		);
		return resolution;
	}

	handleNotification(message) {
		const { method, params } = message;
		const active = this.activeTask;

		switch (method) {
			case "turn/started":
				if (active) {
					active.turnId = params?.turn?.id ?? active.turnId;
					this.setAgent(
						"working",
						`${active.agentName} is working on ${active.stage}.`,
						active,
					);
				}
				break;
			case "item/started":
				if (active) {
					this.log(
						itemLabel(params?.item, active.agentName),
						params?.item?.type ?? "item",
						active,
					);
				}
				break;
			case "item/completed":
				if (
					active &&
					params?.item?.type === "agentMessage" &&
					params.item.text
				) {
					active.lastResult = params.item.text;
				}
				break;
			case "turn/completed": {
				if (!active || !this.activeCompletion) {
					break;
				}

				const status = params?.turn?.status ?? "completed";
				const result = extractResult(params?.turn) || active.lastResult || "";
				const completion = this.activeCompletion;
				this.activeCompletion = null;
				this.activeTask = null;

				if (status === "completed") {
					this.setAgent(
						"done",
						`${active.agentName} completed ${active.stage}.`,
						active,
					);
					completion.resolve(result);
				} else {
					this.setAgent(
						"waiting",
						`${active.agentName}'s turn ended with status: ${status}.`,
						active,
					);
					completion.reject(
						new Error(`Codex turn ended with status: ${status}`),
					);
				}
				break;
			}
			case "error":
				this.log(
					params?.message ?? "Codex reported an error.",
					"error",
					active,
				);
				break;
			case "warning":
			case "configWarning":
				this.log(
					params?.message ?? "Codex reported a warning.",
					"warning",
					active,
				);
				break;
			default:
				break;
		}
	}

	handleLine(line) {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}

		if (
			Object.hasOwn(message, "id") &&
			(Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
		) {
			this.settleResponse(message);
			return;
		}

		if (Object.hasOwn(message, "id") && APPROVAL_METHODS.has(message.method)) {
			this.handleApprovalRequest(message);
			return;
		}

		if (message.method) {
			this.handleNotification(message);
		}
	}

	async initializeCodex() {
		await this.sendRequest("initialize", {
			clientInfo: {
				name: "agent_homestead",
				title: "Agent Homestead",
				version: "2.0.0",
			},
			capabilities: {
				experimentalApi: true,
				requestAttestation: false,
			},
		});
		this.sendMessage({ method: "initialized", params: {} });
		this.mode = "live";
		this.message = "Codex connected";
		this.setConnection("live", this.message);
		this.log("Local Codex app-server is ready.", "live");
		await this.refreshCatalog();
	}

	async refreshCatalog() {
		const errors = [];
		let skills = [];
		let plugins = [];

		try {
			const result = await this.sendRequest("skills/list", {
				cwds: [this.rootDirectory],
				forceReload: false,
			});
			const byName = new Map();
			for (const entry of result?.data ?? []) {
				for (const skill of entry.skills ?? []) {
					if (skill.enabled && !byName.has(skill.name)) {
						byName.set(skill.name, {
							name: skill.name,
							description: skill.shortDescription ?? skill.description ?? "",
							scope: skill.scope,
						});
					}
				}
				for (const issue of entry.errors ?? []) {
					errors.push(`Skill: ${issue.message}`);
				}
			}
			skills = [...byName.values()].sort((a, b) =>
				a.name.localeCompare(b.name),
			);
		} catch (error) {
			errors.push(`Skills: ${error.message}`);
		}

		try {
			const result = await this.sendRequest("plugin/installed", {
				cwds: [this.rootDirectory],
				installSuggestionPluginNames: [],
			});
			const byId = new Map();
			for (const marketplace of result?.marketplaces ?? []) {
				for (const plugin of marketplace.plugins ?? []) {
					if (plugin.installed && plugin.enabled && !byId.has(plugin.id)) {
						byId.set(plugin.id, {
							id: plugin.id,
							name: plugin.name,
							description:
								plugin.interface?.shortDescription ??
								plugin.interface?.longDescription ??
								"",
							marketplace: marketplace.name,
						});
					}
				}
			}
			plugins = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
		} catch (error) {
			errors.push(`Plugins: ${error.message}`);
		}

		this.catalog = { skills, plugins, catalogErrors: errors };
		this.broadcast({ type: "catalog", ...this.catalog });
		return this.catalog;
	}

	start() {
		const executable = resolveCodexExecutable();
		if (!executable) {
			this.mode = "demo";
			this.message = "Demo mode";
			this.setConnection("demo", this.message);
			this.log(
				"No complete Codex CLI and Code Mode host bundle was found. Demo mode is active.",
				"offline",
			);
			return;
		}
		this.log(`Codex runtime selected: ${executable}`, "runtime");

		try {
			this.process = spawn(
				executable,
				["--approve-for-me", "app-server", "--listen", "stdio://"],
				{
					cwd: this.rootDirectory,
					env: process.env,
					stdio: ["pipe", "pipe", "pipe"],
					windowsHide: true,
				},
			);
		} catch (error) {
			this.mode = "demo";
			this.message = "Demo mode";
			this.setConnection("demo", this.message);
			this.log(error.message ?? "Could not launch Codex.", "error");
			return;
		}

		const output = createInterface({ input: this.process.stdout });
		output.on("line", (line) => this.handleLine(line));
		const errors = createInterface({ input: this.process.stderr });
		errors.on("line", (line) => {
			if (line.trim()) {
				this.log(`Codex runtime: ${clampContext(line, 2_000)}`, "warning");
			}
		});

		this.process.once("error", (error) => {
			this.mode = "demo";
			this.message = "Demo mode";
			this.setConnection("demo", this.message);
			this.log(`Codex launch failed: ${error.message}`, "error");
		});

		this.process.once("exit", (code) => {
			this.process = null;
			this.loadedThreads.clear();
			this.activeTask = null;
			if (this.activeCompletion) {
				this.activeCompletion.reject(new Error("Codex app-server exited"));
				this.activeCompletion = null;
			}
			for (const pending of this.pendingRequests.values()) {
				clearTimeout(pending.timeout);
				pending.reject(new Error("Codex app-server exited"));
			}
			this.pendingRequests.clear();
			for (const approval of this.approvalRequests.values()) {
				this.broadcast({
					type: "approval-resolved",
					requestId: approval.publicRequest.requestId,
					decision: "cancel",
					threadId: approval.publicRequest.threadId,
					turnId: approval.publicRequest.turnId,
				});
			}
			this.approvalRequests.clear();
			this.mode = "demo";
			this.message = "Demo mode";
			this.setConnection("demo", this.message);
			this.log(
				`Codex app-server stopped${code === null ? "" : ` (${code})`}.`,
				"offline",
			);
		});

		void this.initializeCodex().catch((error) => {
			this.mode = "demo";
			this.message = "Demo mode";
			this.setConnection("demo", this.message);
			this.log(`Codex initialization failed: ${error.message}`, "error");
			this.process?.kill();
		});
	}

	async ensureThread(session, agent, project, permission, stage) {
		let threadId = session.threadIds?.[agent.id] ?? null;
		const params = {
			cwd: project.path,
			approvalPolicy: "on-request",
			sandbox: codexThreadSandbox(permission),
			developerInstructions: buildInstructions(agent, permission, stage),
		};

		if (threadId) {
			try {
				// Refresh sticky instructions and permissions before every stage or chat turn.
				await this.sendRequest("thread/resume", {
					threadId,
					...params,
					excludeTurns: true,
				});
				this.loadedThreads.add(threadId);
			} catch {
				threadId = null;
			}
		}

		if (!threadId) {
			const result = await this.sendRequest("thread/start", {
				...params,
				ephemeral: false,
				serviceName: "agent-homestead",
			});
			threadId = result?.thread?.id ?? null;
			if (!threadId) {
				throw new Error("Codex did not return a thread id");
			}
			this.loadedThreads.add(threadId);
			await this.store.setThreadId(session.id, agent.id, threadId);
			void this.sendRequest("thread/name/set", {
				threadId,
				name: `${session.title} — ${agent.name}`,
			}).catch(() => {});
		}

		return threadId;
	}

	async runLocalTurn({ session, agent, project, prompt, permission, stage }) {
		if (this.mode !== "live") {
			throw new Error("Local Codex is not connected");
		}

		const threadId = await this.ensureThread(
			session,
			agent,
			project,
			permission,
			stage,
		);
		const completion = new Promise((resolve, reject) => {
			this.activeCompletion = { resolve, reject };
		});

		this.activeTask = {
			sessionId: session.id,
			agentId: agent.id,
			agentName: agent.name,
			stage,
			turnId: null,
			lastResult: "",
		};
		this.setAgent(
			"walking",
			`${agent.name} is moving to the ${stage} station.`,
			this.activeTask,
		);
		this.broadcast({
			type: "agent-activity",
			...this.activeTask,
			status: "walking",
		});

		try {
			const result = await this.sendRequest("turn/start", {
				threadId,
				input: [{ type: "text", text: prompt, text_elements: [] }],
				cwd: project.path,
				approvalPolicy: "on-request",
				sandboxPolicy: codexTurnSandboxPolicy(permission, project.path),
			});
			if (this.activeTask) {
				this.activeTask.turnId = result?.turn?.id ?? null;
			}
			return await completion;
		} catch (error) {
			this.activeTask = null;
			if (this.activeCompletion) {
				this.activeCompletion = null;
			}
			throw error;
		}
	}

	async runApiTurn({ session, agent, prompt, permission, stage }) {
		const environmentName = agent.apiKeyEnv || "OPENAI_API_KEY";
		const apiKey = process.env[environmentName];
		if (!apiKey) {
			throw new Error(
				`${environmentName} is not set for the ${agent.name} API provider`,
			);
		}

		this.activeTask = {
			sessionId: session.id,
			agentId: agent.id,
			agentName: agent.name,
			stage,
			turnId: null,
			lastResult: "",
		};
		this.setAgent(
			"working",
			`${agent.name} is running through the OpenAI API.`,
			this.activeTask,
		);
		this.broadcast({
			type: "agent-activity",
			...this.activeTask,
			status: "working",
		});

		try {
			const body = {
				model: agent.model || API_DEFAULT_MODEL,
				instructions: buildInstructions(agent, permission, stage),
				input: prompt,
				reasoning: { effort: "medium" },
				safety_identifier: "agent-homestead-local-user",
			};
			const previousResponseId = session.responseIds?.[agent.id];
			if (previousResponseId) {
				body.previous_response_id = previousResponseId;
			}

			const response = await fetch("https://api.openai.com/v1/responses", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(180_000),
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(
					payload?.error?.message ?? `OpenAI API returned ${response.status}`,
				);
			}

			if (payload.id) {
				await this.store.setResponseId(session.id, agent.id, payload.id);
			}
			const result = extractApiResult(payload);
			if (!result) {
				throw new Error("OpenAI API returned no text result");
			}
			this.activeTask = null;
			return result;
		} catch (error) {
			this.activeTask = null;
			throw error;
		}
	}

	async runTurn(options) {
		if (this.activeTask) {
			throw new Error(`${this.activeTask.agentName} is already working`);
		}

		const result =
			options.agent.provider === "openai-api"
				? await this.runApiTurn(options)
				: await this.runLocalTurn(options);

		this.broadcast({
			type: "agent-result",
			sessionId: options.session.id,
			agentId: options.agent.id,
			agentName: options.agent.name,
			stage: options.stage,
			text: result,
		});
		return result;
	}

	stop() {
		this.process?.kill();
	}
}
