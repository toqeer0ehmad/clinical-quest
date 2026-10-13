PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS cq_users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
 stripe_customer_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS cq_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES cq_users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cq_sessions_user ON cq_sessions(user_id);
CREATE TABLE IF NOT EXISTS cq_rate_limits (
 key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cq_recovery (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES cq_users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cq_subscriptions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES cq_users(id) ON DELETE CASCADE,
 status TEXT NOT NULL, price_id TEXT NOT NULL, period_end INTEGER NOT NULL,
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cq_subscriptions_user ON cq_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS cq_stripe_events (
 id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cq_checkouts (user_id TEXT PRIMARY KEY REFERENCES cq_users(id) ON DELETE CASCADE, session_id TEXT NOT NULL, price_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cq_billing_locks (user_id TEXT PRIMARY KEY REFERENCES cq_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
