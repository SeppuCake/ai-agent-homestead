import assert from "node:assert/strict";
import test from "node:test";

import {
	CodexBridge,
	resolveCodexExecutable,
} from "../codex-bridge.mjs";

const projectPath = "D:\\Projects\\ai-agent-homestead";

test("Windows runtime discovery skips a CLI with no sibling Code Mode host", () => {
	const legacyCli = "C:\\legacy\\codex.exe";
	const managedCli = "C:\\managed\\codex.exe";
	const existingPaths = new Set([
		legacyCli,
		managedCli,
		"C:\\managed\\codex-code-mode-host.exe",
	]);

	assert.equal(
		resolveCodexExecutable([legacyCli, managedCli, "codex"], {
			platform: "win32",
			pathExists: (path) => existingPaths.has(path),
		}),
		managedCli,
	);
});

test("Windows runtime discovery fails closed when every bundle is incomplete", () => {
	const incompleteCli = "C:\\legacy\\codex.exe";

	assert.equal(
		resolveCodexExecutable([incompleteCli, "codex"], {
			platform: "win32",
			pathExists: (path) => path === incompleteCli,
		}),
		null,
	);
});

test("non-Windows runtime discovery retains PATH command fallback", () => {
	assert.equal(
		resolveCodexExecutable(["codex"], {
			platform: "linux",
			pathExists: () => false,
		}),
		"codex",
	);
});

function createBridge(existingThreadId = null) {
	const session = {
		id: "session-1",
		title: "Protocol test",
		threadIds: existingThreadId ? { mosin: existingThreadId } : {},
	};
	const requests = [];
	const bridge = new CodexBridge({
		rootDirectory: projectPath,
		store: {
			async setThreadId(_sessionId, agentId, threadId) {
				session.threadIds[agentId] = threadId;
			},
		},
		broadcast() {},
		setConnection() {},
		setAgent() {},
		log() {},
	});
	bridge.mode = "live";
	bridge.sendRequest = async (method, params) => {
		requests.push({ method, params });
		if (method === "thread/start") {
			return { thread: { id: "thread-1" } };
		}
		if (method === "turn/start") {
			queueMicrotask(() => {
				bridge.handleNotification({
					method: "turn/completed",
					params: {
						turn: {
							id: "turn-1",
							status: "completed",
							items: [{ type: "agentMessage", text: "Done" }],
						},
					},
				});
			});
			return { turn: { id: "turn-1" } };
		}
		return {};
	};

	return { bridge, requests, session };
}

async function captureTurnRequests(permission) {
	const { bridge, requests, session } = createBridge();
	const result = await bridge.runLocalTurn({
		session,
		agent: {
			id: "mosin",
			name: "Mosin",
			personality: "Cheerful mentor",
			skills: [],
			plugins: [],
			memories: [],
		},
		project: { id: "project-1", path: projectPath },
		prompt: "Test the protocol payload.",
		permission,
		stage: "plan",
	});
	assert.equal(result, "Done");
	return requests;
}

test("read-only workflow uses each App Server method's required enum shape", async () => {
	const requests = await captureTurnRequests("read-only");
	const threadStart = requests.find(({ method }) => method === "thread/start");
	const turnStart = requests.find(({ method }) => method === "turn/start");

	assert.equal(threadStart.params.approvalPolicy, "on-request");
	assert.equal(threadStart.params.sandbox, "read-only");
	assert.equal(turnStart.params.approvalPolicy, "on-request");
	assert.deepEqual(turnStart.params.sandboxPolicy, {
		type: "readOnly",
		networkAccess: false,
	});
});

test("workspace workflow sends a complete workspaceWrite policy", async () => {
	const requests = await captureTurnRequests("workspace-write");
	const threadStart = requests.find(({ method }) => method === "thread/start");
	const turnStart = requests.find(({ method }) => method === "turn/start");

	assert.equal(threadStart.params.sandbox, "workspace-write");
	assert.deepEqual(turnStart.params.sandboxPolicy, {
		type: "workspaceWrite",
		writableRoots: [projectPath],
		networkAccess: false,
		excludeTmpdirEnvVar: false,
		excludeSlashTmp: false,
	});
});

test("resuming a saved agent thread keeps the legacy thread enum", async () => {
	const { bridge, requests, session } = createBridge("saved-thread");
	await bridge.runLocalTurn({
		session,
		agent: {
			id: "mosin",
			name: "Mosin",
			personality: "Cheerful mentor",
			skills: [],
			plugins: [],
			memories: [],
		},
		project: { id: "project-1", path: projectPath },
		prompt: "Resume the protocol test.",
		permission: "read-only",
		stage: "plan",
	});

	const resume = requests.find(({ method }) => method === "thread/resume");
	assert.equal(resume.params.threadId, "saved-thread");
	assert.equal(resume.params.approvalPolicy, "on-request");
	assert.equal(resume.params.sandbox, "read-only");
	assert.equal(resume.params.excludeTurns, true);
});

test("reused threads refresh stage instructions and permissions", async () => {
	const { bridge, requests, session } = createBridge();
	const agent = {
		id: "mosin",
		name: "Mosin",
		role: "coordinator",
		personality: "Cheerful mentor",
		skills: [],
		plugins: [],
		memories: [],
	};
	const project = { id: "project-1", path: projectPath };

	await bridge.runLocalTurn({
		session,
		agent,
		project,
		prompt: "Plan first.",
		permission: "read-only",
		stage: "plan",
	});
	await bridge.runLocalTurn({
		session,
		agent,
		project,
		prompt: "Build next.",
		permission: "workspace-write",
		stage: "build",
	});

	const resume = requests.find(({ method }) => method === "thread/resume");
	assert.equal(resume.params.sandbox, "workspace-write");
	assert.match(resume.params.developerInstructions, /Current workflow stage: build/);
	assert.match(
		resume.params.developerInstructions,
		/user explicitly enabled workspace-write/,
	);
});

test("initialize advertises the complete capabilities shape", async () => {
	const { bridge, requests } = createBridge();
	bridge.sendMessage = () => {};
	bridge.refreshCatalog = async () => bridge.catalog;
	await bridge.initializeCodex();

	const initialize = requests.find(({ method }) => method === "initialize");
	assert.deepEqual(initialize.params.capabilities, {
		experimentalApi: true,
		requestAttestation: false,
	});
});

test("approval responses match command and permissions response schemas", () => {
	const { bridge } = createBridge();
	const responses = [];
	bridge.sendMessage = (message) => responses.push(message);

	bridge.handleApprovalRequest({
		id: 41,
		method: "item/commandExecution/requestApproval",
		params: { command: "npm.cmd test" },
	});
	bridge.resolveApproval("41", "accept");

	bridge.handleApprovalRequest({
		id: 42,
		method: "item/permissions/requestApproval",
		params: {
			permissions: {
				network: { enabled: true },
				fileSystem: null,
			},
		},
	});
	bridge.resolveApproval("42", "acceptForSession");

	assert.deepEqual(responses, [
		{ id: 41, result: { decision: "accept" } },
		{
			id: 42,
			result: {
				permissions: { network: { enabled: true } },
				scope: "session",
			},
		},
	]);
});
