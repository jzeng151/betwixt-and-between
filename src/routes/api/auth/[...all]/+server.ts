import type { RequestHandler } from './$types';

const handler: RequestHandler = ({ locals, request }) => locals.auth.handler(request);

export const GET = handler;
export const POST = handler;
