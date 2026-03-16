"use strict";

// skills/shared/session-store.js
// Supabase-backed session persistence with in-memory write-through cache.
// Falls back to in-memory Map only if SUPABASE_URL or SUPABASE_ANON_KEY are absent.

const { createClient } = require("@supabase/supabase-js");

const LOG = "[session-store]";
const TABLE = "sam_sessions";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

// In-memory write-through cache — always populated on every setSession call
// so reads within the same process are always a cache hit after first write.
const memCache = new Map();

/**
 * makeKey — produce the canonical "platform:chatId" composite key.
 * @param {string} platform  "telegram" | "whatsapp"
 * @param {string|number} chatId  platform-native ID
 * @returns {string}  e.g. "telegram:1385723011"
 */
function makeKey(platform, chatId) {
  return `${platform}:${chatId}`;
}

/**
 * getSession — retrieve session for a given platform + chatId.
 * Fast path: memCache hit. Cold path: Supabase lookup, then populate cache.
 * Returns null if session not found or Supabase unavailable.
 *
 * @param {string} platform
 * @param {string|number} chatId
 * @returns {Promise<object|null>}
 */
async function getSession(platform, chatId) {
  const key = makeKey(platform, chatId);

  // Memory cache hit (fast path — < 1ms)
  if (memCache.has(key)) {
    return memCache.get(key);
  }

  // Cold start: attempt Supabase load
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("session_key", key)
        .single();

      if (!error && data) {
        const session = {
          lastEstimate: data.last_estimate,
          history: data.history || [],
          stage: data.stage || "idle",
          collectedData: data.collected_data || {},
          platform: data.platform,
          chat_id: data.chat_id,
          updatedAt: data.updated_at,
        };
        // Populate cache so subsequent reads are instant
        memCache.set(key, session);
        return session;
      }
    } catch (err) {
      console.error(`${LOG} getSession error: ${err.message}`);
    }
  }

  return null;
}

/**
 * setSession — persist session data for a given platform + chatId.
 * Writes to memCache synchronously (before the async Supabase call) so
 * subsequent getSession calls from the same process get fresh data immediately.
 *
 * @param {string} platform
 * @param {string|number} chatId
 * @param {object} session  { lastEstimate, history, stage, collectedData, ... }
 * @returns {Promise<void>}
 */
async function setSession(platform, chatId, session) {
  const key = makeKey(platform, chatId);

  // Synchronous write to cache BEFORE the await — ensures callers in the
  // same event loop turn see fresh data without waiting for Supabase.
  memCache.set(key, session);

  if (supabase) {
    try {
      await supabase.from(TABLE).upsert(
        {
          session_key: key,
          platform,
          chat_id: String(chatId),
          last_estimate: session.lastEstimate || null,
          history: session.history || [],
          stage: session.stage || "idle",
          collected_data: session.collectedData || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "session_key" }
      );
    } catch (err) {
      console.error(`${LOG} setSession error: ${err.message}`);
    }
  }
}

/**
 * deleteSession — remove session from memCache and Supabase.
 *
 * @param {string} platform
 * @param {string|number} chatId
 * @returns {Promise<void>}
 */
async function deleteSession(platform, chatId) {
  const key = makeKey(platform, chatId);

  memCache.delete(key);

  if (supabase) {
    try {
      await supabase.from(TABLE).delete().eq("session_key", key);
    } catch (err) {
      console.error(`${LOG} deleteSession error: ${err.message}`);
    }
  }
}

/**
 * cleanupExpiredSessions — delete all rows where updated_at is older than TTL_MS.
 * Returns { deleted: 0 } gracefully when Supabase is not configured.
 *
 * @returns {Promise<{ deleted: number }>}
 */
async function cleanupExpiredSessions() {
  if (!supabase) return { deleted: 0 };

  try {
    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .lt("updated_at", cutoff)
      .select("session_key");

    const deleted = data ? data.length : 0;
    if (deleted > 0) {
      console.log(`${LOG} Cleaned up ${deleted} expired sessions`);
    }
    if (error) {
      console.error(`${LOG} cleanup query error: ${error.message}`);
    }
    return { deleted };
  } catch (err) {
    console.error(`${LOG} cleanup error: ${err.message}`);
    return { deleted: 0 };
  }
}

module.exports = { getSession, setSession, deleteSession, cleanupExpiredSessions, makeKey };
