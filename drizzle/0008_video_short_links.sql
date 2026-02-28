CREATE TABLE IF NOT EXISTS `video_short_links` (
  `taskId` varchar(128) NOT NULL,
  `videoUrl` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `video_short_links_taskId` PRIMARY KEY(`taskId`)
);
