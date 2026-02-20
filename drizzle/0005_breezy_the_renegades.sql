CREATE TABLE `comment_likes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`commentId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comment_likes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoUrl` text NOT NULL,
	`userId` int NOT NULL,
	`parentId` int,
	`content` text NOT NULL,
	`likesCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_likes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoUrl` text NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `video_likes_id` PRIMARY KEY(`id`)
);
