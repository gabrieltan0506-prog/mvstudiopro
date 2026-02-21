ALTER TABLE `email_auth` ADD `email_verified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `email_auth` ADD `verification_token` varchar(255);--> statement-breakpoint
ALTER TABLE `email_auth` ADD `verification_token_expiry` timestamp;