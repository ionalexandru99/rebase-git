CREATE TABLE `environment` (
	`automatic_port` integer,
	`id` text NOT NULL UNIQUE,
	`singleton` integer PRIMARY KEY
);
