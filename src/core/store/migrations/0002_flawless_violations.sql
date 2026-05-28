CREATE TABLE `teach_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`audience` text NOT NULL,
	`text` text NOT NULL,
	`rubric` text NOT NULL,
	`verdict` text NOT NULL,
	`annotations` text DEFAULT '[]' NOT NULL,
	`gaps` text DEFAULT '[]' NOT NULL,
	`mastery_delta` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
