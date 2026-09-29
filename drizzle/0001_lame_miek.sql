CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`addon` text NOT NULL,
	`expires` integer NOT NULL,
	`subscription` text,
	`customer` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plans_owner_addon` ON `plans` (`owner`,`addon`);