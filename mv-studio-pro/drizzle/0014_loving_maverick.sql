CREATE TABLE `user_verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`realName` varchar(100) NOT NULL,
	`idNumberMasked` varchar(20) NOT NULL,
	`idFrontUrl` text,
	`idBackUrl` text,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`adminNotes` text,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_verifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_verifications_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `video_platform_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoSubmissionId` int NOT NULL,
	`platform` enum('douyin','weixin_channels','xiaohongshu','bilibili') NOT NULL,
	`videoLink` text NOT NULL,
	`dataScreenshotUrl` text NOT NULL,
	`playCount` int,
	`likeCount` int,
	`commentCount` int,
	`shareCount` int,
	`verifyStatus` enum('pending','verified','rejected') NOT NULL DEFAULT 'pending',
	`verifyNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `video_platform_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `video_submissions` ADD `contentFingerprint` varchar(128);