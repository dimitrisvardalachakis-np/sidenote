CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`reaction_id` text NOT NULL,
	`drug_id` text NOT NULL,
	`listedness` text NOT NULL,
	`expectedness` text NOT NULL,
	`ruling` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assessments_case_idx` ON `assessments` (`case_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_target_idx` ON `audit_log` (`target`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`origin` text NOT NULL,
	`received_at` text NOT NULL,
	`patient` text,
	`reporter` text,
	`narrative` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`assigned_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cases_reference_unique` ON `cases` (`reference`);--> statement-breakpoint
CREATE INDEX `cases_received_at_idx` ON `cases` (`received_at`);--> statement-breakpoint
CREATE INDEX `cases_status_idx` ON `cases` (`status`);--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`source_type` text NOT NULL,
	`section` text,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	`token_estimate` integer NOT NULL,
	`embedded_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunks_document_idx` ON `chunks` (`document_id`);--> statement-breakpoint
CREATE INDEX `chunks_source_type_idx` ON `chunks` (`source_type`);--> statement-breakpoint
CREATE INDEX `chunks_embedded_idx` ON `chunks` (`embedded_at`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`source_type` text NOT NULL,
	`active_substance` text NOT NULL,
	`version` text,
	`effective_date` text,
	`object_key` text,
	`status` text NOT NULL,
	`rejection_reason` text,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_source_type_idx` ON `documents` (`source_type`);--> statement-breakpoint
CREATE INDEX `documents_substance_idx` ON `documents` (`active_substance`);--> statement-breakpoint
CREATE INDEX `documents_uploaded_idx` ON `documents` (`uploaded_at`);--> statement-breakpoint
CREATE TABLE `drugs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`reported_name` text NOT NULL,
	`active_substance` text,
	`role` text NOT NULL,
	`marketing_status` text NOT NULL,
	`dose` text,
	`route` text,
	`indication` text,
	`therapy_start` text,
	`therapy_end` text,
	`dechallenge` text,
	`rechallenge` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drugs_case_idx` ON `drugs` (`case_id`);--> statement-breakpoint
CREATE INDEX `drugs_substance_idx` ON `drugs` (`active_substance`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`verbatim_term` text NOT NULL,
	`meddra_preferred_term` text,
	`onset` text,
	`outcome` text NOT NULL,
	`seriousness` text NOT NULL,
	`serious` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reactions_case_idx` ON `reactions` (`case_id`);--> statement-breakpoint
CREATE INDEX `reactions_serious_idx` ON `reactions` (`serious`);