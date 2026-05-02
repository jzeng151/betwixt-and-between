import type { APIRequestContext } from '@playwright/test';

/**
 * Shared destructive helper for e2e specs. Wipes every entity from the
 * DB the preview server is bound to.
 *
 * The load-bearing safety guarantee is in `tests/e2e/global-setup.ts`:
 * it boots an in-process PGlite over a localhost socket and stamps
 * `process.env.DATABASE_URL` before the preview spawns. The dev/prod
 * Neon DB is unreachable from the preview by construction.
 *
 * The check below is a sentinel for the case where someone runs this
 * helper outside Playwright (e.g., importing it from a node script).
 * If the setup hook never ran, refuse to wipe anything.
 *
 * Caveat: the sentinel only protects code that imports from THIS file.
 * The 17 legacy specs that still define their own inline `clearAll`
 * are not protected — they rely on global-setup pinning DATABASE_URL.
 * If a future spec is written that bypasses Playwright's globalSetup
 * (e.g. an ad-hoc node script copying the inline pattern), it could
 * still wipe whatever DB the env points at. Migrating those specs to
 * this shared helper is tracked as a follow-up.
 */
export async function clearAll(request: APIRequestContext): Promise<void> {
	if (process.env.BETWIXT_E2E_PGLITE !== '1') {
		throw new Error(
			'clearAll: BETWIXT_E2E_PGLITE sentinel is not set. This helper ' +
				'must run under playwright (which boots PGlite via global-setup). ' +
				'Refusing to wipe an unverified DB.'
		);
	}
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}
