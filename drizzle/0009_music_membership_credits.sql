CREATE TABLE IF NOT EXISTS `music_membership_credits` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `musicCredits` int NOT NULL DEFAULT 0,
  `packageCredits` int NOT NULL DEFAULT 0,
  `freeTrackCount` int NOT NULL DEFAULT 0,
  `freeSecondsUsed` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `music_membership_credits_id` PRIMARY KEY(`id`),
  CONSTRAINT `music_membership_credits_userId_unique` UNIQUE(`userId`)
);
