/**
 * IlmTok database schema, version 1.
 *
 * The same SQL runs on:
 *  - PGlite (in-process Postgres) for demo mode and automated tests, and
 *  - Supabase/PostgreSQL in production (via DATABASE_URL).
 *
 * Security principles:
 *  - Row Level Security is enabled on every table.
 *  - anon/authenticated roles get no write access at all (no write policies, privileges revoked).
 *  - Public reads go through views that expose only safe columns and approved rows.
 *  - Secrets (owner-token hashes, recovery-code hashes) are HMACs computed by the server and are
 *    never selected by public queries.
 *  - All writes from the application happen server-side through controlled endpoints.
 */

export interface Migration {
  id: string;
  sql: string;
}

const SCHEMA_V1 = `
CREATE TABLE categories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name_ar text NOT NULL CHECK (char_length(name_ar) BETWEEN 2 AND 40),
  description_ar text NOT NULL DEFAULT '' CHECK (char_length(description_ar) <= 200),
  accent text NOT NULL DEFAULT '#F5B942' CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  icon text NOT NULL DEFAULT 'lightbulb' CHECK (char_length(icon) <= 40),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 24),
  avatar_key text NOT NULL DEFAULT 'a1' CHECK (avatar_key ~ '^a[0-9]{1,2}$'),
  -- Keyed hash of the anonymous device id. Used only to tie uploads from one device to one
  -- pseudonymous creator page. It does not identify a person and is never shown publicly.
  device_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creators_device_idx ON creators (device_hash);

CREATE TABLE videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators (id) ON DELETE RESTRICT,
  category_id text NOT NULL REFERENCES categories (id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 4 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  key_fact text CHECK (key_fact IS NULL OR char_length(key_fact) <= 160),
  hashtags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(hashtags) <= 5),
  search_text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending_upload' CHECK (
    status IN ('pending_upload', 'pending_review', 'approved', 'rejected', 'hidden', 'expired', 'deleted')
  ),
  is_demo boolean NOT NULL DEFAULT false,
  storage_bucket text NOT NULL DEFAULT 'pending' CHECK (storage_bucket IN ('pending', 'public', 'demo')),
  storage_key text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  width integer,
  height integer,
  poster_key text,
  -- HMAC(server secret, owner token). The raw token is only returned once, to the uploader.
  owner_token_hash text NOT NULL,
  -- HMAC(server secret, one-time recovery code). Cleared after use.
  recovery_hash text,
  -- Keyed hash of the submitting device. Admin-only; used for quotas and abuse blocking.
  submitter_hash text,
  moderation_flags text[] NOT NULL DEFAULT '{}',
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by text,
  like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  comment_count integer NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  report_count integer NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  is_featured boolean NOT NULL DEFAULT false,
  featured_rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT videos_approved_has_published CHECK (status <> 'approved' OR published_at IS NOT NULL),
  CONSTRAINT videos_demo_bucket CHECK (NOT is_demo OR storage_bucket = 'demo')
);
CREATE INDEX videos_latest_public_idx ON videos (published_at DESC, id) WHERE status = 'approved';
CREATE INDEX videos_category_public_idx ON videos (category_id, published_at DESC) WHERE status = 'approved';
CREATE INDEX videos_creator_idx ON videos (creator_id, published_at DESC);
CREATE INDEX videos_status_created_idx ON videos (status, created_at DESC);
CREATE INDEX videos_submitter_idx ON videos (submitter_hash, created_at DESC);
CREATE INDEX videos_expiry_idx ON videos (expires_at) WHERE status = 'pending_upload';
CREATE INDEX videos_hashtags_idx ON videos USING gin (hashtags);

CREATE TABLE video_likes (
  video_id uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  device_hash text NOT NULL CHECK (char_length(device_hash) BETWEEN 16 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, device_hash)
);
CREATE INDEX video_likes_device_idx ON video_likes (device_hash, created_at DESC);

CREATE TABLE video_views (
  video_id uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  device_hash text NOT NULL CHECK (char_length(device_hash) BETWEEN 16 AND 128),
  view_date date NOT NULL,
  PRIMARY KEY (video_id, device_hash, view_date)
);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  parent_id uuid REFERENCES comments (id) ON DELETE CASCADE,
  author_name text NOT NULL CHECK (char_length(author_name) BETWEEN 2 AND 24),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'pending', 'hidden', 'deleted')),
  moderation_flags text[] NOT NULL DEFAULT '{}',
  device_hash text NOT NULL,
  -- HMAC(server secret, delete token). Lets the author delete their own comment without an account.
  delete_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  CONSTRAINT comments_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX comments_video_visible_idx ON comments (video_id, created_at) WHERE status = 'visible';
CREATE INDEX comments_status_idx ON comments (status, created_at DESC);
CREATE INDEX comments_device_idx ON comments (device_hash, created_at DESC);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('video', 'comment')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('inappropriate', 'misleading', 'spam', 'harassment', 'copyright', 'privacy', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 500),
  reporter_hash text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  CONSTRAINT reports_one_per_device UNIQUE (target_type, target_id, reporter_hash)
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX reports_target_idx ON reports (target_type, target_id);

CREATE TABLE quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 5 AND 200),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 4),
  correct_index smallint NOT NULL CHECK (correct_index >= 0 AND correct_index <= 3),
  explanation text NOT NULL CHECK (char_length(explanation) BETWEEN 5 AND 300),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quizzes_correct_in_range CHECK (correct_index < jsonb_array_length(options))
);
CREATE INDEX quizzes_video_idx ON quizzes (video_id) WHERE is_active;

CREATE TABLE playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  title_ar text NOT NULL CHECK (char_length(title_ar) BETWEEN 2 AND 80),
  description_ar text NOT NULL DEFAULT '' CHECK (char_length(description_ar) <= 300),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playlist_items (
  playlist_id uuid NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (playlist_id, video_id)
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'moderator' CHECK (role IN ('owner', 'moderator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE admin_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit_logs (created_at DESC);

CREATE TABLE settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]{3,60}$'),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0)
);

CREATE TABLE blocked_devices (
  device_hash text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE used_challenges (
  challenge_id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX used_challenges_expiry_idx ON used_challenges (expires_at);

CREATE TABLE daily_stats (
  day date PRIMARY KEY,
  uploads integer NOT NULL DEFAULT 0,
  approvals integer NOT NULL DEFAULT 0,
  rejections integer NOT NULL DEFAULT 0,
  reports integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  bytes_uploaded bigint NOT NULL DEFAULT 0
);

-- Public, safe read models. They run with the view owner's rights, so they can read the base
-- tables, but they only expose approved rows and never expose hashes or device identifiers.
CREATE VIEW public_categories AS
  SELECT id, name_ar, description_ar, accent, icon, sort_order
  FROM categories
  WHERE is_active;

CREATE VIEW public_videos AS
  SELECT
    v.id,
    v.title,
    v.description,
    v.key_fact,
    v.hashtags,
    v.category_id,
    v.creator_id,
    cr.display_name AS creator_name,
    cr.avatar_key AS creator_avatar,
    v.is_demo,
    v.storage_bucket,
    v.storage_key,
    v.poster_key,
    v.duration_ms,
    v.width,
    v.height,
    v.like_count,
    v.view_count,
    v.comment_count,
    v.is_featured,
    v.published_at
  FROM videos v
  JOIN creators cr ON cr.id = v.creator_id
  WHERE v.status = 'approved';

-- Row Level Security: enabled everywhere. No policies for anon/authenticated except public reads
-- of active categories. The server uses a privileged connection, which bypasses RLS by design.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE used_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    CREATE POLICY categories_public_read_anon ON categories FOR SELECT TO anon USING (is_active);
    GRANT SELECT ON public_categories TO anon;
    GRANT SELECT ON public_videos TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    CREATE POLICY categories_public_read_auth ON categories FOR SELECT TO authenticated USING (is_active);
    GRANT SELECT ON public_categories TO authenticated;
    GRANT SELECT ON public_videos TO authenticated;
  END IF;
END
$$;

-- Editorial categories (Arabic-first). Idempotent so that re-running never duplicates them.
INSERT INTO categories (id, name_ar, description_ar, accent, icon, sort_order) VALUES
  ('science', 'العلوم', 'تجارب وظواهر تفسّر ما حولنا', '#34D399', 'flask-conical', 1),
  ('history', 'التاريخ', 'حضارات وأحداث غيّرت مسار العالم', '#F59E0B', 'landmark', 2),
  ('geography', 'الجغرافيا', 'القارات والمناخ والخرائط', '#38BDF8', 'globe', 3),
  ('space', 'الفضاء', 'النجوم والكواكب والكون الواسع', '#818CF8', 'rocket', 4),
  ('technology', 'التقنية', 'أدوات وأفكار تصنع الحاضر', '#22D3EE', 'cpu', 5),
  ('ai', 'الذكاء الاصطناعي', 'كيف تتعلم الآلات وما حدودها', '#C084FC', 'brain', 6),
  ('math', 'الرياضيات', 'أفكار بسيطة بمنظور مختلف', '#F472B6', 'sigma', 7),
  ('health', 'الصحة', 'معلومات صحية مبسطة وآمنة', '#4ADE80', 'heart-pulse', 8),
  ('nature', 'الطبيعة', 'الحيوانات والنباتات والبيئة', '#A3E635', 'leaf', 9),
  ('general', 'معلومات عامة', 'معارف متنوعة من كل المجالات', '#FBBF24', 'lightbulb', 10)
ON CONFLICT (id) DO NOTHING;

-- Operational defaults. The admin dashboard can change these at runtime.
INSERT INTO settings (key, value) VALUES
  ('max_upload_bytes', '52428800'),
  ('max_duration_seconds', '90'),
  ('min_duration_seconds', '2'),
  ('max_pending_per_device', '1'),
  ('max_submissions_per_device_per_day', '3'),
  ('max_uploads_per_day_global', '300'),
  ('max_storage_bytes_total', '1073741824'),
  ('pending_expiry_minutes', '30'),
  ('rejected_retention_days', '30'),
  ('report_auto_hide_threshold', '3'),
  ('comments_enabled', 'true'),
  ('comment_challenge_after_recent', '3'),
  ('extra_blocked_terms', '[]')
ON CONFLICT (key) DO NOTHING;
`;

export const MIGRATIONS: readonly Migration[] = [{ id: "0001_init", sql: SCHEMA_V1 }];
