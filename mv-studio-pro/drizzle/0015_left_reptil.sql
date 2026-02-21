CREATE TABLE `maintenance_notices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`startTime` timestamp NOT NULL,
	`endTime` timestamp NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `maintenance_notices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `showcase_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`videoSubmissionId` int NOT NULL,
	`content` text NOT NULL,
	`parentId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `showcase_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `showcase_favorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`videoSubmissionId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `showcase_favorites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `showcase_likes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`videoSubmissionId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `showcase_likes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `traffic_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hourBucket` timestamp NOT NULL,
	`requestCount` int NOT NULL DEFAULT 0,
	`uniqueUsers` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `traffic_stats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `usage_tracking` MODIFY COLUMN `featureType` enum('storyboard','analysis','avatar','videoGeneration') NOT NULL;