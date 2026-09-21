import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceEntry = resolve(packageRoot, process.argv[2] ?? "src/index.ts");
const declarationEntry = resolve(
  packageRoot,
  process.argv[3] ?? "dist/index.d.ts",
);

function collectExports(entry) {
  const program = ts.createProgram([entry], {
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
  });
  const sourceFile = program.getSourceFile(entry);
  const moduleSymbol =
    sourceFile && program.getTypeChecker().getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) {
    throw new Error(`Could not inspect database entry exports: ${entry}`);
  }

  return new Set(
    program
      .getTypeChecker()
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.getName()),
  );
}

const sourceExports = collectExports(sourceEntry);
const declarationExports = collectExports(declarationEntry);
const missingExports = [...sourceExports]
  .filter((name) => !declarationExports.has(name))
  .sort();
const staleExports = [...declarationExports]
  .filter((name) => !sourceExports.has(name))
  .sort();

if (missingExports.length > 0 || staleExports.length > 0) {
  const differences = [
    missingExports.length > 0 &&
      `missing from declarations: ${missingExports.join(", ")}`,
    staleExports.length > 0 &&
      `only in declarations: ${staleExports.join(", ")}`,
  ].filter(Boolean);

  throw new Error(
    `Generated database declaration exports do not match source exports (${differences.join("; ")})`,
  );
}
