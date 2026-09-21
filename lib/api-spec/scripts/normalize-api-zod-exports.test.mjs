import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(
  new URL("./normalize-api-zod-exports.mjs", import.meta.url),
);

function runNormalizer(indexPath) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      API_ZOD_INDEX_PATH: indexPath,
    },
  });
}

test("fails codegen when the export target cannot be written", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "api-zod-exports-"),
  );

  try {
    const result = runNormalizer(temporaryDirectory);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(escapeRegExp(temporaryDirectory)));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("writes the normalized exports to a valid target", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "api-zod-exports-"),
  );
  const indexPath = path.join(temporaryDirectory, "index.ts");

  try {
    const result = runNormalizer(indexPath);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await readFile(indexPath, "utf8"),
      [
        'export * from "./generated/api.ts";',
        'export * from "./generated/types/index.ts";',
        "",
      ].join("\n"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}