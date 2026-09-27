PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_authorization_metadata` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY,
	`label` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
INSERT INTO `__new_authorization_metadata`(`created_at`, `id`, `label`, `last_seen_at`, `revoked_at`) SELECT `created_at`, `id`, `label`, `last_seen_at`, `revoked_at` FROM `authorization_metadata`;--> statement-breakpoint
DROP TABLE `authorization_metadata`;--> statement-breakpoint
ALTER TABLE `__new_authorization_metadata` RENAME TO `authorization_metadata`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP TABLE `authorization_capability`;