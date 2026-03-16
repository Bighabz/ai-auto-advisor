"use strict";

// [job-queue] Singleton serial job queue using p-queue with concurrency: 1.
// Both gateways import this one module so they share a single queue instance
// within the gateway process. Prevents concurrent buildEstimate() calls from
// corrupting the shared Chrome browser session on the Pi.

const EventEmitter = require("events");

// p-queue import with fallback (@esm2cjs/p-queue is CJS-wrapped ESM; p-queue v9 is ESM-only)
let PQueue;
try {
  PQueue = require("@esm2cjs/p-queue").default;
} catch {
  const mod = require("p-queue");
  PQueue = mod.default || mod;
}

// Module-level singletons — shared across all importers in the same process
const queue = new PQueue({ concurrency: 1 });
const emitter = new EventEmitter();

// userId -> { status: "queued"|"running", position, queuedAt, startedAt? }
const activeJobs = new Map();

/**
 * Enqueue a job for the given userId.
 *
 * @param {string} userId - Unique identifier for the user/session.
 * @param {function(): Promise<*>} jobFn - The async work to run.
 * @param {object} [opts]
 * @param {function(position: number, waitMinutes: number): void} [opts.notifyPosition]
 *   Called synchronously (before queue.add) when this job must wait. Receives:
 *     position   - 1-based queue position (e.g. 2 = second in line)
 *     waitMinutes - estimated wait in minutes (position-1 × 15)
 *
 * @returns {Promise<*>} Resolves to jobFn's return value.
 *   If userId is already active, returns { alreadyQueued: true, position } immediately.
 */
async function enqueueEstimate(userId, jobFn, { notifyPosition } = {}) {
  // Idempotent check: if this userId already has an active job, return early.
  // activeJobs is set synchronously before queue.add(), so this check is race-safe
  // in Node.js's single-threaded event loop.
  if (activeJobs.has(userId)) {
    const existing = activeJobs.get(userId);
    return { alreadyQueued: true, position: existing.position };
  }

  // Capture position BEFORE modifying queue or activeJobs.
  // queue.size  = jobs WAITING (not yet running)
  // queue.pending = jobs currently RUNNING (max 1 with concurrency:1)
  // position = size + pending + 1 (accounts for the running job)
  const position = queue.size + queue.pending + 1;
  const waitMinutes = (queue.size + queue.pending) * 15;

  // Mark synchronously to prevent double-enqueue race before returning to event loop
  activeJobs.set(userId, { status: "queued", position, queuedAt: Date.now() });

  // Notify the caller of their queue position when they must wait
  if ((queue.pending > 0 || queue.size > 0) && typeof notifyPosition === "function") {
    notifyPosition(position, waitMinutes);
  }

  // Add to the serial queue and return the promise
  return queue.add(async () => {
    // Update status to running when our turn arrives
    activeJobs.set(userId, { status: "running", position, startedAt: Date.now() });
    emitter.emit("job:start", { userId });

    try {
      const result = await jobFn();
      emitter.emit("job:complete", { userId, result });
      return result;
    } catch (error) {
      emitter.emit("job:error", { userId, error });
      throw error;
    } finally {
      // Always clear — no memory leak
      activeJobs.delete(userId);
    }
  });
}

/**
 * Returns the current status of a userId's job, or null if no active job.
 * @param {string} userId
 * @returns {{ status: string, position: number, queuedAt: number, startedAt?: number } | null}
 */
function getStatus(userId) {
  return activeJobs.get(userId) || null;
}

module.exports = { enqueueEstimate, getStatus, emitter, queue };
