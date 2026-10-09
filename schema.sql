-- One row per shared grocery list. Both blobs are encrypted on the phones;
-- this service cannot read them. Times are milliseconds since 1970.
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY NOT NULL,
  owner_token_hash TEXT NOT NULL,
  list_blob TEXT NOT NULL,
  fill_blob TEXT,
  list_rev INTEGER NOT NULL DEFAULT 1,
  fill_rev INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_expires_at_idx ON shares(expires_at);

-- Write counters per caller and time window, keyed by a hash of the address.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires_at_idx ON rate_limits(expires_at);
