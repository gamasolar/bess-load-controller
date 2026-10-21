-- Câmeras das usinas (ONVIF/RTSP). Aplicada à mão em 2026-10-17.
CREATE TABLE IF NOT EXISTS `bess_cameras` (
  `id` int AUTO_INCREMENT NOT NULL,
  `siteId` int NOT NULL,
  `name` varchar(128) NOT NULL,
  `model` varchar(64),
  `host` varchar(64) NOT NULL,
  `httpPort` int NOT NULL DEFAULT 80,
  `rtspPort` int NOT NULL DEFAULT 554,
  `viaHost` varchar(64),
  `viaHttpPort` int,
  `viaRtspPort` int,
  `username` varchar(64) NOT NULL DEFAULT 'admin',
  `password` varchar(128) NOT NULL DEFAULT '',
  `streamMain` varchar(128) NOT NULL DEFAULT '/stream0',
  `streamSub` varchar(128) NOT NULL DEFAULT '/stream1',
  `snapshotPath` varchar(160) NOT NULL DEFAULT '/cgi-bin/snapshot.cgi?channel=1',
  `onvifProfile` varchar(64),
  `onvifVideoSource` varchar(64),
  `features` json,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `bess_cameras_id` PRIMARY KEY(`id`)
);
CREATE INDEX `bess_cameras_site` ON `bess_cameras` (`siteId`);
