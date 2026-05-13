import { createAuthClient } from 'better-auth/svelte';
import { magicLinkClient } from 'better-auth/client/plugins';

/**
 * Browser auth client. baseURL resolves at runtime from `window.location.origin`
 * so the deployed Worker URL is used in production without a separate
 * `VITE_BETTER_AUTH_URL` build-time secret. Falls back to localhost only when
 * `window` is unavailable (SSR import). Codex P1 fix: previous hardcoded
 * `'http://localhost:5173'` fallback would silently route prod auth to a
 * non-existent local endpoint when env was unset.
 */
const baseURL =
	typeof window !== 'undefined'
		? window.location.origin
		: 'http://localhost:5173';

export const authClient = createAuthClient({
	baseURL,
	plugins: [magicLinkClient()],
});
