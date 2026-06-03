/**
 * Shared fetch-error helper for the Phase 3 preferences client modules
 * (profiles + presets). Turns a non-2xx Response into an Error carrying the
 * status + the server's `{ message }` (SvelteKit `error()` body) so the UI can
 * show an inline reason and branch on status.
 */
export async function ensureOk(res: Response, fallback: string): Promise<Response> {
	if (res.ok) return res;
	let message = `${fallback} (${res.status})`;
	try {
		const body = (await res.json()) as { message?: unknown };
		if (typeof body?.message === 'string') message = body.message;
	} catch {
		// non-JSON body — keep the fallback.
	}
	const err = new Error(message) as Error & { status: number };
	err.status = res.status;
	throw err;
}
