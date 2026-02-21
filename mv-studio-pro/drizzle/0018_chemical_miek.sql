CREATE TABLE `beta_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(16) NOT NULL,
	`quota` int NOT NULL DEFAULT 20,
	`klingLimit` int NOT NULL DEFAULT 1,
	`redeemedBy` int,
	`redeemedAt` timestamp,
	`batchId` varchar(32),
	`createdBy` int NOT NULL,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `beta_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `beta_codes_code_unique` UNIQUE(`code`)
);
