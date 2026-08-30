ALTER TABLE `chunks` ADD `text_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `chunks_text_hash_idx` ON `chunks` (`text_hash`);