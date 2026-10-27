ALTER TABLE `groups` ADD `cover_media_id` varchar(64);--> statement-breakpoint
ALTER TABLE `groups` ADD CONSTRAINT `groups_cover_media_id_media_id_fk` FOREIGN KEY (`cover_media_id`) REFERENCES `media`(`id`) ON DELETE set null ON UPDATE no action;
