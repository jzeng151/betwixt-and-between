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
	try {
		const { left, right } = await splitInterval(db, params.id, atPosition);
		return json({ left, right });
	} catch (err) {
		error(400, (err as Error).message);
	}
};
