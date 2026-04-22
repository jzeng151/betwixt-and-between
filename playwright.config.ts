import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	},
	testDir: 'e2e',
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
