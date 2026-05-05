import { sequence } from "@sveltejs/kit/hooks";

export const handle = sequence();

export const handleError = ({ error }: { error: unknown }) => {
	console.error(error);
};
