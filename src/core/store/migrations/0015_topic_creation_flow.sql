ALTER TABLE `sources` ADD `role` text DEFAULT 'reference' NOT NULL;--> statement-breakpoint
ALTER TABLE `topics` ADD `status` text DEFAULT 'ready' NOT NULL;