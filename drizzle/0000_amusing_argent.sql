CREATE TABLE `canvas_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 160 NOT NULL,
	`height` integer DEFAULT 80 NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_positions_entity_id_unique` ON `canvas_positions` (`entity_id`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`parent_id` text,
	`position` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entities_created_at_idx` ON `entities` (`created_at`);--> statement-breakpoint
CREATE INDEX `entities_parent_idx` ON `entities` (`parent_id`);--> statement-breakpoint
CREATE INDEX `entities_type_position_idx` ON `entities` (`type`,`position`);--> statement-breakpoint
CREATE TABLE `intervals` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`start_act_id` text NOT NULL,
	`start_scene_id` text,
	`end_act_id` text NOT NULL,
	`end_scene_id` text,
	`start_position` real NOT NULL,
	`end_position` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`start_act_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`start_scene_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`end_act_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`end_scene_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "intervals_position_order" CHECK("intervals"."start_position" < "intervals"."end_position")
);
--> statement-breakpoint
CREATE INDEX `intervals_entity_idx` ON `intervals` (`entity_id`);--> statement-breakpoint
CREATE INDEX `intervals_position_idx` ON `intervals` (`start_position`,`end_position`);--> statement-breakpoint
CREATE INDEX `intervals_start_scene_idx` ON `intervals` (`start_scene_id`);--> statement-breakpoint
CREATE INDEX `intervals_end_scene_idx` ON `intervals` (`end_scene_id`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`label` text,
	`type` text NOT NULL,
	FOREIGN KEY (`from_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
