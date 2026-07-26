import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
const bridgeUrl = "http://127.0.0.1:4174/api/health";
const serverEntry = fileURLToPath(new URL("./server.mjs", import.meta.url));
const viteEntry = fileURLToPath(
	new URL("./node_modules/vite/bin/vite.js", import.meta.url),
);
const children = new Set();
let shuttingDown = false;

// Run child tools through the same Node executable that launched this script.
function startNodeProcess(label, entry, args = []) {
	const child = spawn(process.execPath, [entry, ...args], {
		cwd: rootDirectory,
		env: process.env,
		stdio: "inherit",
	});

	children.add(child);
	child.once("exit", (code, signal) => {
		children.delete(child);

		if (!shuttingDown) {
			console.error(
				`[dev] ${label} stopped unexpectedly (${signal ?? `exit ${code}`}).`,
			);
			shutdown(code ?? 1);
		}
	});

	return child;
}

async function bridgeIsHealthy() {
	try {
		const response = await fetch(bridgeUrl, {
			signal: AbortSignal.timeout(750),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function waitForBridge(bridgeProcess) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (await bridgeIsHealthy()) {
			return;
		}

		if (bridgeProcess.exitCode !== null) {
			throw new Error("The Codex bridge exited before it became ready.");
		}

		await delay(100);
	}

	throw new Error("The Codex bridge did not become ready within five seconds.");
}

function shutdown(exitCode = 0) {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	for (const child of children) {
		if (child.exitCode === null) {
			child.kill();
		}
	}

	setTimeout(() => process.exit(exitCode), 250);
}

process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());

try {
	if (await bridgeIsHealthy()) {
		console.log("[dev] Reusing the Agent Homestead bridge on port 4174.");
	} else {
		console.log("[dev] Starting the Agent Homestead bridge on port 4174...");
		const bridgeProcess = startNodeProcess("Codex bridge", serverEntry);
		await waitForBridge(bridgeProcess);
		console.log("[dev] Codex bridge is ready.");
	}

	console.log("[dev] Starting Vite on port 5173...");
	startNodeProcess("Vite", viteEntry, process.argv.slice(2));
} catch (error) {
	console.error(
		`[dev] ${error instanceof Error ? error.message : String(error)}`,
	);
	shutdown(1);
}
