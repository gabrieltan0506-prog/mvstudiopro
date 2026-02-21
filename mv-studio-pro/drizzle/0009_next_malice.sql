CREATE TABLE `beta_quotas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`totalQuota` int NOT NULL DEFAULT 0,
	`usedCount` int NOT NULL DEFAULT 0,
	`bonusQuota` int NOT NULL DEFAULT 0,
	`inviteCode` varchar(16) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`grantedBy` int NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `beta_quotas_id` PRIMARY KEY(`id`),
	CONSTRAINT `beta_quotas_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `beta_quotas_inviteCode_unique` UNIQUE(`inviteCode`)
);
--> statement-breakpoint
CREATE TABLE `beta_referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inviterUserId` int NOT NULL,
	`inviteeUserId` int NOT NULL,
	`inviteCode` varchar(16) NOT NULL,
	`bonusGranted` int NOT NULL DEFAULT 10,
	`status` enum('pending','completed','revoked') NOT NULL DEFAULT 'completed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `beta_referrals_id` PRIMARY KEY(`id`)
);
