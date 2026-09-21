import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(
  new URL("./run-atomic-codegen.mjs", import.meta.url),
);

test("restores the last valid generated set when a later step fails", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(scriptDirectory, ".atomic-api-codegen-test-"),
  );
  const clientGenerated = path.join(temporaryDirectory, "client-generated");
  const zodGenerated = path.join(temporaryDirectory, "zod-generated");
  const zodIndex = path.join(temporaryDirectory, "index.ts");

  try {
    await mkdir(clientGenerated);
    await mkdir(zodGenerated);
    await writeFile(path.join(clientGenerated, "api.ts"), "valid client\n");
    await writeFile(path.join(zodGenerated, "api.ts"), "valid zod\n");
    await writeFile(zodIndex, "valid exports\n");

    const mutationScript = path.join(temporaryDirectory, "mutate-and-fail.mjs");
    await writeFile(
      mutationScript,
      [
        'import { rm, writeFile } from "node:fs/promises";',
        `await rm(${JSON.stringify(clientGenerated)}, { recursive: true });`,
        `await writeFile(${JSON.stringify(zodIndex)}, "partial exports\\n");`,
        "process.exitCode = 23;",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_CODEGEN_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(mutationScript)}`,
        API_CODEGEN_TARGETS: [clientGenerated, zodGenerated, zodIndex].join(
          path.delimiter,
        ),
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous generated files were restored/);
    assert.equal(
      await readFile(path.join(clientGenerated, "api.ts"), "utf8"),
      "valid client\n",
    );
    assert.equal(
      await readFile(path.join(zodGenerated, "api.ts"), "utf8"),
      "valid zod\n",
    );
    assert.equal(await readFile(zodIndex, "utf8"), "valid exports\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("keeps backups outside source roots and removes them after success", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(scriptDirectory, ".atomic-api-codegen-test-"),
  );
  const generated = path.join(temporaryDirectory, "src", "generated");
  const backupLocationFile = path.join(temporaryDirectory, "backup-location");

  try {
    await mkdir(generated, { recursive: true });
    await writeFile(path.join(generated, "api.ts"), "old generation\n");

    const mutationScript = path.join(
      temporaryDirectory,
      "mutate-and-succeed.mjs",
    );
    await writeFile(
      mutationScript,
      [
        'import { writeFile } from "node:fs/promises";',
        `await writeFile(${JSON.stringify(path.join(generated, "api.ts"))}, "new generation\\n");`,
        `await writeFile(${JSON.stringify(backupLocationFile)}, process.env.API_CODEGEN_BACKUP_ROOT);`,
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_CODEGEN_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(mutationScript)}`,
        API_CODEGEN_TARGETS: generated,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await readFile(path.join(generated, "api.ts"), "utf8"),
      "new generation\n",
    );

    const backupRoot = await readFile(backupLocationFile, "utf8");
    assert.equal(
      path.dirname(backupRoot),
      path.resolve(scriptDirectory, "../../.."),
    );
    assert.equal(
      path.relative(generated, backupRoot).startsWith(`..${path.sep}`),
      true,
    );
    await assert.rejects(access(backupRoot), { code: "ENOENT" });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("check mode detects drift and restores the original generated files", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(scriptDirectory, ".atomic-api-codegen-test-"),
  );
  const generated = path.join(temporaryDirectory, "generated");

  try {
    await mkdir(generated);
    await writeFile(path.join(generated, "api.ts"), "old generation\n");
    const mutationScript = path.join(temporaryDirectory, "mutate.mjs");
    await writeFile(
      mutationScript,
      [
        'import { writeFile } from "node:fs/promises";',
        `await writeFile(${JSON.stringify(path.join(generated, "api.ts"))}, "new generation\\n");`,
        `await writeFile(${JSON.stringify(path.join(generated, "new.ts"))}, "new file\\n");`,
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [scriptPath, "--check"], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_CODEGEN_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(mutationScript)}`,
        API_CODEGEN_TARGETS: generated,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /differ from the current OpenAPI specification/,
    );
    assert.equal(
      await readFile(path.join(generated, "api.ts"), "utf8"),
      "old generation\n",
    );
    await assert.rejects(access(path.join(generated, "new.ts")), {
      code: "ENOENT",
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("check mode succeeds without changing matching generated files", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(scriptDirectory, ".atomic-api-codegen-test-"),
  );
  const generated = path.join(temporaryDirectory, "generated");

  try {
    await mkdir(generated);
    await writeFile(path.join(generated, "api.ts"), "current generation\n");
    const result = spawnSync(process.execPath, [scriptPath, "--check"], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_CODEGEN_COMMAND: `${JSON.stringify(process.execPath)} -e ""`,
        API_CODEGEN_TARGETS: generated,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /up to date/);
    assert.equal(
      await readFile(path.join(generated, "api.ts"), "utf8"),
      "current generation\n",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects a concurrent run before it can change generated files", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(scriptDirectory, ".atomic-api-codegen-test-"),
  );
  const generated = path.join(temporaryDirectory, "generated");
  const firstRunStarted = path.join(temporaryDirectory, "first-run-started");
  const releaseFirstRun = path.join(temporaryDirectory, "release-first-run");

  try {
    await mkdir(generated);
    await writeFile(path.join(generated, "api.ts"), "valid generation\n");

    const blockingScript = path.join(temporaryDirectory, "block.mjs");
    await writeFile(
      blockingScript,
      [
        'import { access, writeFile } from "node:fs/promises";',
        'import { setTimeout } from "node:timers/promises";',
        `await writeFile(${JSON.stringify(firstRunStarted)}, "started\\n");`,
        "for (;;) {",
        `  try { await access(${JSON.stringify(releaseFirstRun)}); break; }`,
        '  catch (error) { if (error.code !== "ENOENT") throw error; }',
        "  await setTimeout(10);",
        "}",
        `await writeFile(${JSON.stringify(path.join(generated, "api.ts"))}, "first generation\\n");`,
      ].join("\n"),
    );

    const environment = {
      ...process.env,
      API_CODEGEN_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(blockingScript)}`,
      API_CODEGEN_TARGETS: generated,
    };
    const firstRun = spawn(process.execPath, [scriptPath], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForFile(firstRunStarted);

    const secondRun = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: environment,
    });

    assert.notEqual(secondRun.status, 0);
    assert.match(secondRun.stderr, /another run already holds/);
    assert.equal(
      await readFile(path.join(generated, "api.ts"), "utf8"),
      "valid generation\n",
    );

    await writeFile(releaseFirstRun, "release\n");
    const firstRunResult = await waitForExit(firstRun);
    assert.equal(firstRunResult.code, 0, firstRunResult.stderr);
    assert.equal(
      await readFile(path.join(generated, "api.ts"), "utf8"),
      "first generation\n",
    );
  } finally {
    await rm(releaseFirstRun, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

for (const [signal, expectedExitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(
    `restores generated files and stops codegen after ${signal}`,
    { skip: process.platform === "win32" },
    async () => {
      const temporaryDirectory = await mkdtemp(
        path.join(scriptDirectory, ".atomic-api-codegen-test-"),
      );
      const generated = path.join(temporaryDirectory, "generated");
      const childStarted = path.join(temporaryDirectory, "child-started");
      const childPidFile = path.join(temporaryDirectory, "child-pid");

      try {
        await mkdir(generated);
        await writeFile(path.join(generated, "api.ts"), "valid generation\n");

        const blockingScript = path.join(
          temporaryDirectory,
          "mutate-and-block.mjs",
        );
        await writeFile(
          blockingScript,
          [
            'import { writeFile } from "node:fs/promises";',
            'import { setTimeout } from "node:timers/promises";',
            `await writeFile(${JSON.stringify(path.join(generated, "api.ts"))}, "partial generation\\n");`,
            `await writeFile(${JSON.stringify(childPidFile)}, String(process.pid));`,
            `await writeFile(${JSON.stringify(childStarted)}, "started\\n");`,
            "await setTimeout(60_000);",
          ].join("\n"),
        );

        const codegen = spawn(process.execPath, [scriptPath], {
          env: {
            ...process.env,
            API_CODEGEN_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(blockingScript)}`,
            API_CODEGEN_TARGETS: generated,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const exitPromise = waitForExit(codegen);

        await waitForFile(childStarted);
        const childPid = Number(await readFile(childPidFile, "utf8"));
        codegen.kill(signal);

        const result = await exitPromise;
        assert.equal(result.code, expectedExitCode, result.stderr);
        assert.equal(result.signal, null);
        assert.match(result.stderr, /previous generated files were restored/);
        assert.equal(
          await readFile(path.join(generated, "api.ts"), "utf8"),
          "valid generation\n",
        );
        await waitForProcessToStop(childPid);
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );
}

test(
  "restores generated files and stops the complete Windows codegen process tree",
  { skip: process.platform !== "win32" },
  async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(scriptDirectory, ".atomic-api-codegen-test-"),
    );
    const generated = path.join(temporaryDirectory, "generated");
    const childStarted = path.join(temporaryDirectory, "child-started");
    const childPidFile = path.join(temporaryDirectory, "child-pid");
    const grandchildPidFile = path.join(temporaryDirectory, "grandchild-pid");

    try {
      await mkdir(generated);
      await writeFile(path.join(generated, "api.ts"), "valid generation\n");

      const grandchildScript = path.join(temporaryDirectory, "grandchild.mjs");
      await writeFile(
        grandchildScript,
        [
          'import { writeFile } from "node:fs/promises";',
          'import { setTimeout } from "node:timers/promises";',
          `await writeFile(${JSON.stringify(grandchildPidFile)}, String(process.pid));`,
          "await setTimeout(60_000);",
        ].join("\n"),
      );

      const blockingScript = path.join(
        temporaryDirectory,
        "mutate-and-block.mjs",
      );
      await writeFile(
        blockingScript,
        [
          'import { spawn } from "node:child_process";',
          'import { writeFile } from "node:fs/promises";',
          'import { setTimeout } from "node:timers/promises";',
          `await writeFile(${JSON.stringify(path.join(generated, "api.ts"))}, "partial generation\\n");`,
          `await writeFile(${JSON.stringify(childPidFile)}, String(process.pid));`,
          `spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { stdio: "ignore" });`,
          `await writeFile(${JSON.stringify(childStarted)}, "started\\n");`,
          "await setTimeout(60_000);",
        ].join("\n"),
      );

      const codegen = spawn(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          API_CODEGEN_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(blockingScript)}`,
          API_CODEGEN_ENABLE_TEST_INTERRUPTS: "1",
          API_CODEGEN_TARGETS: generated,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const exitPromise = waitForExit(codegen);

      await waitForFile(childStarted);
      await waitForFile(grandchildPidFile);
      const childPid = Number(await readFile(childPidFile, "utf8"));
      const grandchildPid = Number(await readFile(grandchildPidFile, "utf8"));
      codegen.send({ type: "interrupt", signal: "SIGINT" });

      const result = await exitPromise;
      assert.equal(result.code, 130, result.stderr);
      assert.equal(result.signal, null);
      assert.match(result.stderr, /previous generated files were restored/);
      assert.equal(
        await readFile(path.join(generated, "api.ts"), "utf8"),
        "valid generation\n",
      );
      await Promise.all([
        waitForProcessToStop(childPid),
        waitForProcessToStop(grandchildPid),
      ]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await access(filePath);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${filePath}.`);
}

async function waitForExit(child) {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
  });
}

async function waitForProcessToStop(pid) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for process ${pid} to stop.`);
}
