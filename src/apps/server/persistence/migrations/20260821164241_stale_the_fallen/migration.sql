CREATE TABLE `authorization_capability` (
	`authorization_id` text NOT NULL,
	`capability` text NOT NULL,
	CONSTRAINT `authorization_capability_pk` PRIMARY KEY(`authorization_id`, `capability`),
	CONSTRAINT `fk_authorization_capability_authorization_id_authorization_metadata_id_fk` FOREIGN KEY (`authorization_id`) REFERENCES `authorization_metadata`(`id`) ON DELETE CASCADE,
	CONSTRAINT "authorization_capability_value_check" CHECK("capability" IN ('environment.read', 'repository.read', 'repository.write', 'history.rewrite', 'worktree.manage', 'authorization.manage', 'environment.manage'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_authorization_metadata` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY,
	`label` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text,
	`role` text NOT NULL,
	CONSTRAINT "authorization_metadata_role_check" CHECK("role" IN ('viewer', 'contributor', 'maintainer', 'owner', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_authorization_metadata`(`created_at`, `id`, `label`, `last_seen_at`, `revoked_at`, `role`) SELECT `created_at`, `id`, `label`, `last_seen_at`, `revoked_at`, CASE `role` WHEN 'reader' THEN 'viewer' ELSE `role` END FROM `authorization_metadata`;--> statement-breakpoint
DROP TABLE `authorization_metadata`;--> statement-breakpoint
ALTER TABLE `__new_authorization_metadata` RENAME TO `authorization_metadata`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
