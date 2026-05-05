import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { worldMaps } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const POST: RequestHandler = async ({ params, request }) => {
	// Verify map exists
	const [map] = await db.select().from(worldMaps).where(eq(worldMaps.id, params.id));
	if (!map) error(404, 'Map not found');

	const formData = await request.formData();
	const file = formData.get('file');
	if (!file || !(file instanceof File)) {
		error(400, 'No file provided');
	}

	if (!ALLOWED_TYPES.has(file.type)) {
		error(400, 'File must be JPG, PNG, or WebP');
	}
	if (file.size > MAX_BYTES) {
		error(400, 'File must be under 5 MB');
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const dimensions = readImageDimensions(buffer, file.type);
	if (!dimensions) {
		error(400, 'Could not read image dimensions');
	}

	// Write to static/maps/
	const dir = join(process.cwd(), 'static', 'maps');
	await mkdir(dir, { recursive: true });

	const ext = file.name.split('.').pop() || 'png';
	const filename = `${params.id}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
	const filepath = join(dir, filename);
	await writeFile(filepath, buffer);

	const baseImageUrl = `/maps/${filename}`;

	const [updated] = await db
		.update(worldMaps)
		.set({ baseImageUrl, width: dimensions.width, height: dimensions.height })
		.where(eq(worldMaps.id, params.id))
		.returning();

	return json(updated);
};

/**
 * Read width/height from image file headers without external dependencies.
 * Supports JPEG (SOF0/SOF2), PNG (IHDR), and WebP (VP8/VP8L).
 */
function readImageDimensions(
	buf: Buffer,
	mime: string
): { width: number; height: number } | null {
	if (mime === 'image/png') {
		// PNG: IHDR chunk starts at byte 16 (after 8-byte sig + 4-byte length + 4-byte type)
		if (buf.length < 24) return null;
		const width = buf.readUInt32BE(16);
		const height = buf.readUInt32BE(20);
		return { width, height };
	}

	if (mime === 'image/jpeg') {
		// JPEG: scan for SOF0 (FF C0) or SOF2 (FF C2) marker
		let offset = 2; // skip FF D8
		while (offset < buf.length - 9) {
			if (buf[offset] !== 0xff) break;
			const marker = buf[offset + 1];
			if (marker === 0xc0 || marker === 0xc2) {
				const height = buf.readUInt16BE(offset + 5);
				const width = buf.readUInt16BE(offset + 7);
				return { width, height };
			}
			// Skip to next marker (length is big-endian at offset+2)
			if (marker === 0xd8 || marker === 0xd9) break;
			const segLen = buf.readUInt16BE(offset + 2);
			offset += 2 + segLen;
		}
		return null;
	}

	if (mime === 'image/webp') {
		// WebP: RIFF header at 0, VP8/VP8L bitstream at 12+
		if (buf.length < 30) return null;
		const chunkFourCC = buf.toString('ascii', 12, 16);
		if (chunkFourCC === 'VP8 ') {
			// Lossy: width/height are 14-bit LE at offset 26/28
			const width = buf.readUInt16LE(26) & 0x3fff;
			const height = buf.readUInt16LE(28) & 0x3fff;
			return { width, height };
		}
		if (chunkFourCC === 'VP8L') {
			// Lossless: 28-bit packed at offset 21
			const b = buf.readUInt32LE(21);
			const width = (b & 0x3fff) + 1;
			const height = ((b >> 14) & 0x3fff) + 1;
			return { width, height };
		}
		return null;
	}

	return null;
}
