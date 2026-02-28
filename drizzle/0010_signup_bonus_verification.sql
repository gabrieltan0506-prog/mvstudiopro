ALTER TABLE `users`
  ADD COLUMN `credits` int NOT NULL DEFAULT 0,
  ADD COLUMN `roleTag` enum('normal','student','teacher','military_police') NOT NULL DEFAULT 'normal',
  ADD COLUMN `contactWechat` varchar(120),
  ADD COLUMN `contactPhone` varchar(30),
  ADD COLUMN `verifyStatus` enum('none','pending','approved','rejected') NOT NULL DEFAULT 'none';

CREATE TABLE `credit_ledger` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `delta` int NOT NULL,
  `reason` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `credit_ledger_id` PRIMARY KEY(`id`)
);
