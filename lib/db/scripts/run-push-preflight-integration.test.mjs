import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const runnerPrefix = "byb_push_preflight_test_";

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrlWithName(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

async function runRunner(env = {}, onOutput) {
  const child = spawn(
    process.execPath,
    ["./scripts/run-push-preflight-integration.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        PUSH_PREFLIGHT_INTEGRATION_TEST_FILE:
          "./scripts/run-push-preflight-integration.fixture.mjs",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    onOutput?.(output);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    onOutput?.(output);
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { ...result, output };
}

test(
  "removes only inactive stale databases created by this runner",
  { timeout: 30_000 },
  async () => {
    const adminDatabaseUrl = process.env.DATABASE_URL;
    assert.ok(adminDatabaseUrl, "DATABASE_URL is required for this test.");

    const suffix = `${process.pid}${Date.now()}`.slice(-12).padStart(12, "0");
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    const staleName = `${runnerPrefix}${oldTimestamp}_1_${suffix}`;
    const activeStaleName = `${runnerPrefix}${oldTimestamp}_2_${suffix}`;
    const recentName = `${runnerPrefix}${Date.now()}_3_${suffix}`;
    const legacyName = `${runnerPrefix}4_${suffix}`;
    const names = [staleName, activeStaleName, recentName, legacyName];
    const adminClient = new Client({ connectionString: adminDatabaseUrl });
    const activeClient = new Client({
      connectionString: databaseUrlWithName(adminDatabaseUrl, activeStaleName),
    });

    await adminClient.connect();
    try {
      for (const name of names) {
        await adminClient.query(`create database ${quoteIdentifier(name)}`);
      }
      await activeClient.connect();

      const result = await runRunner();
      assert.equal(result.code, 0, result.output);
      assert.equal(result.signal, null);

      const databases = await adminClient.query(
        "select datname from pg_database where datname = any($1::text[])",
        [names],
      );
      const remaining = new Set(databases.rows.map(({ datname }) => datname));
      assert.equal(remaining.has(staleName), false);
      assert.equal(remaining.has(activeStaleName), true);
      assert.equal(remaining.has(recentName), true);
      assert.equal(remaining.has(legacyName), true);
    } finally {
      await activeClient.end().catch(() => {});
      for (const name of names) {
        await adminClient.query(
          `select pg_terminate_backend(pid)
           from pg_stat_activity
           where datname = $1 and pid <> pg_backend_pid()`,
          [name],
        );
        await adminClient.query(
          `drop database if exists ${quoteIdentifier(name)}`,
        );
      }
      await adminClient.end();
    }
  },
);

test(
  "continues cleanup when a selected stale database becomes active",
  { timeout: 30_000 },
  async () => {
    const adminDatabaseUrl = process.env.DATABASE_URL;
    assert.ok(adminDatabaseUrl, "DATABASE_URL is required for this test.");

    const suffix = `${process.pid}${Date.now()}`.slice(-12).padStart(12, "0");
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    const activeStaleName = `${runnerPrefix}${oldTimestamp}_6_${suffix}`;
    const inactiveStaleName = `${runnerPrefix}${oldTimestamp}_7_${suffix}`;
    const names = [activeStaleName, inactiveStaleName];
    const adminClient = new Client({ connectionString: adminDatabaseUrl });
    const activeClient = new Client({
      connectionString: databaseUrlWithName(adminDatabaseUrl, activeStaleName),
    });
    let activation;

    await adminClient.connect();
    try {
      for (const name of names) {
        await adminClient.query(`create database ${quoteIdentifier(name)}`);
      }

      const result = await runRunner(
        { PUSH_PREFLIGHT_STALE_SELECTION_PAUSE_MS: "2000" },
        (output) => {
          if (
            !activation &&
            output.includes("Selected stale temporary test database candidates.")
          ) {
            activation = activeClient.connect();
          }
        },
      );
      await activation;

      assert.equal(result.code, 0, result.output);
      assert.equal(result.signal, null);

      const databases = await adminClient.query(
        "select datname from pg_database where datname = any($1::text[])",
        [names],
      );
      const remaining = new Set(databases.rows.map(({ datname }) => datname));
      assert.equal(remaining.has(activeStaleName), true);
      assert.equal(remaining.has(inactiveStaleName), false);
    } finally {
      await activeClient.end().catch(() => {});
      for (const name of names) {
        await adminClient.query(
          `select pg_terminate_backend(pid)
           from pg_stat_activity
           where datname = $1 and pid <> pg_backend_pid()`,
          [name],
        );
        await adminClient.query(
          `drop database if exists ${quoteIdentifier(name)}`,
        );
      }
      await adminClient.end();
    }
  },
);

test(
  "allows concurrent runners to clean up the same stale database",
  { timeout: 30_000 },
  async () => {
    const adminDatabaseUrl = process.env.DATABASE_URL;
    assert.ok(adminDatabaseUrl, "DATABASE_URL is required for this test.");

    const suffix = `${process.pid}${Date.now()}`.slice(-12).padStart(12, "0");
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    const staleName = `${runnerPrefix}${oldTimestamp}_5_${suffix}`;
    const adminClient = new Client({ connectionString: adminDatabaseUrl });

    await adminClient.connect();
    try {
      await adminClient.query(`create database ${quoteIdentifier(staleName)}`);

      const results = await Promise.all([runRunner(), runRunner()]);
      for (const result of results) {
        assert.equal(result.code, 0, result.output);
        assert.equal(result.signal, null);
      }

      const database = await adminClient.query(
        "select 1 from pg_database where datname = $1",
        [staleName],
      );
      assert.equal(database.rowCount, 0);
    } finally {
      await adminClient.query(
        `drop database if exists ${quoteIdentifier(staleName)}`,
      );
      await adminClient.end();
    }
  },
);

for (const interruptionSignal of ["SIGINT", "SIGTERM"]) {
  test(
    `removes its temporary database before propagating ${interruptionSignal}`,
    { timeout: 30_000 },
    async () => {
    const adminDatabaseUrl = process.env.DATABASE_URL;
    assert.ok(adminDatabaseUrl, "DATABASE_URL is required for this test.");

    const child = spawn(
      process.execPath,
      ["./scripts/run-push-preflight-integration.mjs"],
      {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          PUSH_PREFLIGHT_INTEGRATION_TEST_FILE:
            "./scripts/run-push-preflight-integration.fixture.mjs",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(
        /Created temporary test database ([a-zA-Z0-9_]+)\./,
      );
      if (match) {
        child.kill(interruptionSignal);
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });

    const { code, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (exitCode, exitSignal) => {
        resolve({ code: exitCode, signal: exitSignal });
      });
    });

    const databaseName = output.match(
      /Created temporary test database ([a-zA-Z0-9_]+)\./,
    )?.[1];
    assert.ok(databaseName, `Runner did not report a database name:\n${output}`);
    assert.equal(code, null);
    assert.equal(signal, interruptionSignal);

    const adminClient = new Client({ connectionString: adminDatabaseUrl });
    await adminClient.connect();
    try {
      const result = await adminClient.query(
        "select 1 from pg_database where datname = $1",
        [databaseName],
      );
      assert.equal(
        result.rowCount,
        0,
        `Temporary database ${databaseName} still exists.`,
      );
    } finally {
      await adminClient.end();
    }
    },
  );
}