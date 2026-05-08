import { env as privateEnv } from '$env/dynamic/private';
import type { PageServerLoad } from './$types.js';

/**
 * Pass the server's view of "is Google OAuth configured" to the page so the
 * UI button visibility matches the actual server-side enablement. Codex P2
 * fix: previously the page checked `VITE_GOOGLE_CLIENT_ID` (client-only build
 * env), but `buildAuth` reads `GOOGLE_CLIENT_ID` (server runtime env). With
 * only the documented `GOOGLE_CLIENT_ID` set, the backend enabled Google but
 * the button stayed hidden — feature appeared broken.
 *
 * On Cloudflare Workers, env comes from `platform.env`. In dev/preview, it
 * falls through to `$env/dynamic/private`. Either way, this load runs server-
 * side so the secret never reaches the browser.
 */
export const load: PageServerLoad = async ({ platform }) => {
	const env = (platform?.env ?? privateEnv) as Record<string, string | undefined>;
	const googleEnabled = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
	return { googleEnabled };
};
