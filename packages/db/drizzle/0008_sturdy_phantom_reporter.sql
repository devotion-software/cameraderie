CREATE TABLE `passkey` (
	`id` varchar(64) NOT NULL,
	`name` varchar(255),
	`public_key` varchar(2048) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`credential_id` varchar(512) NOT NULL,
	`counter` int NOT NULL,
	`device_type` varchar(32) NOT NULL,
	`backed_up` boolean NOT NULL,
	`transports` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`aaguid` varchar(64),
	CONSTRAINT `passkey_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `passkey` ADD CONSTRAINT `passkey_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `passkey_user_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credential_idx` ON `passkey` (`credential_id`);