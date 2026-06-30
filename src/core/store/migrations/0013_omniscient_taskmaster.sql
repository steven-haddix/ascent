CREATE TABLE `lesson_drafts` (
	`concept_id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`status` text DEFAULT 'streaming' NOT NULL,
	`subtitle` text,
	`blocks` text DEFAULT '[]' NOT NULL,
	`discarded_block` text,
	`prompt` text,
	`failure_kind` text,
	`error` text,
	`recovery_hint` text,
	`finish_reason` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
