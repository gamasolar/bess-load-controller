CREATE TABLE `bess_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`siteId` int NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`source` enum('AUTO','MANUAL','BLACKOUT','SYSTEM') NOT NULL,
	`action` enum('TURN_ON','TURN_OFF','MODE_CHANGE','CONFIG_CHANGE','ALERT') NOT NULL,
	`socAtTime` int,
	`socSource` enum('REAL','ESTIMATED') DEFAULT 'REAL',
	`pumpStateBefore` enum('ON','OFF','UNKNOWN'),
	`pumpStateAfter` enum('ON','OFF','UNKNOWN'),
	`reason` varchar(255),
	`userId` int,
	`metadata` json,
	CONSTRAINT `bess_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bess_config` ADD `socMinDesliga` int DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `socMinReliga` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `socBlackout` int DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `horarioLiberacao` varchar(5) DEFAULT '06:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `horarioCorte` varchar(5) DEFAULT '17:30' NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `margemZonaCritica` int DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `intervaloPadrao` int DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `intervaloCritico` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `cooldownAcao` int DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `maxSemTelemetria` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_config` ADD `controlMode` enum('AUTO','MANUAL') DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `socEstimated` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `lastEstimateAt` timestamp;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `dischargeRatePpPerMin` float;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `cooldownUntil` timestamp;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `pumpOnSinceTimestamp` timestamp;--> statement-breakpoint
ALTER TABLE `bess_state` ADD `pumpOnSecondsToday` int DEFAULT 0 NOT NULL;