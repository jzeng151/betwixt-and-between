import { defineConfig, devices } from '@playwright/test';

// e2e specs run against a transient in-process PGlite (Postgres-WASM)
// served over the wire protocol on a free localhost port. globalSetup
// boots it, applies migrations, and stamps process.env.DATABASE_URL
// before the preview server spawns — so the preview can ONLY ever see
// the test DB, regardless of whatever DATABASE_URL is in .env.
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
		timeout: 60_000
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
