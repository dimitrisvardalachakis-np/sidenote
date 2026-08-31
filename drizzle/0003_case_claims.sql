CREATE TABLE `claims` (
	`case_id` text PRIMARY KEY NOT NULL,
	`reviewer_id` text NOT NULL,
	`display_name` text NOT NULL,
	`held_since` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
