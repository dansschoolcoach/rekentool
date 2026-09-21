import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultIndexPath = path.resolve(
  scriptDirectory,
  "..",
  "..",
  "api-zod",
  "src",
  "index.ts",
);
const indexPath = process.env.API_ZOD_INDEX_PATH ?? defaultIndexPath;
const exports = [
  'export * from "./generated/api.ts";',
  'export * from "./generated/types/index.ts";',
  "",
].join("\n");

try {
  await writeFile(indexPath, exports);
} catch (error) {
  console.error(`Failed to normalize API Zod exports in ${indexPath}.`);
  console.error(error);
  process.exitCode = 1;
}