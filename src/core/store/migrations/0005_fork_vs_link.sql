ALTER TABLE `lessons` RENAME COLUMN `suggested_branches` TO `suggested_forks`;--> statement-breakpoint
ALTER TABLE `lessons` ADD `suggested_lessons` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE TABLE `concept_links` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`source_concept_id` text NOT NULL,
	`target_concept_id` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_links_src_tgt` ON `concept_links` (`source_concept_id`,`target_concept_id`);