import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	webServer: {
		// Run the preview server against the DATABASE_URL the test runner
		// inherits from the environment (typically a Neon test branch or
		// the local docker Postgres). The per-spec clearAll() in e2e
		// fixtures wipes ALL data from this database before each test —
		// do NOT point this at a database with data you care about.
		command: 'npm run db:migrate && npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	},
	testDir: 'tests/e2e',
	// Tests share a single Postgres database, so they must run serially to avoid
	// one test's beforeEach cleanup racing with another test's data creation.
	workers: 1,
	projects: [
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] }
		}
	]
});
