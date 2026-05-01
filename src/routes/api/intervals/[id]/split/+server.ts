import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { splitInterval } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const atPosition = body.atPosition ?? body.at_position;
	if (typeof atPosition !== 'number' || !Number.isFinite(atPosition)) {
		error(400, 'atPosition must be a finite number');
	}
	// Wrap in db.transaction so a crash between the UPDATE (left half) and
	// INSERT (right half) rolls both back. splitInterval's contract requires
	// this wrap; calling it on the top-level pool would leave the two writes
	// non-atomic — exactly the failure mode intervals-split-atomicity.test.ts
	// guards against.
	try {
		const { left, right } = await db.transaction(async (tx) =>
			splitInterval(tx, params.id, atPosition)
		);
		return json({ left, right });
	} catch (err) {
		error(400, (err as Error).message);
	}
};
