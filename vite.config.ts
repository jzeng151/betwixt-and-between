import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * Vitest config — split into two named projects: `unit` and `integration`.
 *
 * Run all:                npm test
 * Run only unit:          npm test -- --project unit
 * Run only integration:   npm test -- --project integration
 *
 * E2E tests (Playwright) live at tests/e2e/ and have their own config.
 */
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['tests/unit/**/*.{test,spec}.{js,ts}']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					include: ['tests/integration/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
