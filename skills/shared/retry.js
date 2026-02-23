"use strict";

const RETRYABLE = new Set(["TIMEOUT", "STALE_TAB", "NETWORK"]);
const TERMINAL = new Set(["AUTH_FAILED", "PLATFORM_DOWN", "NOT_FOUND", "PARSE_ERROR"]);

const FailureClass = {
  TIMEOUT: "TIMEOUT",
  STALE_TAB: "STALE_TAB",
  NETWORK: "NETWORK",
  AUTH_FAILED: "AUTH_FAILED",
  PLATFORM_DOWN: "PLATFORM_DOWN",
  NOT_FOUND: "NOT_FOUND",
  PARSE_ERROR: "PARSE_ERROR",

  isRetryable(code) {
    return RETRYABLE.has(code);
  },

  classify(err) {
    const msg = (err.message || "").toLowerCase();
    if (err.reason_code) return err.reason_code;
    if (msg.includes("timeout") || msg.includes("timed out")) return "TIMEOUT";
    if (msg.includes("login") || msg.includes("redirect")) return "STALE_TAB";
    if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network")) return "NETWORK";
    if (msg.includes("401") || msg.includes("403") || msg.includes("auth")) return "AUTH_FAILED";
    if (msg.includes("503") || msg.includes("maintenance")) return "PLATFORM_DOWN";
    if (msg.includes("not found") || msg.includes("no results")) return "NOT_FOUND";
    return "UNKNOWN";
  },
};

async function withRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelay = opts.baseDelay ?? 1000;
  const jitter = opts.jitter ?? 0.2;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (err.retryable === false) throw err;
      const code = err.reason_code || FailureClass.classify(err);
      if (!FailureClass.isRetryable(code) && err.retryable !== true) throw err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        const jittered = delay * (1 + (Math.random() * 2 - 1) * jitter);
        console.log(`[retry] attempt ${attempt + 1}/${maxRetries} failed (${code}), retrying in ${Math.round(jittered)}ms`);
        await new Promise((r) => setTimeout(r, jittered));
      }
    }
  }
  throw lastError;
}

function circuitBreaker(name, opts = {}) {
  const failThreshold = opts.failThreshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 120000;

  let failures = 0;
  let openedAt = null;

  return {
    async call(fn) {
      if (openedAt) {
        const elapsed = Date.now() - openedAt;
        if (elapsed < cooldownMs) {
          const err = new Error(`Circuit open for ${name} — cooling down (${Math.round((cooldownMs - elapsed) / 1000)}s remaining)`);
          err.reason_code = "CIRCUIT_OPEN";
          throw err;
        }
        openedAt = null;
        failures = 0;
      }
      try {
        const result = await fn();
        failures = 0;
        return result;
      } catch (err) {
        failures++;
        if (failures >= failThreshold) {
          openedAt = Date.now();
          console.error(`[circuit-breaker] ${name}: circuit OPEN after ${failures} failures`);
        }
        throw err;
      }
    },
    getState() {
      if (openedAt) {
        return Date.now() - openedAt < cooldownMs ? "open" : "half-open";
      }
      return failures > 0 ? "degraded" : "closed";
    },
    reset() {
      failures = 0;
      openedAt = null;
    },
  };
}

module.exports = { withRetry, circuitBreaker, FailureClass };
