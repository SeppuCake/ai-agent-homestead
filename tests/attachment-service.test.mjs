import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AttachmentService } from "../attachment-service.mjs";

test("AttachmentService validates and persists a bounded image", async (t) => {
	const dataDirectory = await mkdtemp(join(tmpdir(), "homestead-attachment-"));
	t.after(() => rm(dataDirectory, { recursive: true, force: true }));
	const service = new AttachmentService(dataDirectory);
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	);

	const [attachment] = await service.save("session-1", [
		{
			name: "map.png",
			type: "image/png",
			size: bytes.length,
			dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
		},
	]);

	assert.equal(attachment.name, "map.png");
	assert.equal(attachment.kind, "image");
	assert.deepEqual(await readFile(attachment.path), bytes);
	assert.match(attachment.dataUrl, /^data:image\/png;base64,/);
});

test("AttachmentService rejects unsupported executable files", async (t) => {
	const dataDirectory = await mkdtemp(join(tmpdir(), "homestead-attachment-"));
	t.after(() => rm(dataDirectory, { recursive: true, force: true }));
	const service = new AttachmentService(dataDirectory);

	await assert.rejects(
		service.save("session-1", [
			{
				name: "surprise.exe",
				type: "application/octet-stream",
				size: 3,
				dataUrl: "data:application/octet-stream;base64,YWJj",
			},
		]),
		/Unsupported attachment type/,
	);
});
