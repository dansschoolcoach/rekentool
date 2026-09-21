import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function readJson(filePath) {
  const result = ts.readConfigFile(filePath, ts.sys.readFile);
  if (result.error) {
    throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, "\n"));
  }
  return result.config;
}

const canonicalPretypecheck = "node ../../scripts/build-artifact-references.mjs";

export function inspectArtifactTypechecks(workspaceDir) {
  const artifactsDir = path.join(workspaceDir, "artifacts");
  if (!fs.existsSync(artifactsDir)) return [];

  return fs
    .readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const artifactDir = path.join(artifactsDir, entry.name);
      const tsconfigPath = path.join(artifactDir, "tsconfig.json");
      const packagePath = path.join(artifactDir, "package.json");
      if (!fs.existsSync(tsconfigPath) || !fs.existsSync(packagePath)) return [];

      const config = readJson(tsconfigPath);
      const references = (config.references ?? []).map(({ path: reference }) =>
        path.resolve(artifactDir, reference),
      );
      if (references.length === 0) return [];

      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      const scripts = packageJson.scripts ?? {};
      const pretypecheck = scripts.pretypecheck ?? "";

      return [{
        artifact: entry.name,
        references,
        pretypecheck,
        hasTypecheck: typeof scripts.typecheck === "string",
        usesCanonicalPretypecheck: pretypecheck === canonicalPretypecheck,
      }];
    });
}

export function formatFailures(results, workspaceDir) {
  return results.flatMap((result) => {
    const failures = [];
    if (!result.hasTypecheck) {
      failures.push(`- artifacts/${result.artifact}: script "typecheck" ontbreekt`);
    }
    if (!result.usesCanonicalPretypecheck) {
      failures.push(
        `- artifacts/${result.artifact}: "pretypecheck" moet projectreferenties uit tsconfig.json afleiden via "${canonicalPretypecheck}"`,
      );
    }
    return failures;
  });
}

function main() {
  const workspaceDir = process.cwd();
  const results = inspectArtifactTypechecks(workspaceDir);
  const failures = formatFailures(results, workspaceDir);

  if (failures.length > 0) {
    console.error("Ongeldige standalone artifact-typechecks:\n" + failures.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Artifact-typechecks gecontroleerd: ${results.length} artifact(s) met TypeScript-projectreferenties.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}