import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const supportedSignals = ["SIGINT", "SIGTERM"];
const testDatabasePrefix = "byb_push_preflight_test_";
const staleDatabaseAgeMs = 24 * 60 * 60 * 1000;
let activeTestProcess;
let receivedSignal;

for (const signal of supportedSignals) {
  process.once(signal, () => {
    receivedSignal ??= signal;
    activeTestProcess?.kill(signal);
  });
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrlWithName(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

function temporaryDatabaseName(createdAt = Date.now()) {
  const randomSuffix = randomUUID().replaceAll("-", "").slice(0, 12);
  return `${testDatabasePrefix}${createdAt}_${process.pid}_${randomSuffix}`;
}

function temporaryDatabaseCreatedAt(databaseName) {
  const match = databaseName.match(
    /^byb_push_preflight_test_(\d{13})_\d+_[a-f0-9]{12}$/,
  );
  if (!match) {
    return undefined;
  }

  const createdAt = Number(match[1]);
  return Number.isSafeInteger(createdAt) ? createdAt : undefined;
}

async function removeStaleTestDatabases(adminClient, now = Date.now()) {
  const result = await adminClient.query(
    `select d.datname
     from pg_database d
     where d.datname like $1 escape '\\'
       and not exists (
         select 1 from pg_stat_activity a where a.datname = d.datname
       )`,
    [`${testDatabasePrefix.replaceAll("_", "\\_")}%`],
  );

  const selectionPauseMs = Number.parseInt(
    process.env.PUSH_PREFLIGHT_STALE_SELECTION_PAUSE_MS ?? "",
    10,
  );
  if (Number.isSafeInteger(selectionPauseMs) && selectionPauseMs > 0) {
    console.log("Selected stale temporary test database candidates.");
    await new Promise((resolve) => setTimeout(resolve, selectionPauseMs));
  }

  for (const { datname } of result.rows) {
    const createdAt = temporaryDatabaseCreatedAt(datname);
    if (createdAt === undefined || now - createdAt < staleDatabaseAgeMs) {
      continue;
    }

    try {
      await adminClient.query(
        `drop database if exists ${quoteIdentifier(datname)}`,
      );
      console.log(`Removed stale temporary test database ${datname}.`);
    } catch (error) {
      if (error?.code !== "55006") {
        throw error;
      }
    }
  }
}

function runIntegrationTests(testDatabaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--test",
        process.env.PUSH_PREFLIGHT_INTEGRATION_TEST_FILE ??
          "./scripts/push-with-preflight.test.mjs",
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          TEST_DATABASE_URL: testDatabaseUrl,
        },
        stdio: "inherit",
      },
    );
    activeTestProcess = child;

    child.once("error", (error) => {
      activeTestProcess = undefined;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      activeTestProcess = undefined;
      if (receivedSignal) {
        resolve(1);
        return;
      }
      if (signal) {
        reject(new Error(`Integration tests were terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Database integration tests may not run in production.");
  }

  const adminDatabaseUrl = process.env.DATABASE_URL;
  if (!adminDatabaseUrl) {
    throw new Error(
      "DATABASE_URL is required to provision a temporary integration-test database.",
    );
  }

  const databaseName = temporaryDatabaseName();
  const quotedDatabaseName = quoteIdentifier(databaseName);
  const testDatabaseUrl = databaseUrlWithName(adminDatabaseUrl, databaseName);
  const adminClient = new Client({ connectionString: adminDatabaseUrl });
  let databaseCreated = false;

  await adminClient.connect();
  try {
    await removeStaleTestDatabases(adminClient);
    await adminClient.query(`create database ${quotedDatabaseName}`);
    databaseCreated = true;
    console.log(`Created temporary test database ${databaseName}.`);

    if (!receivedSignal) {
      const exitCode = await runIntegrationTests(testDatabaseUrl);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    }
  } finally {
    try {
      if (databaseCreated) {
        await adminClient.query(
          `select pg_terminate_backend(pid)
           from pg_stat_activity
           where datname = $1 and pid <> pg_backend_pid()`,
          [databaseName],
        );
        await adminClient.query(`drop database if exists ${quotedDatabaseName}`);
        console.log(`Removed temporary test database ${databaseName}.`);
      }
    } finally {
      await adminClient.end();
    }
  }
}

await main();

if (receivedSignal) {
  for (const signal of supportedSignals) {
    process.removeAllListeners(signal);
  }
  process.kill(process.pid, receivedSignal);
}