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
		const headers = new Headers();
		obj.writeHttpMetadata(headers);
		headers.set('cache-control', 'public, max-age=31536000, immutable');
		return new Response(obj.body, { headers });
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
