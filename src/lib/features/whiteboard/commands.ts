import { writable } from 'svelte/store';

export type WhiteboardCommand = {
	id: string;
	name: string;
	disabled?: boolean;
	run: () => void;
};

export const whiteboardCommands = writable<WhiteboardCommand[]>([]);
