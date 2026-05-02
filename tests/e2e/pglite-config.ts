// Shared PGlite connection constants for playwright.config.ts and global-setup.ts.
// Both files must agree on the port. Using a fixed port (not 0) is required because
// playwright.config.ts must know the DATABASE_URL statically — it is evaluated before
// globalSetup runs, so a dynamically-assigned port is not available at config time.
export const PGLITE_PORT = 54329;
export const PGLITE_URL = `postgres://test:test@127.0.0.1:${PGLITE_PORT}/postgres`;
