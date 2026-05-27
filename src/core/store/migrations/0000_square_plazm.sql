CREATE TABLE `chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`attachments` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`mastery` real DEFAULT 0 NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'outline' NOT NULL,
	`remedial` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`concept_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`blocks` text NOT NULL,
	`suggested_branches` text DEFAULT '[]' NOT NULL,
	`lenses` text DEFAULT '[]' NOT NULL,
	`model` text,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`root_concept_id` text,
	`created_at` integer NOT NULL
);
