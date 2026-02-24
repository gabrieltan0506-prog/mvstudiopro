CREATE TABLE `jobs` (
  `id` varchar(64) NOT NULL,
  `userId` varchar(64) NOT NULL,
  `type` enum('video','image','audio') NOT NULL,
  `provider` varchar(64) NOT NULL,
  `status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
  `input` json NOT NULL,
  `output` json,
  `error` text,
  `attempts` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
