CREATE TABLE `bess_alarms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`severity` enum('CRITICAL','WARNING','INFO') NOT NULL,
	`type` varchar(64) NOT NULL,
	`description` text NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	CONSTRAINT `bess_alarms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bess_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(32) NOT NULL,
	`description` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bess_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bess_readings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`soc` float NOT NULL,
	`valid` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bess_readings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bess_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`loadStatus` enum('on','off') NOT NULL DEFAULT 'off',
	`mode` enum('auto','manual') NOT NULL DEFAULT 'auto',
	`currentSoc` float NOT NULL DEFAULT 0,
	`lowCounter` int NOT NULL DEFAULT 0,
	`highCounter` int NOT NULL DEFAULT 0,
	`lastManeuverAt` timestamp,
	`healthStatus` enum('healthy','attention','degraded','critical') NOT NULL DEFAULT 'healthy',
	`lastDecision` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bess_state_id` PRIMARY KEY(`id`)
);
