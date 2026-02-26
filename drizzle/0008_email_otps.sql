CREATE TABLE `email_otps` (
  `id` int AUTO_INCREMENT NOT NULL,
  `email` varchar(255) NOT NULL,
  `otp_hash` varchar(128) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `used` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `email_otps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `email_otps_email_created_idx` ON `email_otps` (`email`,`created_at`);
--> statement-breakpoint
CREATE INDEX `email_otps_email_used_expires_idx` ON `email_otps` (`email`,`used`,`expires_at`);
