import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const STORE_VERSION = 3;
const now = () => new Date().toISOString();

function sessionMode(value) {
	if (value === "workflow" || value === "ad-hoc") {
		return value;
	}
	return "chat";
}

function createDefaultState(rootDirectory) {
	const createdAt = now();
	const projectId = randomUUID();
	const mosinId = randomUUID();
	const springfieldId = randomUUID();
	const sessionId = randomUUID();

	return {
		version: STORE_VERSION,
		projects: [
			{
				id: projectId,
				name: "Agent Homestead",
				path: rootDirectory,
				createdAt,
				updatedAt: createdAt,
			},
		],
		agents: [
			{
				id: mosinId,
				name: "Mosin",
				avatar: "preset:mosin",
				role: "coordinator",
				personality:
					"Sweet, cheerful, pragmatic, playful, and protective. Coordinate clearly, keep the team focused, and teach with warmth.",
				skills: [],
				plugins: [],
				provider: "local-codex",
				model: "",
				apiKeyEnv: "OPENAI_API_KEY",
				memories:
					"The user is learning TypeScript, Vite, and Three.js. Explain important architectural decisions without drowning them in detail.",
				createdAt,
				updatedAt: createdAt,
			},
			{
				id: springfieldId,
				name: "Springfield",
				avatar: "preset:springfield",
				role: "tester",
				personality:
					"Calm, meticulous, encouraging, and quietly confident. Look for regressions, verify evidence, and report failures precisely.",
				skills: [],
				plugins: [],
				provider: "local-codex",
				model: "",
				apiKeyEnv: "OPENAI_API_KEY",
				memories:
					"Prefer focused verification: typecheck, production build, browser behavior, and concise reproducible findings.",
				createdAt,
				updatedAt: createdAt,
			},
		],
		sessions: [
			{
				id: sessionId,
				projectId,
				title: "Homestead Studio",
				mode: "chat",
				permission: "read-only",
				leadAgentId: mosinId,
				agentIds: [mosinId, springfieldId],
				messages: [],
				threadIds: {},
				responseIds: {},
				workflowRuns: [],
				createdAt,
				updatedAt: createdAt,
			},
		],
		settings: {
			activeProjectId: projectId,
			activeSessionId: sessionId,
		},
	};
}

function clampText(value, maximum, fallback = "") {
	if (typeof value !== "string") {
		return fallback;
	}
	return value.trim().slice(0, maximum);
}

function publicAgent(agent) {
	return {
		...agent,
		apiKeyEnv: agent.apiKeyEnv || "OPENAI_API_KEY",
	};
}

function publicSession(session, includeMessages = false) {
	const output = {
		id: session.id,
		projectId: session.projectId,
		title: session.title,
		mode: session.mode,
		permission: session.permission,
		leadAgentId: session.leadAgentId,
		agentIds: session.agentIds,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		messageCount: session.messages.length,
		lastMessage: session.messages.at(-1)?.text ?? "",
		workflowRuns: session.workflowRuns,
	};

	if (includeMessages) {
		output.messages = session.messages;
	}

	return output;
}

export class HomesteadStore {
	constructor(rootDirectory) {
		this.rootDirectory = rootDirectory;
		this.dataDirectory = join(rootDirectory, ".agent-homestead");
		this.filePath = join(this.dataDirectory, "state.json");
		this.state = createDefaultState(rootDirectory);
		this.persistChain = Promise.resolve();
	}

	async initialize() {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw);

