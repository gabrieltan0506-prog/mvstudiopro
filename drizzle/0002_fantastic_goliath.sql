CREATE TABLE `video_generations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storyboardId` int,
	`prompt` text NOT NULL,
	`imageUrl` text,
	`videoUrl` text,
	`quality` enum('fast','standard') NOT NULL DEFAULT 'fast',
	`resolution` varchar(10) NOT NULL DEFAULT '720p',
	`aspectRatio` varchar(10) NOT NULL DEFAULT '16:9',
	`emotionFilter` varchar(50),
	`transition` varchar(50),
	`status` enum('pending','generating','completed','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`creditsUsed` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `video_generations_id` PRIMARY KEY(`id`)
);
