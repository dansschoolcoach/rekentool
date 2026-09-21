import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildArtifactReferences,
  getArtifactReferences,
} from "./build-artifact-references.mjs";

function createArtifact(context) {
  const artifactDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "artifact-references-"),
  );
  context.after(() => fs.rmSync(artifactDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(artifactDir, "tsconfig.json"),
    JSON.stringify({ references: [{ path: "../../lib/first" }] }),
  );
  return artifactDir;
}

test("derives all direct project references from the artifact tsconfig", (context) => {
  const artifactDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "artifact-references-"),
  );
  context.after(() => fs.rmSync(artifactDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(artifactDir, "tsconfig.json"),
    JSON.stringify({
      references: [{ path: "../../lib/first" }, { path: "../../lib/second" }],
    }),
  );

  assert.deepEqual(getArtifactReferences(artifactDir), [
    path.resolve(artifactDir, "../../lib/first"),
    path.resolve(artifactDir, "../../lib/second"),
  ]);
});

test("preserves a failing TypeScript build exit status", (context) => {
  const artifactDir = createArtifact(context);
  const previousExitCode = process.exitCode;
  context.after(() => {
    process.exitCode = previousExitCode;
  });

  buildArtifactReferences(artifactDir, () => ({ status: 7 }));

  assert.equal(process.exitCode, 7);
});

test("treats a TypeScript build terminated by a signal as failed", (context) => {
  const artifactDir = createArtifact(context);
  const previousExitCode = process.exitCode;
  const messages = [];
  context.after(() => {
    process.exitCode = previousExitCode;
  });

  buildArtifactReferences(
    artifactDir,
    () => ({
      status: null,
      signal: "SIGTERM",
    }),
    (message) => messages.push(message),
  );

  assert.deepEqual(messages, [
    "TypeScript build was terminated by signal SIGTERM.",
  ]);
  assert.equal(process.exitCode, 1);
});

test("propagates a process start error", (context) => {
  const artifactDir = createArtifact(context);
  const startError = new Error("could not start TypeScript");

  assert.throws(
    () =>
      buildArtifactReferences(artifactDir, () => ({
        error: startError,
        status: null,
      })),
    (error) => error === startError,
  );
});
