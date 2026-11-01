-- Core baseline for a fresh installation only.
-- Existing D1 database already has its own schema and should NOT run this baseline.
-- Use this file only when creating a brand-new database.
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  picture_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','publisher','assistant_admin','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  reel_url TEXT NOT NULL,
  participant_limit INTEGER NOT NULL DEFAULT 60 CHECK(participant_limit > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','full','closed','hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS mission_claims (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','submitted','cancelled')),
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  UNIQUE(post_id, member_id)
);
CREATE TABLE IF NOT EXISTS evidence_submissions (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE REFERENCES mission_claims(id) ON DELETE RESTRICT,
  submitted_by TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  shopee_url TEXT NOT NULL,
  owner_review_status TEXT NOT NULL DEFAULT 'pending' CHECK(owner_review_status IN ('pending','confirmed','flagged')),
  owner_rejection_reason TEXT,
  admin_review_status TEXT NOT NULL DEFAULT 'not_required' CHECK(admin_review_status IN ('not_required','pending','confirmed_invalid','overturned')),
  admin_review_note TEXT,
  admin_reviewed_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  admin_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS makeup_missions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  source_evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence_submissions(id) ON DELETE RESTRICT,
  excluded_post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
  replacement_post_id TEXT REFERENCES posts(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL DEFAULT 'video' CHECK(task_type IN ('video')),
  status TEXT NOT NULL DEFAULT 'awaiting_assignment' CHECK(status IN ('awaiting_assignment','assigned','completed','cancelled')),
  completion_evidence_id TEXT UNIQUE REFERENCES evidence_submissions(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  assigned_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  assigned_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS post_capacity_adjustments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
  source_evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence_submissions(id) ON DELETE RESTRICT,
  adjustment INTEGER NOT NULL CHECK(adjustment > 0),
  limit_before INTEGER NOT NULL,
  limit_after INTEGER NOT NULL,
  approved_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