			if (
				parsed &&
				Array.isArray(parsed.projects) &&
				Array.isArray(parsed.sessions) &&
				Array.isArray(parsed.agents)
			) {
				this.state = {
					...createDefaultState(this.rootDirectory),
					...parsed,
					version: STORE_VERSION,
				};
			}
		} catch (error) {
			if (error?.code !== "ENOENT") {
				throw error;
			}
			await this.persist();
		}

		this.ensureReferences();
		return this.snapshot();
	}

	ensureReferences() {
		const projectIds = new Set(this.state.projects.map((project) => project.id));
		const agentIds = new Set(this.state.agents.map((agent) => agent.id));

		this.state.sessions = this.state.sessions.filter((session) =>
			projectIds.has(session.projectId),
		);

		for (const session of this.state.sessions) {
			session.agentIds = (session.agentIds ?? []).filter((id) =>
				agentIds.has(id),
			);
			session.leadAgentId = agentIds.has(session.leadAgentId)
				? session.leadAgentId
				: session.agentIds[0] ?? this.state.agents[0]?.id ?? null;
			session.messages ??= [];
			session.threadIds ??= {};
			session.responseIds ??= {};
			session.workflowRuns ??= [];
			session.permission =
				session.permission === "workspace-write"
					? "workspace-write"
					: "read-only";
			session.mode = sessionMode(session.mode);
		}

		if (!projectIds.has(this.state.settings?.activeProjectId)) {
			this.state.settings.activeProjectId = this.state.projects[0]?.id ?? null;
		}

		if (
			!this.state.sessions.some(
				(session) => session.id === this.state.settings?.activeSessionId,
			)
		) {
			this.state.settings.activeSessionId = this.state.sessions[0]?.id ?? null;
		}
	}

	snapshot() {
		return {
			version: this.state.version,
			projects: this.state.projects.map((project) => ({ ...project })),
			agents: this.state.agents.map(publicAgent),
			sessions: this.state.sessions.map((session) => publicSession(session)),
			settings: { ...this.state.settings },
		};
	}

	async persist() {
		this.persistChain = this.persistChain.then(async () => {
			await mkdir(dirname(this.filePath), { recursive: true });
			const temporaryPath = `${this.filePath}.tmp`;
			await writeFile(
				temporaryPath,
				`${JSON.stringify(this.state, null, 2)}\n`,
				"utf8",
			);
			await rename(temporaryPath, this.filePath);
		});
		return this.persistChain;
	}

	getProject(projectId) {
		return this.state.projects.find((project) => project.id === projectId) ?? null;
	}

	getAgent(agentId) {
		return this.state.agents.find((agent) => agent.id === agentId) ?? null;
	}

	getSessionRecord(sessionId) {
		return this.state.sessions.find((session) => session.id === sessionId) ?? null;
	}

	getSession(sessionId) {
		const session = this.getSessionRecord(sessionId);
		return session ? publicSession(session, true) : null;
	}

	async createProject(input) {
		const createdAt = now();
		const project = {
			id: randomUUID(),
			name: clampText(input?.name, 80, "Untitled Project"),
			path: clampText(input?.path, 1024),
			createdAt,
			updatedAt: createdAt,
		};
		this.state.projects.unshift(project);
		this.state.settings.activeProjectId = project.id;
		await this.persist();
		return { ...project };
	}

	async createSession(input) {
		const project = this.getProject(input?.projectId);
		if (!project) {
			throw new Error("Project not found");
		}

		const createdAt = now();
		const requestedAgentIds = Array.isArray(input?.agentIds)
			? input.agentIds.filter((id) => this.getAgent(id))
			: [];
		const agentIds =
			requestedAgentIds.length > 0
				? requestedAgentIds
				: this.state.agents.slice(0, 2).map((agent) => agent.id);
		const leadAgentId = agentIds.includes(input?.leadAgentId)
			? input.leadAgentId
			: agentIds[0] ?? null;
		const session = {
			id: randomUUID(),
			projectId: project.id,
			title: clampText(input?.title, 100, "New Homestead Chat"),
			mode: sessionMode(input?.mode),
			permission:
				input?.permission === "workspace-write"
					? "workspace-write"
					: "read-only",
			leadAgentId,
			agentIds,
			messages: [],
			threadIds: {},
			responseIds: {},
			workflowRuns: [],
			createdAt,
			updatedAt: createdAt,
		};

		this.state.sessions.unshift(session);
		this.state.settings.activeProjectId = project.id;
		this.state.settings.activeSessionId = session.id;
		await this.persist();
		return publicSession(session, true);
	}

	async updateSession(sessionId, input) {
		const session = this.getSessionRecord(sessionId);
		if (!session) {
			throw new Error("Session not found");
		}

		if (input?.title !== undefined) {
			session.title = clampText(input.title, 100, session.title);
		}
		if (input?.mode !== undefined) {
			session.mode = sessionMode(input.mode);
		}
		if (input?.permission !== undefined) {
			session.permission =
				input.permission === "workspace-write"
					? "workspace-write"
					: "read-only";
		}
		if (Array.isArray(input?.agentIds)) {
			const unique = [
				...new Set(input.agentIds.filter((id) => this.getAgent(id))),
			];
			if (unique.length > 0) {
				session.agentIds = unique;
				if (!session.agentIds.includes(session.leadAgentId)) {
					session.leadAgentId = session.agentIds[0];
				}
			}
		}
		if (
			input?.leadAgentId &&
			session.agentIds.includes(input.leadAgentId) &&
			this.getAgent(input.leadAgentId)
		) {
			session.leadAgentId = input.leadAgentId;
		}

		session.updatedAt = now();
		this.state.settings.activeProjectId = session.projectId;
		this.state.settings.activeSessionId = session.id;
		await this.persist();
		return publicSession(session, true);
	}

	async deleteSession(sessionId) {
		const index = this.state.sessions.findIndex(
			(session) => session.id === sessionId,
		);
		if (index < 0) {
			throw new Error("Session not found");
		}

		const [deleted] = this.state.sessions.splice(index, 1);
		if (this.state.settings.activeSessionId === sessionId) {
			this.state.settings.activeSessionId =
				this.state.sessions.find(
					(session) => session.projectId === deleted.projectId,
				)?.id ?? null;
		}
		await this.persist();
		return {
			deleted: true,
			activeSessionId: this.state.settings.activeSessionId,
		};
	}

	async addMessage(sessionId, message) {
		const session = this.getSessionRecord(sessionId);
		if (!session) {
			throw new Error("Session not found");
		}

		const record = {
			id: randomUUID(),
			role: message.role === "user" ? "user" : "assistant",
			agentId: message.agentId ?? null,
			text: clampText(message.text, 40_000),
			kind: clampText(message.kind, 32, "chat"),
			stage: clampText(message.stage, 32),
			createdAt: now(),
		};
		session.messages.push(record);
		session.updatedAt = record.createdAt;
		await this.persist();
		return record;
	}

	async setThreadId(sessionId, agentId, threadId) {
		const session = this.getSessionRecord(sessionId);
		if (!session) {
			throw new Error("Session not found");
		}
		session.threadIds[agentId] = threadId;
		session.updatedAt = now();
		await this.persist();
	}

	async setResponseId(sessionId, agentId, responseId) {
		const session = this.getSessionRecord(sessionId);
		if (!session) {
			throw new Error("Session not found");
		}
		session.responseIds[agentId] = responseId;
		session.updatedAt = now();
		await this.persist();
	}

	async createAgent(input) {
		const createdAt = now();
		const agent = {
			id: randomUUID(),
			name: clampText(input?.name, 60, "New Agent"),
			avatar: clampText(input?.avatar, 150_000, "preset:scout"),
			role: clampText(input?.role, 30, "general"),
			personality: clampText(input?.personality, 4000),
			skills: Array.isArray(input?.skills)
				? input.skills.map((item) => clampText(item, 160)).filter(Boolean)
				: [],
			plugins: Array.isArray(input?.plugins)
				? input.plugins.map((item) => clampText(item, 160)).filter(Boolean)
				: [],
			provider:
				input?.provider === "openai-api" ? "openai-api" : "local-codex",
			model: clampText(input?.model, 100),
			apiKeyEnv: clampText(input?.apiKeyEnv, 100, "OPENAI_API_KEY"),
			memories: clampText(input?.memories, 12_000),
			createdAt,
			updatedAt: createdAt,
		};
		this.state.agents.push(agent);
		await this.persist();
		return publicAgent(agent);
	}

	async updateAgent(agentId, input) {
		const agent = this.getAgent(agentId);
		if (!agent) {
			throw new Error("Agent not found");
		}

		for (const [field, maximum] of [
			["name", 60],
			["avatar", 150_000],
			["role", 30],
			["personality", 4000],
			["model", 100],
			["apiKeyEnv", 100],
			["memories", 12_000],
		]) {
			if (input?.[field] !== undefined) {
				agent[field] = clampText(input[field], maximum, agent[field]);
			}
		}

		if (Array.isArray(input?.skills)) {
			agent.skills = input.skills
				.map((item) => clampText(item, 160))
				.filter(Boolean);
		}
		if (Array.isArray(input?.plugins)) {
			agent.plugins = input.plugins
				.map((item) => clampText(item, 160))
				.filter(Boolean);
		}
		if (input?.provider !== undefined) {
			agent.provider =
				input.provider === "openai-api" ? "openai-api" : "local-codex";
		}

		agent.updatedAt = now();
		await this.persist();
		return publicAgent(agent);
	}

	async deleteAgent(agentId) {
		if (this.state.agents.length <= 1) {
			throw new Error("At least one agent must remain");
		}

		const index = this.state.agents.findIndex((agent) => agent.id === agentId);
		if (index < 0) {
			throw new Error("Agent not found");
		}

		this.state.agents.splice(index, 1);
		const fallbackId = this.state.agents[0].id;
		for (const session of this.state.sessions) {
			session.agentIds = session.agentIds.filter((id) => id !== agentId);
			if (session.agentIds.length === 0) {
				session.agentIds = [fallbackId];
			}
			if (session.leadAgentId === agentId) {
				session.leadAgentId = session.agentIds[0];
			}
			delete session.threadIds[agentId];
			delete session.responseIds[agentId];
		}
		await this.persist();
	}

	async createWorkflowRun(sessionId, prompt) {
		const session = this.getSessionRecord(sessionId);
		if (!session) {
			throw new Error("Session not found");
		}
		const run = {
			id: randomUUID(),
			prompt: clampText(prompt, 4000),
			status: "running",
			stage: "plan",
			outputs: {},
			createdAt: now(),
			updatedAt: now(),
		};
		session.workflowRuns.unshift(run);
		session.workflowRuns = session.workflowRuns.slice(0, 20);
		session.updatedAt = run.updatedAt;
		await this.persist();
		return run;
	}

	async updateWorkflowRun(sessionId, runId, patch) {
		const session = this.getSessionRecord(sessionId);
		const run = session?.workflowRuns.find((item) => item.id === runId);
		if (!session || !run) {
			throw new Error("Workflow run not found");
		}
		Object.assign(run, patch, { updatedAt: now() });
		session.updatedAt = run.updatedAt;
		await this.persist();
		return run;
	}
}
