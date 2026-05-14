import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

// Serve map images. Prod: R2 (MAP_UPLOADS binding). Dev: local static/maps/.
// Filename is owner-scoped via the upload route's `${mapId}_${timestamp}.${ext}`
// pattern, but this endpoint is public-read by design — map images are the
// background for the World Map app and rendered by <img>/leaflet without
// session cookies. If we ever need to gate them, look up the owning map row
// here and check getUserId(event) before returning the bytes.
export const GET: RequestHandler = async (event) => {
	const { filename } = event.params;

	// Reject path traversal.
	if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
		error(400, 'Invalid filename');
	}

	const bucket = event.platform?.env?.MAP_UPLOADS;
	if (bucket) {
		const obj = await bucket.get(filename);
		if (!obj) error(404, 'Not found');
		// Build headers from httpMetadata directly. We previously used
		// obj.writeHttpMetadata(headers), but in `vite dev` with adapter-
		// cloudflare's platform proxy that method is RPC-bridged through
		// miniflare and fails on the Headers arg ("Cannot stringify
		// arbitrary non-POJOs"). httpMetadata is a POJO so reads cleanly.
		return new Response(obj.body, {
			headers: {
				'content-type': obj.httpMetadata?.contentType ?? contentTypeFor(filename),
				'cache-control': 'public, max-age=31536000, immutable',
			},
		});
	}

	try {
		const buf = await readFile(join(process.cwd(), 'static', 'maps', filename));
		return new Response(new Uint8Array(buf), {
			headers: {
				'content-type': contentTypeFor(filename),
				'cache-control': 'public, max-age=31536000, immutable',
			},
		});
	} catch {
		error(404, 'Not found');
	}
};

function contentTypeFor(name: string): string {
	const ext = name.split('.').pop()?.toLowerCase();
	if (ext === 'png') return 'image/png';
	if (ext === 'webp') return 'image/webp';
	return 'image/jpeg';
}
