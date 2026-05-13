import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { entities } from './db/schema.js';
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
 * reference an entity owned by the same user. Without this guard, knowing
 * another user's UUID is enough to attach a child row under their parent
 * (Codex P1, PR37). On delete, that triggers cross-user cascades.
 */
export async function assertParentOwned(
	db: Db,
	userId: string,
	parentId: string | null | undefined
): Promise<void> {
	if (!parentId) return;
	let row: { id: string } | undefined;
	try {
		[row] = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(eq(entities.id, parentId), eq(entities.userId, userId)));
	} catch {
		// Invalid uuid format etc. — parentId can't reference any row.
		error(400, 'Invalid parentId');
	}
	if (!row) error(400, 'parentId does not reference an entity owned by the current user');
}

export async function assertParentsOwned(
	db: Db,
	userId: string,
	parentIds: readonly string[]
): Promise<void> {
	if (parentIds.length === 0) return;
	let rows: { id: string }[];
	try {
		rows = await db
			.select({ id: entities.id })
			.from(entities)
			.where(and(inArray(entities.id, parentIds as string[]), eq(entities.userId, userId)));
	} catch {
		error(400, 'Invalid parentId');
	}
	if (rows.length !== parentIds.length) {
		error(400, 'parentId does not reference an entity owned by the current user');
	}
}
