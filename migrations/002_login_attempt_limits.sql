-- Persistent server-side login lockout state.
CREATE TABLE IF NOT EXISTS login_attempt_limits (
  attempt_key CHAR(64) PRIMARY KEY,
  failures TINYINT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at_ms BIGINT NOT NULL,
  locked_until_ms BIGINT NOT NULL DEFAULT 0,
  updated_at_ms BIGINT NOT NULL,
  INDEX idx_login_attempt_updated (updated_at_ms),
  INDEX idx_login_attempt_lock (locked_until_ms)
) ENGINE=InnoDB;
