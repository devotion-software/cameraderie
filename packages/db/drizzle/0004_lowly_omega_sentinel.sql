CREATE TABLE `webhook_events` (
	`id` varchar(160) NOT NULL,
	`provider` varchar(32) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`)
);
