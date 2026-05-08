import { env as privateEnv } from '$env/dynamic/private';
import type { PageServerLoad } from './$types.js';

/**
 * Pass the server's view of "is Google OAuth configured" to the page so the
 * UI button visibility matches the actual server-side enablement.
 *
 * Must mirror the env merge in hooks.server.ts (process.env → privateEnv →
 * platform.env). Picking only one source can hide the button when the
 * adapter-cloudflare platform polyfill is partial in dev/preview but the
 * secret is set in .env — backend would enable Google while the UI hides it.
 */
export const load: PageServerLoad = async ({ platform }) => {
	const env: Record<string, string | undefined> = {
		...(typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {}),
		...(privateEnv as Record<string, string | undefined>),
		...((platform?.env as Record<string, string | undefined> | undefined) ?? {}),
	};
	const googleEnabled = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
	return { googleEnabled };
};
