ALTER TABLE `reports` DROP FOREIGN KEY `reports_media_id_media_id_fk`;
--> statement-breakpoint
ALTER TABLE `reports` MODIFY COLUMN `media_id` varchar(64);--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE set null ON UPDATE no action;