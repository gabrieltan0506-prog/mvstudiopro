CREATE TABLE `content_usage_agreements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agreedToTerms` boolean NOT NULL DEFAULT false,
	`agreedAt` timestamp,
	`allowPlatformDisplay` boolean NOT NULL DEFAULT true,
	`allowMarketingUse` boolean NOT NULL DEFAULT true,
	`allowModelTraining` boolean NOT NULL DEFAULT true,
	`preferAnonymous` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `content_usage_agreements_id` PRIMARY KEY(`id`),
	CONSTRAINT `content_usage_agreements_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `payment_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`transactionType` enum('storyboard_pack','analysis_pack','avatar_pack','student_subscription') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(10) NOT NULL DEFAULT 'USD',
	`paymentMethod` varchar(50) NOT NULL,
	`paymentId` varchar(255) NOT NULL,
	`status` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `student_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`subscriptionType` enum('halfYear','fullYear') NOT NULL,
	`status` enum('pending','active','expired','cancelled') NOT NULL DEFAULT 'pending',
	`startDate` timestamp,
	`endDate` timestamp,
	`price` decimal(10,2) NOT NULL,
	`paymentMethod` varchar(50),
	`paymentId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `student_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `student_subscriptions_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `student_verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`studentIdImageUrl` varchar(500),
	`schoolEmail` varchar(320) NOT NULL,
	`schoolEmailVerified` boolean NOT NULL DEFAULT false,
	`verificationCode` varchar(10),
	`verificationExpiry` timestamp,
	`educationLevel` enum('elementary','middle','high','university') NOT NULL,
	`schoolName` varchar(255),
	`verificationStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`rejectionReason` text,
	`verifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `student_verifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `student_verifications_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `usage_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`featureType` enum('storyboard','analysis','avatar') NOT NULL,
	`usageCount` int NOT NULL DEFAULT 0,
	`lastResetAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usage_tracking_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_phones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`phoneNumber` varchar(20) NOT NULL,
	`verified` boolean NOT NULL DEFAULT false,
	`verificationCode` varchar(10),
	`verificationExpiry` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_phones_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_phones_phoneNumber_unique` UNIQUE(`phoneNumber`)
);
