DROP INDEX `concept_links_src_tgt`;--> statement-breakpoint
ALTER TABLE `concept_links` ADD `relation` text DEFAULT 'link' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `concept_links_src_tgt` ON `concept_links` (`source_concept_id`,`target_concept_id`,`relation`);