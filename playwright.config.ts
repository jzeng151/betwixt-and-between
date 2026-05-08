import { defineConfig, devices } from '@playwright/test';
import { PGLITE_URL } from './tests/e2e/pglite-config.js';

// webServer.env is injected into the preview subprocess at spawn time —
// before the subprocess calls server.init() / loadEnv(). If DATABASE_URL
// were set only in globalSetup (which runs AFTER the webServer plugin),
// the preview would have already initialised its db singleton with the
// Neon URL from .env and would silently wipe your real database on every
// test run.

export default defineConfig({
	globalSetup: './tests/e2e/global-setup.ts',
	webServer: {
		// Migrations were already applied to the PGlite DB in globalSetup,
		// so the webServer command skips db:migrate. The build is
		// essential — preview serves the static build artifacts.
		command: 'npm run build && npm run preview',
		port: 4173,
		// Always boot fresh: the PGlite instance dies at process exit,
		// so reusing a stale preview from a previous run would point at
		// a dead socket.
		reuseExistingServer: false,
		timeout: 60_000,
		// These land in the subprocess's process.env before vite preview
		// calls loadEnv(), so they override the Neon URL in .env.
		env: {
			DATABASE_URL: PGLITE_URL,
			BETWIXT_E2E_PGLITE: '1',
			// Even though BETWIXT_E2E_PGLITE bypasses the missing-secret guard
			// in buildAuth, Better-Auth still expects a secret to sign cookies.
			// Set a fixed test secret so signed cookies are stable across the
			// preview process and Playwright workers.
			BETTER_AUTH_SECRET: 'test-secret-deterministic-for-e2e-only',
			BETTER_AUTH_URL: 'http://localhost:4173'
		}
	},
	testDir: 'tests/e2e',
	// Tests share a single PGlite instance, so they must run serially
	// to avoid one test's beforeEach cleanup racing with another test's
	// data creation.
	workers: 1,
	projects: [
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] }
		}
	]
});
