"use strict";

const LABOR_PRECEDENCE = ["MOTOR", "shop_default", "AI_fallback", "default"];

function normalizePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw > 0 ? raw : null;
  const str = String(raw).trim();
  if (!str) return null;
  const cleaned = str.replace(/[$,]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

function validateLaborResult(raw) {
  if (!raw || typeof raw !== "object") {
    return { hours: 0, operation: "", source: "unknown", confidence: 0, reason_code: "INVALID_LABOR" };
  }
  const hours = typeof raw.hours === "number" ? raw.hours : parseFloat(raw.hours);
  return {
    hours: isNaN(hours) || hours < 0 ? 0 : hours,
    operation: raw.operation || raw.procedure || "",
    source: raw.source || "unknown",
    confidence: typeof raw.confidence === "number" ? raw.confidence : (raw.source === "MOTOR" ? 1 : 0.5),
    reason_code: (!hours && hours !== 0) || isNaN(hours) ? "INVALID_LABOR" : null,
  };
}

function validatePartQuote(raw) {
  if (!raw || typeof raw !== "object") {
    return { brand: "", part_number: "", supplier: "", unit_price: null, availability: "", source: "unknown", reason_code: "INVALID_PART" };
  }
  const price = normalizePrice(raw.unit_price || raw.price);
  return {
    brand: raw.brand || "",
    part_number: raw.part_number || raw.partNumber || "",
    supplier: raw.supplier || "",
    unit_price: price,
    availability: raw.availability || raw.stock || "",
    source: raw.source || "partstech",
    reason_code: price === null ? "NO_PRICE" : null,
  };
}

function validateEstimateLine(raw) {
  if (!raw || typeof raw !== "object") {
    return { type: "unknown", description: "", qty: 0, unit_price: 0, total: 0, source: "unknown" };
  }
  const qty = typeof raw.qty === "number" ? raw.qty : parseInt(raw.qty, 10) || 1;
  const unit_price = typeof raw.unit_price === "number" ? raw.unit_price : normalizePrice(raw.unit_price) || 0;
  return {
    type: raw.type || "unknown",
    description: raw.description || "",
    qty,
    unit_price,
    total: Math.round(qty * unit_price * 100) / 100,
    source: raw.source || "unknown",
  };
}

function mergeResults(base, overlay) {
  const merged = JSON.parse(JSON.stringify(base));
  for (const key of Object.keys(overlay)) {
    if (key === "labor" && merged.labor && overlay.labor) {
      const baseIdx = LABOR_PRECEDENCE.indexOf(merged.labor.source);
      const overlayIdx = LABOR_PRECEDENCE.indexOf(overlay.labor.source);
      const basePri = baseIdx === -1 ? 999 : baseIdx;
      const overlayPri = overlayIdx === -1 ? 999 : overlayIdx;
      if (overlayPri <= basePri) {
        merged.labor = JSON.parse(JSON.stringify(overlay.labor));
      }
    } else if (overlay[key] !== undefined) {
      merged[key] = JSON.parse(JSON.stringify(overlay[key]));
    }
  }
  return merged;
}

module.exports = {
  normalizePrice,
  validateLaborResult,
  validatePartQuote,
  validateEstimateLine,
  mergeResults,
  LABOR_PRECEDENCE,
};
