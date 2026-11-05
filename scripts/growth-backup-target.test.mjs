import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  privateGrowthBackupTarget,
  DEFAULT_GROWTH_BACKUP_REPOSITORY,
} from "./growth-backup-target.mjs";

for (const metadata of [
  { nameWithOwner: DEFAULT_GROWTH_BACKUP_REPOSITORY, isPrivate: false },
  { nameWithOwner: DEFAULT_GROWTH_BACKUP_REPOSITORY },
  { nameWithOwner: "wrong/repository", isPrivate: true },
])
  test(`rejects public/unknown/mismatched target ${JSON.stringify(metadata)}`, () => {
    const calls = [];
    assert.throws(
      () =>
        privateGrowthBackupTarget(args => {
          calls.push(args);
          return JSON.stringify(metadata);
        }),
      /confirmed_private/
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
      "repo",
      "view",
      DEFAULT_GROWTH_BACKUP_REPOSITORY,
      "--json",
      "nameWithOwner,isPrivate",
    ]);
  });
test("private routing pins every release operation and rejects cross-repository API or repo override", () => {
  const calls = [],
    target = privateGrowthBackupTarget(args => {
      calls.push(args);
      return args[0] === "repo"
        ? JSON.stringify({
            nameWithOwner: DEFAULT_GROWTH_BACKUP_REPOSITORY,
            isPrivate: true,
          })
        : "[]";
    });
  target.gh([
    "release",
    "create",
    "test-tag",
    "--target",
    "public-code-sha",
    "--latest=false",
  ]);
  assert.deepEqual(calls.at(-1), [
    "release",
    "create",
    "test-tag",
    "--latest=false",
    "--repo",
    DEFAULT_GROWTH_BACKUP_REPOSITORY,
  ]);
  target.gh(["release", "upload", "test-tag", "/tmp/test.txt"]);
  assert.equal(calls.at(-1).at(-1), DEFAULT_GROWTH_BACKUP_REPOSITORY);
  assert.throws(
    () => target.gh(["api", "repos/public/code/releases"]),
    /scope_violation/
  );
  assert.throws(
    () =>
      target.gh([
        "release",
        "upload",
        "test-tag",
        "/tmp/test.txt",
        "--repo",
        "public/code",
      ]),
    /scope_violation/
  );
});
test("real CLI without dedicated token exits before invoking ambient gh credentials", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/growth-backup-target.mjs"],
    {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: "", PATH: "/nonexistent" },
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private_token_required/);
  assert(!result.stderr.includes("ENOENT"));
});
