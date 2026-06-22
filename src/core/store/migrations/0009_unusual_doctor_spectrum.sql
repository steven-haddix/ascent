CREATE TABLE `media_assets` (
	`concept_id` text NOT NULL,
	`media_id` text NOT NULL,
	`kind` text DEFAULT 'image' NOT NULL,
	`provider_id` text,
	`query` text NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`local_path` text,
	`width` integer,
	`height` integer,
	`license` text,
	`attribution` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`concept_id`, `media_id`),
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
