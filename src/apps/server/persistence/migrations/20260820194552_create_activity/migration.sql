CREATE TABLE `authorization_metadata` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY,
	`label` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text,
	`role` text NOT NULL,
	CONSTRAINT "authorization_metadata_role_check" CHECK("role" IN ('reader', 'contributor', 'maintainer', 'owner'))
);
--> statement-breakpoint
CREATE TABLE `operation_activity` (
	`finished_at` text,
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT "operation_activity_status_check" CHECK("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_environment` (
	`automatic_port` integer,
	`id` text NOT NULL UNIQUE,
	`singleton` integer PRIMARY KEY,
	CONSTRAINT "environment_automatic_port_check" CHECK("automatic_port" BETWEEN 1 AND 65535),
	CONSTRAINT "environment_singleton_check" CHECK("singleton" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_environment`(`automatic_port`, `id`, `singleton`) SELECT `automatic_port`, `id`, `singleton` FROM `environment`;--> statement-breakpoint
DROP TABLE `environment`;--> statement-breakpoint
ALTER TABLE `__new_environment` RENAME TO `environment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `operation_activity_started_at` ON `operation_activity` ("started_at" DESC,"id" DESC);