CREATE TABLE `author_avatar` (
	`email` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`image` text
);
--> statement-breakpoint
CREATE INDEX `author_avatar_expires_at` ON `author_avatar` (`expires_at`);