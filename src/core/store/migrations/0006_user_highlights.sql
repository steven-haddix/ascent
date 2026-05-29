CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`exact` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`suffix` text DEFAULT '' NOT NULL,
	`gloss` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
