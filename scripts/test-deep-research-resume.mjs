#!/usr/bin/env node
/**
 * Smoke-test for deep-research resilience.
 *
 * Verifies that recoverOrphanedJobs() correctly classifies stuck jobs into:
 *   1. fresh heartbeat (< 3 min)          → SKIP (no transition)
 *   2. stale heartbeat (3-30 min)         → RELAUNCH (status stays "running", attemptCount++)
 *   3. dead heartbeat (> 30 min)          → FAIL (status → "failed")
 *
 * Run with:
 *   pnpm exec tsx scripts/test-deep-research-resume.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Set up isolated report dir BEFORE importing the service.
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dr-resume-test-"));
process.env.DEEP_RESEARCH_REPORT_DIR = tmpDir;

const { recoverOrphanedJobs } = await import("../server/services/deepResearchService.ts");

const now = Date.now();
const isoMinutesAgo = (m) => new Date(now - m * 60 * 1000).toISOString();

const fixtures = {
  fresh: {
    jobId: "test_fresh",
    userId: "1",
    topic: "fresh job (heartbeat 30s ago)",
    status: "running",
    progress: "active",
    createdAt: isoMinutesAgo(2),
    lastHeartbeatAt: new Date(now - 30 * 1000).toISOString(), // 30s ago
    pid: 99999,
    attemptCount: 1,
    creditsUsed: 0,
  },
  stale: {
    jobId: "test_stale",
    userId: "1",
    topic: "stale job (heartbeat 10 min ago) → should relaunch",
    status: "running",
    progress: "active before crash",
    createdAt: isoMinutesAgo(12),
    lastHeartbeatAt: isoMinutesAgo(10),
    pid: 88888,
    attemptCount: 1,
    creditsUsed: 0, // 0 to skip refund call (no DB)
  },
  dead: {
    jobId: "test_dead",
    userId: "1",
    topic: "dead job (heartbeat 45 min ago) → should fail",
    status: "running",
    progress: "active before crash",
    createdAt: isoMinutesAgo(60),
    lastHeartbeatAt: isoMinutesAgo(45),
    pid: 77777,
    attemptCount: 1,
    creditsUsed: 0,
  },
  exhausted: {
    jobId: "test_exhausted",
    userId: "1",
    topic: "exhausted job (attempt > MAX) → should fail",
    status: "running",
    progress: "many attempts",
    createdAt: isoMinutesAgo(20),
    lastHeartbeatAt: isoMinutesAgo(10),
    pid: 66666,
    attemptCount: 4, // > MAX_RESUME_ATTEMPTS (2) + 1
    creditsUsed: 0,
  },
};

for (const [name, fx] of Object.entries(fixtures)) {
  await fs.writeFile(path.join(tmpDir, `${fx.jobId}.json`), JSON.stringify(fx, null, 2));
  console.log(`  · seeded ${name}: ${fx.jobId}`);
}

console.log("\n→ calling recoverOrphanedJobs()…\n");
await recoverOrphanedJobs();

// give relaunchJob's setImmediate(runDeepResearchAsync) a moment to run, but
// runDeepResearchAsync will fail fast because GEMINI_API_KEY isn't set in tests
await new Promise((r) => setTimeout(r, 200));

let pass = 0;
let fail = 0;
const check = (name, expected, actual) => {
  if (actual === expected) {
    console.log(`  ✓ ${name}: ${actual}`);
    pass += 1;
  } else {
    console.log(`  ✗ ${name}: expected '${expected}', got '${actual}'`);
    fail += 1;
  }
};

console.log("→ checking final state:\n");

const readJob = async (id) => {
  const raw = await fs.readFile(path.join(tmpDir, `${id}.json`), "utf-8");
  return JSON.parse(raw);
};

// fresh: should still be "running" (untouched)
const fresh = await readJob("test_fresh");
check("fresh.status (skipped)", "running", fresh.status);
check("fresh.attemptCount (unchanged)", 1, fresh.attemptCount);

// stale: relaunchJob marks it running with attempt+1 (then runDeepResearchAsync
// fails synchronously due to no API key, transitions to failed via failJobAndRefund)
const stale = await readJob("test_stale");
console.log(`  · stale.status: ${stale.status} (running=relaunched / failed=relaunched-then-failed)`);
console.log(`  · stale.attemptCount: ${stale.attemptCount} (should be 2)`);
if (stale.attemptCount !== 2) {
  console.log(`  ✗ stale.attemptCount: expected 2, got ${stale.attemptCount}`);
  fail += 1;
} else {
  console.log(`  ✓ stale relaunch incremented attempt`);
  pass += 1;
}

// dead: failed
const dead = await readJob("test_dead");
check("dead.status (failed)", "failed", dead.status);

// exhausted: failed (attempt cap hit)
const exhausted = await readJob("test_exhausted");
check("exhausted.status (failed)", "failed", exhausted.status);

console.log(`\n${pass} passed · ${fail} failed`);

// cleanup
await fs.rm(tmpDir, { recursive: true, force: true });

process.exit(fail > 0 ? 1 : 0);
