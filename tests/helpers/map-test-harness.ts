// F33 — shared integration harness for the world-map-v3 suites. mkEvent /
// readJson / fillStroke were copy-pasted across every slice test; this is the
// canonical copy. (The existing slice-a/b/c suites still carry their own copies;
// migrating them is a low-risk follow-up — new suites should import from here.)
import type { createTestDb } from './test-db.js';
import type { PaintStrokePayload } from '../../src/lib/features/map/projection.js';

export type TestCtx = { db: Awaited<ReturnType<typeof createTestDb>>; userId: string };

/** Build a mock SvelteKit RequestEvent for direct handler invocation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mkEvent(
	ctx: TestCtx,
	overrides: { params?: Record<string, string>; body?: unknown } = {}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
	return {
		url: new URL('http://localhost/'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db: ctx.db,
			user: { id: ctx.userId, name: 'Test User', email: 'test@test.com', emailVerified: true }
		}
	};
}

export async function readJson(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

/** A valid happy-path fill stroke payload; override any field. */
export const fillStroke = (over: Partial<PaintStrokePayload> = {}): PaintStrokePayload => ({
	path: [
		{ x: 0.1, y: 0.1 },
		{ x: 0.2, y: 0.2 }
	],
	brushSize: 0.05,
	softness: 0.5,
	mode: 'fill',
	textureKey: 'Grass',
	...over
});
