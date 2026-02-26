ALTER TABLE `users`
MODIFY COLUMN `role` enum('user','admin','free','beta','paid','supervisor') NOT NULL DEFAULT 'free';

