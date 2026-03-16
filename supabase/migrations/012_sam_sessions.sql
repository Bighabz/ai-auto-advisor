-- Run: psql $DATABASE_URL -f supabase/migrations/012_sam_sessions.sql
-- Or: apply via Supabase Dashboard > SQL Editor

-- Migration 012: sam_sessions table for cross-restart session persistence
-- Replaces volatile in-memory sessions and conversations Maps in both gateways
-- Key scheme: "platform:chatId" (e.g. "telegram:1385723011", "whatsapp:+13105551234")

CREATE TABLE IF NOT EXISTS sam_sessions (
  session_key    text PRIMARY KEY,           -- "telegram:1385723011"
  platform       text NOT NULL,              -- "telegram" | "whatsapp"
  chat_id        text NOT NULL,              -- platform-native ID as string
  last_estimate  jsonb,                      -- full buildEstimate() results object
  history        jsonb DEFAULT '[]'::jsonb,  -- Claude messages array (capped at 20 by gateway)
  stage          text DEFAULT 'idle',        -- "idle" | "collecting_info" | "queued" | "running" | "done"
  collected_data jsonb DEFAULT '{}'::jsonb,  -- { name, phone, vehicle, complaint }
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Index for 24h TTL cleanup sweep (DELETE WHERE updated_at < now() - interval '24 hours')
CREATE INDEX IF NOT EXISTS sam_sessions_updated_at_idx ON sam_sessions (updated_at);

-- Comment documenting the design decision
COMMENT ON TABLE sam_sessions IS
  'Persistent conversation sessions for SAM gateways. session_key is the primary lookup. '
  'last_estimate and history are JSONB to avoid schema churn as estimate results evolve. '
  'Stage field is text (not enum) to avoid migrations when new stages are added in Phase 2.';
