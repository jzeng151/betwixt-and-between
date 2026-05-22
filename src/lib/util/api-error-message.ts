/**
 * Parse a non-OK fetch Response body for a human-readable error message.
 *
 * SvelteKit's `error()` helper returns JSON like { message: "..." }. Surfacing
 * the raw text into the UI shows users `{"message":"..."}`; lift the message
 * so the error copy reads naturally. Falls back to raw text when the body
 * isn't JSON or doesn't carry a string `message` field.
 */
export async function errorMessage(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			parsed &&
			typeof parsed === 'object' &&
			'message' in parsed &&
			typeof (parsed as Record<string, unknown>).message === 'string'
		) {
			return (parsed as { message: string }).message;
		}
	} catch {
		// fall through to raw text
	}
	return text;
}
