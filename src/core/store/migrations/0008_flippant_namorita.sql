CREATE TABLE `course_canon` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`spine` text DEFAULT '{"arc":"","order":[]}' NOT NULL,
	`notation` text DEFAULT '[]' NOT NULL,
	`motifs` text DEFAULT '[]' NOT NULL,
	`voice` text DEFAULT '{"tone":"","depth":"","pacing":""}' NOT NULL,
	`prereqs` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `lessons` ADD `digest` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `revised_at` integer;--> statement-breakpoint
ALTER TABLE `lessons` ADD `revised_reason` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `prev_snapshot` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `stale` integer DEFAULT false NOT NULL;