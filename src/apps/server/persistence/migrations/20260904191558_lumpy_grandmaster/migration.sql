ALTER TABLE `repository_catalog` ADD `git_common_directory` text;--> statement-breakpoint
ALTER TABLE `repository_catalog` ADD `logical_repository_id` text;--> statement-breakpoint
CREATE INDEX `repository_catalog_logical_repository_id` ON `repository_catalog` (`logical_repository_id`);