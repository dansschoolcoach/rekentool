import { spawn, spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..", "..", "..");
const targets = (
  process.env.API_CODEGEN_TARGETS ??
  [
    path.resolve(workspaceRoot, "lib", "api-client-react", "src", "generated"),
    path.resolve(workspaceRoot, "lib", "api-zod", "src", "generated"),
    path.resolve(workspaceRoot, "lib", "api-zod", "src", "index.ts"),
  ].join(path.delimiter)
)
  .split(path.delimiter)
  .filter(Boolean);
const command =
  process.env.API_CODEGEN_COMMAND ??
  [
    "orval --config ./orval.config.ts",
    "node ./scripts/normalize-api-zod-exports.mjs",
    "pnpm --filter @workspace/api-zod run test:node-exports",
    "pnpm -w run typecheck:libs",
  ].join(" && ");
const checkOnly = process.argv.includes("--check");

const backupRoot = path.resolve(
  workspaceRoot,
  `.api-codegen-backup-${process.pid}`,
);
const lockPath = path.resolve(workspaceRoot, ".api-codegen.lock");
const backups = [];
let preserveBackups = false;
let restored = false;
let lockHandle;
let interruptionSignal;

try {
  try {
    lockHandle = await open(lockPath, "wx");
    await lockHandle.writeFile(`${process.pid}\n`);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `API codegen cannot start because another run already holds ${lockPath}.`,
      );
    }
    throw error;
  }

  await rm(backupRoot, { recursive: true, force: true });
  await mkdir(backupRoot);

  for (const [index, target] of targets.entries()) {
    const backup = path.join(backupRoot, String(index));
    await cp(target, backup, { recursive: true });
    backups.push({ target, backup });
  }

  const exitCode = await run(command);
  if (exitCode !== 0) {
    throw new Error(`API codegen failed with exit code ${exitCode}.`);
  }
  if (checkOnly) {
    const changedTargets = [];
    for (const { target, backup } of backups) {
      if (!(await pathsEqual(target, backup))) {
        changedTargets.push(path.relative(workspaceRoot, target));
      }
    }
    await restoreBackups(backups);
    restored = true;
    if (changedTargets.length > 0) {
      throw new Error(
        [
          "Generated API client files differ from the current OpenAPI specification.",
          ...changedTargets.map((target) => `- ${target}`),
          "Run `pnpm --filter @workspace/api-spec run codegen` and commit the generated files.",
        ].join("\n"),
      );
    }
    console.log("Generated API client files are up to date.");
  }
} catch (error) {
  if (lockHandle && !restored) {
    try {
      await restoreBackups(backups);
    } catch (restoreError) {
      preserveBackups = true;
      console.error(
        "API codegen failed and restoring the previous files also failed.",
      );
      console.error(restoreError);
      console.error(`Recovery backups were kept in ${backupRoot}.`);
      process.exitCode = 1;
    }

    if (!preserveBackups) {
      console.error(
        "API codegen failed; the previous generated files were restored.",
      );
    }
  }
  console.error(error);
  process.exitCode = interruptionSignal
    ? 128 + signalNumber(interruptionSignal)
    : 1;
} finally {
  if (!preserveBackups) {
    await rm(backupRoot, { recursive: true, force: true });
  }
  if (lockHandle) {
    await lockHandle.close();
    await rm(lockPath, { force: true });
  }
}

async function run(commandToRun) {
  const child = spawn(commandToRun, {
    cwd: path.resolve(workspaceRoot, "lib", "api-spec"),
    env: {
      ...process.env,
      API_CODEGEN_BACKUP_ROOT: backupRoot,
    },
    detached: process.platform !== "win32",
    shell: true,
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    const signalHandlers = new Map(
      ["SIGINT", "SIGTERM"].map((signal) => [
        signal,
        () => {
          if (interruptionSignal) return;
          interruptionSignal = signal;
          terminateChild(child, signal);
        },
      ]),
    );
    const testInterruptionsEnabled =
      process.env.API_CODEGEN_ENABLE_TEST_INTERRUPTS === "1";
    const testInterruptionHandler = (message) => {
      if (
        message?.type === "interrupt" &&
        signalHandlers.has(message.signal)
      ) {
        signalHandlers.get(message.signal)();
      }
    };
    for (const [signal, handler] of signalHandlers) {
      process.once(signal, handler);
    }
    if (testInterruptionsEnabled) {
      process.on("message", testInterruptionHandler);
    }

    const finish = (callback) => {
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
      if (testInterruptionsEnabled) {
        process.off("message", testInterruptionHandler);
        if (process.connected) process.disconnect();
      }
      callback();
    };

    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      if (interruptionSignal) {
        finish(() =>
          reject(
            new Error(`API codegen was interrupted by ${interruptionSignal}.`),
          ),
        );
        return;
      }
      if (signal) {
        finish(() =>
          reject(new Error(`API codegen was terminated by signal ${signal}.`)),
        );
        return;
      }
      finish(() => resolve(code ?? 1));
    });
  });
}

function terminateChild(child, signal) {
  try {
    if (process.platform === "win32") {
      const result = spawnSync(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        {
          stdio: "inherit",
          windowsHide: true,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0 && child.exitCode === null) {
        throw new Error(
          `Failed to terminate API codegen process tree with taskkill exit code ${result.status}.`,
        );
      }
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function signalNumber(signal) {
  return signal === "SIGINT" ? 2 : 15;
}

async function restoreBackups(entries) {
  for (const { target, backup } of entries) {
    const discarded = `${target}.failed-${process.pid}`;
    await rm(discarded, { recursive: true, force: true });
    let hadFailedTarget = true;
    try {
      await rename(target, discarded);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hadFailedTarget = false;
    }
    try {
      await rename(backup, target);
    } catch (error) {
      if (hadFailedTarget) await rename(discarded, target);
      throw error;
    }
    if (hadFailedTarget) {
      await rm(discarded, { recursive: true, force: true });
    }
  }
}

async function pathsEqual(left, right) {
  const [leftStat, rightStat] = await Promise.all([lstat(left), lstat(right)]);
  if (
    leftStat.isDirectory() !== rightStat.isDirectory() ||
    leftStat.isFile() !== rightStat.isFile() ||
    leftStat.isSymbolicLink() !== rightStat.isSymbolicLink()
  ) {
    return false;
  }
  if (leftStat.isSymbolicLink()) {
    const [leftLink, rightLink] = await Promise.all([
      readlink(left),
      readlink(right),
    ]);
    return leftLink === rightLink;
  }
  if (leftStat.isFile()) {
    const [leftContents, rightContents] = await Promise.all([
      readFile(left),
      readFile(right),
    ]);
    return leftContents.equals(rightContents);
  }
  if (leftStat.isDirectory()) {
    const [leftEntries, rightEntries] = await Promise.all([
      readdir(left),
      readdir(right),
    ]);
    leftEntries.sort();
    rightEntries.sort();
    if (
      leftEntries.length !== rightEntries.length ||
      leftEntries.some((entry, index) => entry !== rightEntries[index])
    ) {
      return false;
    }
    const comparisons = await Promise.all(
      leftEntries.map((entry) =>
        pathsEqual(path.join(left, entry), path.join(right, entry)),
      ),
    );
    return comparisons.every(Boolean);
  }
  return false;
}
