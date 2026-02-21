CREATE TABLE `mv_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mvId` varchar(64) NOT NULL,
	`nickname` varchar(100) NOT NULL,
	`rating` int NOT NULL,
	`comment` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mv_reviews_id` PRIMARY KEY(`id`)
);
