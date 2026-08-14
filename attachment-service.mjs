import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

export const MAX_ATTACHMENT_COUNT = 4;
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXTENSION = new Map([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".webp", "image/webp"],
	[".pdf", "application/pdf"],
	[".txt", "text/plain"],
	[".md", "text/markdown"],
	[".json", "application/json"],
	[".csv", "text/csv"],
	[".ts", "text/typescript"],
	[".tsx", "text/typescript"],
	[".js", "text/javascript"],
	[".jsx", "text/javascript"],
	[".css", "text/css"],
	[".html", "text/html"],
	[".xml", "application/xml"],
	[".yaml", "application/yaml"],
	[".yml", "application/yaml"],
]);

const EXTENSION_BY_MIME = new Map([
	["image/png", ".png"],
	["image/jpeg", ".jpg"],
	["image/webp", ".webp"],
	["application/pdf", ".pdf"],
	["text/plain", ".txt"],
	["text/markdown", ".md"],
	["application/json", ".json"],
	["text/csv", ".csv"],
	["text/typescript", ".ts"],
	["application/typescript", ".ts"],
	["text/javascript", ".js"],
	["application/javascript", ".js"],
	["text/css", ".css"],
	["text/html", ".html"],
	["application/xml", ".xml"],
	["text/xml", ".xml"],
	["application/yaml", ".yaml"],
	["text/yaml", ".yaml"],
]);

function safeName(value) {
	const name = String(value ?? "attachment")
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
		.trim()
		.slice(0, 120);
	return name || "attachment";
}

function resolveMimeType(input) {
	const requested = String(input?.type ?? "").toLowerCase().split(";")[0];
	if (EXTENSION_BY_MIME.has(requested)) {
		return requested;
	}

	const inferred = MIME_BY_EXTENSION.get(
		extname(String(input?.name ?? "")).toLowerCase(),
	);
	if (inferred) {
		return inferred;
	}

	throw new Error(
		"Unsupported attachment type. Use PNG, JPEG, WebP, PDF, or a common text/code file",
	);
}

function decodeDataUrl(input, mimeType) {
	const match = /^data:([^;,]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
		String(input?.dataUrl ?? ""),
	);
	if (!match) {
		throw new Error("Attachment data must be a valid Base64 data URL");
	}

	const encodedMime = match[1].toLowerCase().split(";")[0];
	const declaredMime = String(input?.type ?? "").toLowerCase().split(";")[0];
	if (
		encodedMime &&
		encodedMime !== "application/octet-stream" &&
		encodedMime !== mimeType &&
		encodedMime !== declaredMime
	) {
		throw new Error("Attachment MIME type does not match its encoded data");
	}
	if (match[2].length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4) {
		throw new Error("Attachment exceeds the 2 MB per-file limit");
	}

	const buffer = Buffer.from(match[2], "base64");
	if (buffer.length === 0) {
		throw new Error("Attachments cannot be empty");
	}
	if (buffer.length > MAX_ATTACHMENT_BYTES) {
		throw new Error("Attachment exceeds the 2 MB per-file limit");
	}
	if (
		Number.isFinite(input?.size) &&
		Number(input.size) !== buffer.length
	) {
		throw new Error("Attachment size does not match its encoded data");
	}
	validateFileSignature(buffer, mimeType);
	return buffer;
}

function validateFileSignature(buffer, mimeType) {
	const matches =
		mimeType === "image/png"
			? buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
			: mimeType === "image/jpeg"
				? buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
				: mimeType === "image/webp"
					? buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
						buffer.subarray(8, 12).toString("ascii") === "WEBP"
					: mimeType === "application/pdf"
						? buffer.subarray(0, 5).toString("ascii") === "%PDF-"
						: true;
	if (!matches) {
		throw new Error(`Attachment content does not match ${mimeType}`);
	}
}

function sessionFolder(sessionId) {
	const folder = String(sessionId)
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.slice(0, 100);
	if (!folder) {
		throw new Error("Attachment session id is invalid");
	}
	return folder;
}

export function publicAttachment(attachment) {
	return {
		id: attachment.id,
		name: attachment.name,
		type: attachment.type,
		size: attachment.size,
		kind: attachment.kind,
	};
}

export class AttachmentService {
	constructor(dataDirectory) {
		this.rootDirectory = join(dataDirectory, "attachments");
	}

	async save(sessionId, input) {
		if (input === undefined || input === null) {
			return [];
		}
		if (!Array.isArray(input)) {
			throw new Error("Attachments must be an array");
		}
		if (input.length > MAX_ATTACHMENT_COUNT) {
			throw new Error(`Attach no more than ${MAX_ATTACHMENT_COUNT} files`);
		}

		const prepared = input.map((attachment) => {
			const type = resolveMimeType(attachment);
			const buffer = decodeDataUrl(attachment, type);
			return {
				id: randomUUID(),
				name: safeName(attachment?.name),
				type,
				size: buffer.length,
				kind: type.startsWith("image/") ? "image" : "file",
				extension: EXTENSION_BY_MIME.get(type),
				buffer,
			};
		});
		const totalBytes = prepared.reduce(
			(total, attachment) => total + attachment.size,
			0,
		);
		if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
			throw new Error("Attachments exceed the 8 MB total limit");
		}

		const sessionDirectory = join(this.rootDirectory, sessionFolder(sessionId));
		await mkdir(sessionDirectory, { recursive: true });
		const saved = [];
		try {
			for (const attachment of prepared) {
				const path = join(
					sessionDirectory,
					`${attachment.id}${attachment.extension}`,
				);
				await writeFile(path, attachment.buffer, { flag: "wx" });
				saved.push({
					...publicAttachment(attachment),
					path,
					dataUrl: `data:${attachment.type};base64,${attachment.buffer.toString("base64")}`,
				});
			}
			return saved;
		} catch (error) {
			await Promise.all(
				saved.map((attachment) => rm(attachment.path, { force: true })),
			);
			throw error;
		}
	}

	async deleteSession(sessionId) {
		await rm(join(this.rootDirectory, sessionFolder(sessionId)), {
			recursive: true,
			force: true,
		});
	}
}
