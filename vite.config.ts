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
	// Build-time gate for the x-test-user-id bypass in src/hooks.server.ts.
	// True only when BETWIXT_E2E_PGLITE=1 is set in the build process env
	// (npm run dev:pglite, the Playwright preview subprocess). False for
	// `wrangler deploy`, so Rollup tree-shakes the bypass branch out of the
	// production worker bundle entirely — a runtime `wrangler secret put
	// BETWIXT_E2E_PGLITE 1` cannot resurrect deleted code.
	define: {
		__E2E_BYPASS__: JSON.stringify(process.env.BETWIXT_E2E_PGLITE === '1')
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
					// One unit test (intervals-math) uses createTestDb — its PGlite
					// boot competes with the integration project under parallel load.
					hookTimeout: 30000
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					include: ['tests/integration/**/*.{test,spec}.{js,ts}'],
					// PGlite WASM boot + 5 migrations exceeds the 10s default under
					// parallel load (~25 files × concurrent worker forks).
					hookTimeout: 30000
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
