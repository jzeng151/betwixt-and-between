import { getStoryId } from '$lib/server/auth-gate.js';
import { stories } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async (event) => {
	const { locals } = event;
	if (!locals.user) {
		throw redirect(302, '/auth/login');
	}
	const id = await getStoryId(event);
	const [story] = await locals.db.select().from(stories).where(eq(stories.id, id));
	return {
		story,
		user: locals.user,
	};
}
