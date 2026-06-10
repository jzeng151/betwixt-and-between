/**
 * 2026-06 audit — data.style.icon scheme allowlist.
 *
 * The icon value lands in <img src> and PIXI.Assets.load; previously any
 * string was accepted. Allowed shapes: data:image/*, same-origin paths
 * starting with '/', and http(s) URLs. Protocol-relative ('//host') and
 * javascript:/data:text URLs are rejected.
 */
import { describe, it, expect } from 'vitest';
import { validateStyleOverride } from '../../src/lib/server/style-validation.js';

function statusOf(fn: () => void): number | null {
	try {
		fn();
		return null;
	} catch (err) {
		return (err as { status?: number }).status ?? -1;
	}
}

describe('style icon allowlist', () => {
	it.each([
		['data URL image', 'data:image/png;base64,iVBORw0KGgo='],
		['same-origin path', '/api/maps/file/abc.png'],
		['https URL', 'https://example.com/icon.png'],
		['http URL', 'http://example.com/icon.png']
	])('accepts %s', (_label, icon) => {
		expect(statusOf(() => validateStyleOverride({ icon }, 'test'))).toBeNull();
	});

	it('accepts explicit null (clear the override)', () => {
		expect(statusOf(() => validateStyleOverride({ icon: null }, 'test'))).toBeNull();
	});

	it.each([
		['javascript URL', 'javascript:alert(1)'],
		['data text/html URL', 'data:text/html,<script>1</script>'],
		['protocol-relative URL', '//evil.example/x.png'],
		['bare relative path', 'icons/x.png'],
		['custom scheme', 'app://internal/x.png']
	])('rejects %s with 400', (_label, icon) => {
		expect(statusOf(() => validateStyleOverride({ icon }, 'test'))).toBe(400);
	});
});
