// Wrap SvelteKit's event.request.json() in a 400-on-malformed shim so
// every API handler returns the same clean error code on garbage bodies.
// Without this, JSON.parse throws SyntaxError → SvelteKit surfaces 500.
// Cheap and consistent; route through this from every POST/PATCH handler
// that takes a JSON body.

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function readJson(event: RequestEvent): Promise<unknown> {
	try {
		return await event.request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}
}
