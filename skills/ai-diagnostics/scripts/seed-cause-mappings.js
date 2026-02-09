/**
 * seed-cause-mappings.js — Tier 2: DTC-to-Cause Mappings
 *
 * ~500 cause entries across high-priority DTC codes.
 * Each DTC gets 2-5 ranked causes with diagnostic steps.
 */

const PART_A = require("./seed-causes-a");
const PART_B = require("./seed-causes-b");

module.exports = [...PART_A, ...PART_B];
