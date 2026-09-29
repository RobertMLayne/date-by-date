CREATE TABLE `billing_accounts` (
	`owner` text PRIMARY KEY NOT NULL,
	`customer` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `plans` ADD `updated` integer DEFAULT 0 NOT NULL;