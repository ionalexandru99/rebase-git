CREATE TABLE `repository_setting` (
	`pull_strategy` text NOT NULL,
	`repository_id` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `server_setting` (
	`pull_strategy` text DEFAULT 'ask' NOT NULL,
	`singleton` integer PRIMARY KEY,
	CONSTRAINT "server_setting_singleton_check" CHECK("singleton" = 1)
);
