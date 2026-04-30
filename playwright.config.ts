import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	webServer: {
		// Run the preview server against test.db so the e2e suite's
		// per-spec clearAll() doesn't wipe the dev database (local.db).
		// Tests run serially → one shared file is fine. CI containers are
		// ephemeral so the file disappears with the runner.
		command: 'npm run db:migrate && npm run build && npm run preview',
		env: { DATABASE_URL: 'test.db' },
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	},
	testDir: 'tests/e2e',
	// Tests share a single SQLite database, so they must run serially to avoid
	// one test's beforeEach cleanup racing with another test's data creation.
	workers: 1,
	projects: [
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] }
		}
	]
});
