ALTER TABLE `invites` ADD `invitee_email` varchar(255);--> statement-breakpoint
ALTER TABLE `user` ADD `can_create_groups` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `can_invite_members` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `invites_invitee_email_idx` ON `invites` (`invitee_email`);