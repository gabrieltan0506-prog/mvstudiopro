CREATE TABLE `video_signatures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`videoUrl` text NOT NULL,
	`signatureHash` varchar(128) NOT NULL,
	`source` enum('original','remix') NOT NULL DEFAULT 'original',
	`videoGenerationId` int,
	`originalVideoUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `video_signatures_id` PRIMARY KEY(`id`)
);
