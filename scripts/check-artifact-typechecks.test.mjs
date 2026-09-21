import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatFailures,
  inspectArtifactTypechecks,
} from "./check-artifact-typechecks.mjs";

function createWorkspace(pretypecheck) {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-typechecks-"));
  const artifactDir = path.join(workspaceDir, "artifacts", "app");
  const libraryDir = path.join(workspaceDir, "lib", "shared");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "tsconfig.json"),
    JSON.stringify({ references: [{ path: "../../lib/shared" }] }),
  );
  fs.writeFileSync(
    path.join(artifactDir, "package.json"),
    JSON.stringify({
      scripts: {
        ...(pretypecheck === undefined ? {} : { pretypecheck }),
        typecheck: "tsc -p tsconfig.json --noEmit",
      },
    }),
  );
  return workspaceDir;
}

test("accepts the canonical project-reference build", (context) => {
  const workspaceDir = createWorkspace("node ../../scripts/build-artifact-references.mjs");
  context.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));

  const results = inspectArtifactTypechecks(workspaceDir);
  assert.equal(results.length, 1);
  assert.deepEqual(formatFailures(results, workspaceDir), []);
});

test("rejects a referenced artifact without the canonical pretypecheck build", (context) => {
  const workspaceDir = createWorkspace();
  context.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));

  const failures = formatFailures(inspectArtifactTypechecks(workspaceDir), workspaceDir);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /tsconfig\.json/u);
});

test("rejects a manually maintained project-reference build", (context) => {
  const workspaceDir = createWorkspace("tsc --build --force ../../lib/shared");
  context.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));

  const failures = formatFailures(inspectArtifactTypechecks(workspaceDir), workspaceDir);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /tsconfig\.json/u);
});