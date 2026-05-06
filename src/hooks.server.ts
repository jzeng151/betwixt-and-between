import { sequence } from '@sveltejs/kit/hooks';
import { auth, svelteKitHandler } from '$lib/server/auth.js';
import type { Handle } from '@sveltejs/kit';

const authHandle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({
		headers: event.request.headers,
	});

	if (session) {
		event.locals.user = session.user as App.Locals['user'];
		event.locals.session = session.session as App.Locals['session'];
	}

	return svelteKitHandler({ event, resolve, auth, building: import.meta.env.BUILDING });
};

export const handle: Handle = sequence(authHandle);
