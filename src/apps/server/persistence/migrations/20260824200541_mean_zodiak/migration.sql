CREATE TABLE `repository_catalog` (
	`added_at` text NOT NULL,
	`id` text PRIMARY KEY,
	`last_opened_at` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL UNIQUE,
	CONSTRAINT "repository_catalog_name_check" CHECK(length("name") BETWEEN 1 AND 255),
	CONSTRAINT "repository_catalog_path_check" CHECK(length("path") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE INDEX `repository_catalog_last_opened_at` ON `repository_catalog` ("last_opened_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX `repository_catalog_name` ON `repository_catalog` (`name`,`path`);