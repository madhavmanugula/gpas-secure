-- GPAS Secure recovery hardening migration (MySQL 8+ compatible)
-- server.js also creates these tables automatically on startup.
CREATE TABLE IF NOT EXISTS recovery_challenges (
  request_id_hash CHAR(64) PRIMARY KEY, username VARCHAR(255) NOT NULL, email VARCHAR(254) NOT NULL,
  otp_hash CHAR(64) NOT NULL, expires_at_ms BIGINT NOT NULL, attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at_ms BIGINT NOT NULL, INDEX idx_recovery_challenges_expiry (expires_at_ms),
  INDEX idx_recovery_challenges_user (username)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS recovery_grants (
  token_hash CHAR(64) PRIMARY KEY, username VARCHAR(255) NOT NULL, expires_at_ms BIGINT NOT NULL,
  created_at_ms BIGINT NOT NULL, INDEX idx_recovery_grants_expiry (expires_at_ms),
  INDEX idx_recovery_grants_user (username)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS recovery_rate_limits (
  rate_key CHAR(64) PRIMARY KEY, window_started_at_ms BIGINT NOT NULL, request_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_requested_at_ms BIGINT NOT NULL DEFAULT 0, updated_at_ms BIGINT NOT NULL,
  INDEX idx_recovery_rate_updated (updated_at_ms)
) ENGINE=InnoDB;
