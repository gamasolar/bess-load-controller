CREATE TABLE `bess_sites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`bessCount` int NOT NULL DEFAULT 1,
	`bessCapacityKwh` float NOT NULL DEFAULT 215,
	`bessModel` varchar(64) NOT NULL DEFAULT 'LUNA2000-215KWH',
	`pumpCount` int NOT NULL DEFAULT 1,
	`pumpPowerCv` float NOT NULL DEFAULT 30,
	`pumpDescription` text,
	`controlMode` enum('manual','auto_mqtt','auto_future') NOT NULL DEFAULT 'manual',
	`mqttTopic` varchar(128),
	`fusionsolarDeviceIds` text,
	`fusionsolarPlantCode` varchar(64),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bess_sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `bess_sites_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `bess_alarms` ADD `siteId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `siteId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_events` ADD `siteId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `siteId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `soh` float;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `batteryPower` float;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `batteryTemperature` float;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `busVoltage` float;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `pvPower` float;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `gridPower` float;--> statement-breakpoint
ALTER TABLE `bess_readings` ADD `loadPower` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `siteId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `currentSoh` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `currentBatteryPower` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `currentTemperature` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `currentPvPower` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `currentLoadPower` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `mqttConnected` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `sonoffOnline` boolean DEFAULT false NOT NULL;