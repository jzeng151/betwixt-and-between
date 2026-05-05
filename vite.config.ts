import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * Vitest config — split into three named projects: `unit`, `integration`, `component`.
 *
 * Run all:                npm test
 * Run only unit:          npm test -- --project unit
 * Run only integration:   npm test -- --project integration
 * Run only component:     npm test -- --project component
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
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'component',
					environment: 'jsdom',
					include: ['tests/component/**/*.{test,spec}.{js,ts}'],
					setupFiles: ['./tests/component/setup.ts']
				},
				// Svelte 5 ships separate server/client builds via package.json
				// conditional exports. Without 'browser' here, Vite resolves
				// `svelte` to its server build and @testing-library/svelte's
				// `render()` calls the server `mount` which throws.
				resolve: {
					conditions: ['browser']
				}
			}
		]
	}
});
