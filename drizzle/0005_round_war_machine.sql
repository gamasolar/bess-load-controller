CREATE TABLE `bess_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bess_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bess_settings_key_unique` UNIQUE(`key`)
);
