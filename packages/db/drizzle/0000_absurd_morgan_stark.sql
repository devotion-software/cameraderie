CREATE TABLE `account` (
	`id` varchar(64) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`provider_id` varchar(128) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`access_token` varchar(2048),
	`refresh_token` varchar(2048),
	`id_token` varchar(2048),
	`access_token_expires_at` timestamp,
	`refresh_token_expires_at` timestamp,
	`scope` varchar(512),
	`password` varchar(512),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `derivatives` (
	`id` varchar(64) NOT NULL,
	`media_id` varchar(64) NOT NULL,
	`kind` enum('thumbnail','preview') NOT NULL,
	`state` enum('pending','ready','failed') NOT NULL DEFAULT 'pending',
	`object_key` varchar(512) NOT NULL,
	`mime_type` varchar(255),
	`size_bytes` bigint,
	`width` int,
	`height` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `derivatives_id` PRIMARY KEY(`id`),
	CONSTRAINT `derivatives_media_kind_uq` UNIQUE(`media_id`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `favourites` (
	`id` varchar(64) NOT NULL,
	`media_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `favourites_id` PRIMARY KEY(`id`),
	CONSTRAINT `favourites_media_user_uq` UNIQUE(`media_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`description` varchar(500),
	`owner_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` varchar(64) NOT NULL,
	`group_id` varchar(64) NOT NULL,
	`code` varchar(32) NOT NULL,
	`created_by` varchar(64) NOT NULL,
	`max_uses` int,
	`uses` int NOT NULL DEFAULT 0,
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `invites_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` varchar(64) NOT NULL,
	`group_id` varchar(64) NOT NULL,
	`uploader_id` varchar(64) NOT NULL,
	`kind` enum('image','raw','video') NOT NULL,
	`state` enum('pending','uploading','processing','ready','failed') NOT NULL DEFAULT 'pending',
	`filename` varchar(255) NOT NULL,
	`mime_type` varchar(255),
	`size_bytes` bigint NOT NULL,
	`checksum_sha256` varchar(64) NOT NULL,
	`object_key` varchar(512) NOT NULL,
	`r2_upload_id` varchar(255),
	`width` int,
	`height` int,
	`duration_ms` int,
	`captured_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` varchar(64) NOT NULL,
	`group_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `memberships_group_user_uq` UNIQUE(`group_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`ip_address` varchar(128),
	`user_agent` varchar(512),
	`user_id` varchar(64) NOT NULL,
	CONSTRAINT `session_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`provider` varchar(32) NOT NULL,
	`entitlement` varchar(64),
	`status` varchar(32) NOT NULL DEFAULT 'inactive',
	`current_period_end` timestamp,
	`raw` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_user_uq` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` varchar(1024),
	`used_bytes` bigint NOT NULL DEFAULT 0,
	`plan` varchar(32) NOT NULL DEFAULT 'free',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` varchar(64) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` varchar(512) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `verification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `derivatives` ADD CONSTRAINT `derivatives_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `favourites` ADD CONSTRAINT `favourites_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `favourites` ADD CONSTRAINT `favourites_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `groups` ADD CONSTRAINT `groups_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_uploader_id_user_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `favourites_user_idx` ON `favourites` (`user_id`);--> statement-breakpoint
CREATE INDEX `groups_owner_idx` ON `groups` (`owner_id`);--> statement-breakpoint
CREATE INDEX `invites_group_idx` ON `invites` (`group_id`);--> statement-breakpoint
CREATE INDEX `media_group_idx` ON `media` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_uploader_idx` ON `media` (`uploader_id`);--> statement-breakpoint
CREATE INDEX `media_state_idx` ON `media` (`state`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);