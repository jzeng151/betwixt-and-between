// Shared PGlite connection constants for playwright.config.ts and global-setup.ts.
// Both files must agree on the port. Using a fixed port (not 0) is required because
// playwright.config.ts must know the DATABASE_URL statically — it is evaluated before
// globalSetup runs, so a dynamically-assigned port is not available at config time.
export const PGLITE_PORT = 54329;
export const PGLITE_URL = `postgres://test:test@127.0.0.1:${PGLITE_PORT}/postgres`;

// Fixed UUID for the default E2E test user. Seeded once in global-setup; every
// spec uses this id as the `x-test-user-id` header so existing specs don't
// need per-test seeding (T8b S8'). The header is honored only when
// BETWIXT_E2E_PGLITE=1 — the bypass is gated to test mode in hooks.server.ts.
export const E2E_USER_ID = '00000000-0000-0000-0000-00000000e2e0';
export const E2E_USER_EMAIL = 'e2e@test.com';
export const E2E_USER_HEADERS = { 'x-test-user-id': E2E_USER_ID };
