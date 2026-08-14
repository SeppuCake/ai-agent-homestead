import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HomesteadStore } from "../homestead-store.mjs";

test("HomesteadStore persists state in the configured data directory", async (t) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), "homestead-store-"));
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const projectRoot = join(temporaryRoot, "app");
	const dataDirectory = join(temporaryRoot, "data");
	const store = new HomesteadStore(projectRoot, dataDirectory);

	await store.initialize();

	assert.equal(store.filePath, join(dataDirectory, "state.json"));
	const persisted = JSON.parse(await readFile(store.filePath, "utf8"));
	assert.equal(persisted.version, 4);
	assert.equal(persisted.projects[0].path, projectRoot);
});

test("HomesteadStore saves only public attachment metadata in messages", async (t) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), "homestead-store-"));
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const store = new HomesteadStore(
		join(temporaryRoot, "app"),
		join(temporaryRoot, "data"),
	);
	const snapshot = await store.initialize();
	const sessionId = snapshot.sessions[0].id;

	const message = await store.addMessage(sessionId, {
		role: "user",
		text: "Inspect this map",
		attachments: [
			{
				id: "attachment-1",
				name: "map.png",
				type: "image/png",
				size: 123,
				kind: "image",
				path: "D:\\private\\map.png",
				dataUrl: "data:image/png;base64,secret",
			},
		],
	});

	assert.deepEqual(message.attachments, [
		{
			id: "attachment-1",
			name: "map.png",
			type: "image/png",
			size: 123,
			kind: "image",
		},
	]);
});
