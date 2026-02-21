CREATE TABLE `kpi_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`mrr` int NOT NULL DEFAULT 0,
	`totalSubscribers` int NOT NULL DEFAULT 0,
	`proCount` int NOT NULL DEFAULT 0,
	`enterpriseCount` int NOT NULL DEFAULT 0,
	`freeCount` int NOT NULL DEFAULT 0,
	`trialCount` int NOT NULL DEFAULT 0,
	`newSubscribers` int NOT NULL DEFAULT 0,
	`churnedSubscribers` int NOT NULL DEFAULT 0,
	`trialToPaidConversions` int NOT NULL DEFAULT 0,
	`totalCreditsConsumed` int NOT NULL DEFAULT 0,
	`totalRevenue` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kpi_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stripe_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`eventType` varchar(100) NOT NULL,
	`eventId` varchar(255),
	`stripeCustomerId` varchar(255),
	`stripeSubscriptionId` varchar(255),
	`action` varchar(100) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'success',
	`amount` int,
	`currency` varchar(10) DEFAULT 'usd',
	`metadata` text,
	`errorMessage` text,
	`ipAddress` varchar(45),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stripe_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stripe_invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stripeInvoiceId` varchar(255) NOT NULL,
	`stripeCustomerId` varchar(255) NOT NULL,
	`status` varchar(30) NOT NULL,
	`amountDue` int NOT NULL DEFAULT 0,
	`amountPaid` int NOT NULL DEFAULT 0,
	`currency` varchar(10) NOT NULL DEFAULT 'usd',
	`invoiceUrl` text,
	`invoicePdf` text,
	`billingReason` varchar(50),
	`periodStart` timestamp,
	`periodEnd` timestamp,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stripe_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_invoices_stripeInvoiceId_unique` UNIQUE(`stripeInvoiceId`)
);
