-- Add `disabled` flag to users (soft delete)
ALTER TABLE users ADD COLUMN disabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Invitation tokens (one-time use, role pre-assigned by admin)
CREATE TABLE user_invitations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL UNIQUE,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  createdById INT NULL,
  expiresAt TIMESTAMP NULL,
  usedAt TIMESTAMP NULL,
  usedByUserId INT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
