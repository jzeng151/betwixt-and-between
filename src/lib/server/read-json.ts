// Wrap SvelteKit's event.request.json() in a 400-on-malformed shim so
// every API handler returns the same clean error code on garbage bodies.
// Without this, JSON.parse throws SyntaxError → SvelteKit surfaces 500.
//
// Beyond malformed JSON, the API contract in this project is that EVERY
// request body is a JSON object. Scalars (`null`, `42`, `"x"`) and arrays
// are not valid bodies for any current endpoint. Reject them at the
// boundary so handlers can safely do `body.field` without a guard, and
// so a request body like `null` doesn't reach `body.name` and surface a
// TypeError as a 500 (Codex PR54 re-review #1).
//
// readJson always returns Record<string, unknown>. Callers that need to
// strip the constraint (e.g. accept array bodies in a future bulk endpoint)
// should call event.request.json() directly with their own validation.

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function readJson(event: RequestEvent): Promise<Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = await event.request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		error(400, 'Request body must be a JSON object');
	}
	return parsed as Record<string, unknown>;
}
