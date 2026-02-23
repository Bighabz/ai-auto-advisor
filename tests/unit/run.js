"use strict";

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter((f) => f.startsWith("test-") && f.endsWith(".js"))
  .sort();

console.log(`\n═══ SAM Unit Tests ═══\n`);
console.log(`Found ${testFiles.length} test files\n`);

let totalPass = 0;
let totalFail = 0;

for (const file of testFiles) {
  const filePath = path.join(testDir, file);
  console.log(`--- ${file} ---`);
  try {
    execSync(`node "${filePath}"`, {
      stdio: "inherit",
      timeout: 30000,
      cwd: path.join(testDir, "../.."),
    });
    totalPass++;
  } catch (err) {
    totalFail++;
    console.error(`  SUITE FAILED: ${file}\n`);
  }
  console.log();
}

console.log(`═══════════════════════════`);
console.log(`Suites: ${totalPass} passed, ${totalFail} failed (${testFiles.length} total)`);
console.log(`═══════════════════════════\n`);

if (totalFail > 0) process.exit(1);
