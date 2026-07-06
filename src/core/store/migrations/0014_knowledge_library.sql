CREATE TABLE `document_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`text` text NOT NULL,
	`locator` text,
	`extraction_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_hash` text NOT NULL,
	`url` text,
	`local_path` text,
	`mime` text,
	`byte_size` integer,
	`title` text NOT NULL,
	`kind` text DEFAULT 'web' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`extractor_id` text,
	`extraction_version` integer DEFAULT 0 NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_content_hash_unique` ON `documents` (`content_hash`);--> statement-breakpoint
CREATE TABLE `learner_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`source_ids` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lesson_source_refs` (
	`concept_id` text NOT NULL,
	`document_id` integer NOT NULL,
	`chunk_ids` text DEFAULT '[]' NOT NULL,
	`locators` text DEFAULT '[]' NOT NULL,
	`rank` integer NOT NULL,
	`extraction_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`concept_id`, `document_id`),
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` integer NOT NULL,
	`scope` text NOT NULL,
	`topic_id` text,
	`origin` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`added_from_concept_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_doc_scope_topic` ON `sources` (`document_id`,`scope`,`topic_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `chunk_fts` USING fts5(`text`, content='document_chunks', content_rowid='id');--> statement-breakpoint
CREATE TRIGGER `chunk_fts_ai` AFTER INSERT ON `document_chunks` BEGIN
	INSERT INTO chunk_fts(rowid, text) VALUES (new.id, new.text);
END;--> statement-breakpoint
CREATE TRIGGER `chunk_fts_ad` AFTER DELETE ON `document_chunks` BEGIN
	INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;--> statement-breakpoint
CREATE TRIGGER `chunk_fts_au` AFTER UPDATE OF `text` ON `document_chunks` BEGIN
	INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES ('delete', old.id, old.text);
	INSERT INTO chunk_fts(rowid, text) VALUES (new.id, new.text);
END;