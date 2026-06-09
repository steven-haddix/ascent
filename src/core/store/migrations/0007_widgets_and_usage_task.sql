CREATE TABLE `widgets` (
	`concept_id` text NOT NULL,
	`widget_id` text NOT NULL,
	`title` text NOT NULL,
	`spec` text NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`source` text,
	`compiled` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`concept_id`, `widget_id`),
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `usage_events` ADD `task` text;