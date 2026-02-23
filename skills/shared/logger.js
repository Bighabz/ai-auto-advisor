"use strict";

const crypto = require("crypto");

function generateRunId() {
  return crypto.randomBytes(6).toString("hex");
}

function isStructuredLogging() {
  return process.env.SAM_STRUCTURED_LOGGING === "true";
}

function createLogger(skillName, runId) {
  const rid = runId || null;

  function emit(level, msg, extra) {
    if (isStructuredLogging()) {
      const entry = {
        ts: new Date().toISOString(),
        level,
        skill: skillName,
        runId: rid,
        msg,
        ...extra,
      };
      const out = JSON.stringify(entry);
      if (level === "error") {
        console.error(out);
      } else {
        console.log(out);
      }
    } else {
      const prefix = `[${skillName}]`;
      const parts = [prefix, msg];
      if (extra && Object.keys(extra).length > 0) {
        parts.push(JSON.stringify(extra));
      }
      if (level === "error") {
        console.error(parts.join(" "));
      } else {
        console.log(parts.join(" "));
      }
    }
  }

  return {
    info(msg, extra) {
      emit("info", msg, extra);
    },
    warn(msg, extra) {
      emit("warn", msg, extra);
    },
    error(msg, extra) {
      emit("error", msg, extra);
    },
    step(stepName) {
      const start = Date.now();
      return function end(extra) {
        const duration_ms = Date.now() - start;
        emit("info", `step:${stepName}`, { step: stepName, duration_ms, ...extra });
      };
    },
    metric(data) {
      emit("info", "pipeline_metric", { type: "metric", ...data });
    },
  };
}

module.exports = { createLogger, generateRunId };
