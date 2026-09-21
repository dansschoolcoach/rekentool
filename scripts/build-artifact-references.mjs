import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function readJson(filePath) {
  const result = ts.readConfigFile(filePath, ts.sys.readFile);
  if (result.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(result.error.messageText, "\n"),
    );
  }
  return result.config;
}

export function getArtifactReferences(artifactDir) {
  const config = readJson(path.join(artifactDir, "tsconfig.json"));
  return (config.references ?? []).map(({ path: reference }) =>
    path.resolve(artifactDir, reference),
  );
}

export function buildArtifactReferences(
  artifactDir,
  spawn = spawnSync,
  reportError = console.error,
) {
  const references = getArtifactReferences(artifactDir);
  if (references.length === 0) return;

  const result = spawn(
    process.platform === "win32" ? "tsc.cmd" : "tsc",
    ["--build", "--force", ...references],
    { cwd: artifactDir, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.signal) {
    reportError(`TypeScript build was terminated by signal ${result.signal}.`);
  }
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  buildArtifactReferences(process.cwd());
}
