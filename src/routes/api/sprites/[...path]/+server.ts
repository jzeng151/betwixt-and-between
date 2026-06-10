import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

// Serve terrain tile sprites. Prod: R2 (TERRAIN_ASSETS binding). Dev: local
// static/Sprites/. Mirrors api/maps/file/[filename] — the licensed tile pack is
// NOT committed to this public repo, so it can't be a plain /Sprites/ static
// asset in prod; it lives in the betwitxt-assets R2 bucket and is streamed
// here. Public-read by design (terrain art rendered by the World Map canvas);
// the pack art is non-sensitive per-app content, not per-user data.
//
// `path` is the rest segment after /api/sprites/ (e.g.
// "Grass/grass_01/grass_01_tile_256_01.png") — both the R2 key and the dev
// file path under static/Sprites/.
export const GET: RequestHandler = async (event) => {
	const path = event.params.path ?? '';

	// Reject path traversal. Subdirectory slashes are allowed (nested tiles);
	// backslashes and `..` are not.
	if (path.includes('\\') || path.split('/').some((seg) => seg === '..' || seg === '')) {
		error(400, 'Invalid path');
	}

	// Unlike map uploads (written to R2 at runtime, so the local dev bucket is
	// populated), the terrain pack is only ever pushed to the prod bucket by
	// scripts/upload-terrain-assets.sh — `vite dev` / `dev:pglite` expose an
	// EMPTY local miniflare R2 binding. So a bucket MISS is the normal dev case:
	// fall through to the on-disk mirror rather than 404. In prod the bucket is
	// populated and this fallback never fires (no static/Sprites/ in the build).
	const bucket = event.platform?.env?.TERRAIN_ASSETS;
	if (bucket) {
		const obj = await bucket.get(path);
		if (obj) {
			// httpMetadata is a POJO (writeHttpMetadata(headers) breaks under the
			// dev platform proxy — see the maps route note).
			return new Response(obj.body, {
				headers: {
					'content-type': obj.httpMetadata?.contentType ?? contentTypeFor(path),
					'cache-control': 'public, max-age=31536000, immutable',
					'x-content-type-options': 'nosniff'
				}
			});
		}
		// fall through: empty dev bucket → serve the local mirror below
	}

	// Dev (or bucket miss): serve from the local (gitignored) pack mirror.
	try {
		const buf = await readFile(join(process.cwd(), 'static', 'Sprites', path));
		return new Response(new Uint8Array(buf), {
			headers: {
				'content-type': contentTypeFor(path),
				'cache-control': 'public, max-age=31536000, immutable',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch {
		error(404, 'Not found');
	}
};

function contentTypeFor(name: string): string {
	const ext = name.split('.').pop()?.toLowerCase();
	if (ext === 'png') return 'image/png';
	if (ext === 'webp') return 'image/webp';
	if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
	return 'application/octet-stream';
}
