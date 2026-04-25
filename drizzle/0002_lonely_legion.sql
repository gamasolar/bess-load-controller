CREATE TABLE `bess_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`socLowLimit` float NOT NULL DEFAULT 15,
	`socHighLimit` float NOT NULL DEFAULT 20,
	`cooldownMinutes` int NOT NULL DEFAULT 5,
	`lowReadingsRequired` int NOT NULL DEFAULT 2,
	`highReadingsRequired` int NOT NULL DEFAULT 3,
	`presetName` varchar(32) NOT NULL DEFAULT 'padrao',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bess_config_id` PRIMARY KEY(`id`)
);
