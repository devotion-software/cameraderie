ALTER TABLE `media` ADD `camera_make` varchar(128);--> statement-breakpoint
ALTER TABLE `media` ADD `camera_model` varchar(128);--> statement-breakpoint
ALTER TABLE `media` ADD `lens_model` varchar(191);--> statement-breakpoint
ALTER TABLE `media` ADD `aperture_f` double;--> statement-breakpoint
ALTER TABLE `media` ADD `shutter_speed_sec` double;--> statement-breakpoint
ALTER TABLE `media` ADD `iso` int;--> statement-breakpoint
ALTER TABLE `media` ADD `focal_length_mm` double;--> statement-breakpoint
ALTER TABLE `media` ADD `flash` varchar(191);--> statement-breakpoint
ALTER TABLE `media` ADD `orientation` varchar(64);--> statement-breakpoint
ALTER TABLE `media` ADD `exposure_program` varchar(64);--> statement-breakpoint
ALTER TABLE `media` ADD `white_balance` varchar(64);