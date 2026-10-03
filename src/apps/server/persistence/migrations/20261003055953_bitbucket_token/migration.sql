CREATE TABLE `bitbucket_token` (
	`account` text,
	`email` text,
	`singleton` integer PRIMARY KEY,
	`token` text NOT NULL,
	CONSTRAINT "bitbucket_token_singleton_check" CHECK("singleton" = 1)
);
