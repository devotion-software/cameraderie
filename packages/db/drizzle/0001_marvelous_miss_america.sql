CREATE TABLE `reports` (
	`id` varchar(64) NOT NULL,
	`media_id` varchar(64) NOT NULL,
	`reporter_id` varchar(64) NOT NULL,
	`reason` varchar(500) NOT NULL,
	`status` enum('open','actioned','dismissed') NOT NULL DEFAULT 'open',
	`reviewed_by` varchar(64),
	`reviewed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `reports_media_reporter_uq` UNIQUE(`media_id`,`reporter_id`)
);
--> statement-breakpoint
ALTER TABLE `groups` ADD `strip_exif_from_previews` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `role` varchar(32) DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporter_id_user_id_fk` FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_reviewed_by_user_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`,`created_at`);