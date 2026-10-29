-- Shared authentication throttling survives restarts and multiple workers.
CREATE TABLE eightlm.auth_rate_limits (
 key_hash TEXT PRIMARY KEY,
 window_start BIGINT NOT NULL,
 attempts INTEGER NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON eightlm.auth_rate_limits(window_start);
