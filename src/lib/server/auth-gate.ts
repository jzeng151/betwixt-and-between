import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { entities, stories } from './db/schema.js';
import { isUuid } from './validation.js';
import type { Db } from './intervals.js';

function requireUser(event: RequestEvent) {
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');
	return user;
}

export function getUserId(event: RequestEvent): string {
	return requireUser(event).id;
}

/**
 * Block cross-tenant FK links: if a request supplies a parentId, it must
 * reference an entity in the same story. Without this guard, knowing
 * another story's entity UUID is enough to attach a child row under their parent
 * (Codex P1, PR37). On delete, that triggers cross-story cascades.
 */
export async function assertParentOwned(
	db: Db,
	storyId: string,
	parentId: string | null | undefined
): Promise<void> {
	if (!parentId) return;
	let row: { id: string } | undefined;
	try {
		[row] = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(eq(entities.id, parentId), eq(entities.storyId, storyId)));
	} catch {
		// Invalid uuid format etc. — parentId can't reference any row.
		error(400, 'Invalid parentId');
	}
	if (!row) error(400, 'parentId does not reference an entity owned by the current story');
}

export async function assertParentsOwned(
	db: Db,
	storyId: string,
	parentIds: readonly string[]
): Promise<void> {
	if (parentIds.length === 0) return;
	let rows: { id: string }[];
	try {
		rows = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(inArray(entities.id, parentIds as string[]), eq(entities.storyId, storyId)));
	} catch {
		error(400, 'Invalid parentId');
	}
	if (rows.length !== parentIds.length) {
		error(400, 'parentId does not reference an entity owned by the current story');
	}
}

/** Resolve a tab's explicit story; an omitted header keeps the original story. */
export async function getStoryId(event: RequestEvent): Promise<string> {
	const userId = getUserId(event);
	const id = event.request?.headers?.get('x-story-id') ?? event.url?.searchParams.get('story') ?? userId;
	if (!isUuid(id)) error(400, 'Invalid story id');
	const [story] = await event.locals.db.select({ id: stories.id }).from(stories)
		.where(and(eq(stories.id, id), eq(stories.userId, userId)));
	if (!story) error(404, 'Story not found');
	return story.id;
}
