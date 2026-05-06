import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export function requireUser(event: RequestEvent) {
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');
	return user;
}

export function getUserId(event: RequestEvent): string {
	return requireUser(event).id;
}
