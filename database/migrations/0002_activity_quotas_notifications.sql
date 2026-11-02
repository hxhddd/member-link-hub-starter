-- Additive migration only. Safe for the existing Member Link Hub D1 database.
-- Do not run database/migrations/0001_core.sql against an existing database.
ALTER TABLE members ADD COLUMN last_active_at TEXT;
ALTER TABLE members ADD COLUMN inactivity_notice_stage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN deletion_due_at TEXT;
ALTER TABLE members ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS member_daily_usage (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  posts_used INTEGER NOT NULL DEFAULT 0 CHECK(posts_used >= 0),
  missions_claimed INTEGER NOT NULL DEFAULT 0 CHECK(missions_claimed >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON member_daily_usage(usage_date);

CREATE TABLE IF NOT EXISTS member_notifications (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  dedupe_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_notifications_member_created ON member_notifications(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS member_activity_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  related_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_member_created ON member_activity_events(member_id, created_at DESC);

INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES
 ('inactivity_days','7',CURRENT_TIMESTAMP),
 ('inactivity_warning_days','5,6',CURRENT_TIMESTAMP),
 ('daily_mission_limit','5',CURRENT_TIMESTAMP),
 ('daily_post_limit','5',CURRENT_TIMESTAMP),
 ('daily_post_reset_time','05:00',CURRENT_TIMESTAMP),
 ('daily_post_timezone','Asia/Bangkok',CURRENT_TIMESTAMP),
 ('daily_mission_limit_enabled','true',CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS member_quota_overrides (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  daily_post_limit INTEGER CHECK(daily_post_limit IS NULL OR daily_post_limit >= 0),
  daily_mission_limit INTEGER CHECK(daily_mission_limit IS NULL OR daily_mission_limit >= 0),
  updated_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
