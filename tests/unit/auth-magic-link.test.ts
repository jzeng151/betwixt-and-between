/**
 * deliverMagicLink fail-closed behavior (2026-06 security audit).
 *
 * The magic-link URL is a bearer sign-in credential. The audit fix refuses to
 * log or deliver it when email (Resend) is unconfigured outside dev, so a
 * built worker can't leak a sign-in credential to anyone reading
 * `wrangler tail` / Logpush. These tests pin every branch of that decision —
 * the load-bearing one being: non-dev + unconfigured throws AND does not log
 * the URL.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { deliverMagicLink } from '../../src/lib/server/auth.js';

const link = { email: 'user@example.com', url: 'https://app.example/magic?token=SECRET-BEARER' };

afterEach(() => {
	vi.restoreAllMocks();
});

describe('deliverMagicLink', () => {
	it('returns without sending or logging in test mode', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		await expect(
			deliverMagicLink({ env: {}, isTest: true, isDev: false, ...link })
		).resolves.toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('fails closed when Resend is unconfigured outside dev — no log, no send', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		await expect(
			deliverMagicLink({ env: {}, isTest: false, isDev: false, ...link })
		).rejects.toThrow(/refusing to deliver a magic link outside dev/);
		// The bearer credential must never reach the logs in a built worker.
		expect(logSpy).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('logs the link and returns in dev when Resend is unconfigured', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		await expect(
			deliverMagicLink({ env: {}, isTest: false, isDev: true, ...link })
		).resolves.toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SECRET-BEARER'));
	});

	it('POSTs to Resend when configured', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 200 }));
		await deliverMagicLink({
			env: { RESEND_API_KEY: 'rk', RESEND_FROM_EMAIL: 'no-reply@app.example' },
			isTest: false,
			isDev: false,
			...link,
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://api.resend.com/emails',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('throws when Resend returns a non-ok status', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(
			deliverMagicLink({
				env: { RESEND_API_KEY: 'rk', RESEND_FROM_EMAIL: 'no-reply@app.example' },
				isTest: false,
				isDev: false,
				...link,
			})
		).rejects.toThrow(/Resend send failed: 500/);
	});
});
