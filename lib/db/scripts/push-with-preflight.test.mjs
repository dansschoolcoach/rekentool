import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { javascriptTrimWhitespaceCodePoints } from "../src/emailWhitespace.mjs";
import { normalizeParticipantEmails } from "./push-with-preflight.mjs";

const { Pool } = pg;
const CONCURRENCY_LOCK_TIMEOUT_MS = 2_000;
const CONCURRENCY_STATEMENT_TIMEOUT_MS = 4_000;

function getTestDatabaseUrl() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(
    testDatabaseUrl,
    "TEST_DATABASE_URL is required for database integration tests.",
  );
  assert.notEqual(
    testDatabaseUrl,
    process.env.DATABASE_URL,
    "TEST_DATABASE_URL must not point to the development database.",
  );
  return testDatabaseUrl;
}

async function withIsolatedParticipantsTable(run) {
  assert.notEqual(
    process.env.NODE_ENV,
    "production",
    "Database integration tests may not run in production.",
  );

  const pool = new Pool({ connectionString: getTestDatabaseUrl() });
  const schema = `email_preflight_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  let schemaCreated = false;

  try {
    const database = await pool.query("select current_database() as name");
    assert.match(
      database.rows[0]?.name ?? "",
      /(?:^|[_-])test(?:$|[_-])/i,
      "TEST_DATABASE_URL must point to a database whose name identifies it as a test database.",
    );
    await pool.query(`create schema "${schema}"`);
    schemaCreated = true;
    await pool.query(`
      create table "${schema}".participants (
        id integer generated always as identity primary key,
        email text not null
      )
    `);
    await run({ pool, schema });
  } finally {
    try {
      if (schemaCreated) {
        await pool.query(`drop schema if exists "${schema}" cascade`);
      }
    } finally {
      await pool.end();
    }
  }
}

function captureLogger() {
  const logs = [];
  const errors = [];
  return {
    logs,
    errors,
    logger: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  };
}

async function waitForDatabaseCondition(pool, query, values, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query(query, values);
    if (result.rows[0]?.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

async function configureConcurrencyWriter(client) {
  await client.query(`set lock_timeout = '${CONCURRENCY_LOCK_TIMEOUT_MS}ms'`);
  await client.query(
    `set statement_timeout = '${CONCURRENCY_STATEMENT_TIMEOUT_MS}ms'`,
  );
}

async function resetConcurrencyWriter(client) {
  await client.query("reset lock_timeout");
  await client.query("reset statement_timeout");
}

function withConcurrencyTransactionTimeouts(pool) {
  return {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, property) {
          if (property === "query") {
            return async (query, values) => {
              const result = await target.query(query, values);
              if (
                typeof query === "string" &&
                query.toLowerCase() === "begin"
              ) {
                await target.query(
                  `set local lock_timeout = '${CONCURRENCY_LOCK_TIMEOUT_MS}ms'`,
                );
                await target.query(
                  `set local statement_timeout = '${CONCURRENCY_STATEMENT_TIMEOUT_MS}ms'`,
                );
              }
              return result;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}

test("normalizes unique participant emails by trimming whitespace and converting to lowercase", async () => {
  await withIsolatedParticipantsTable(async ({ pool, schema }) => {
    await pool.query(
      `insert into "${schema}".participants (email) values ($1), ($2), ($3)`,
      [" Alice@Example.COM ", "  BOB@example.com", "carol@example.com"],
    );
    const output = captureLogger();

    const mayPush = await normalizeParticipantEmails(pool, {
      schema,
      logger: output.logger,
    });

    assert.equal(mayPush, true);
    const result = await pool.query(
      `select email from "${schema}".participants order by id`,
    );
    assert.deepEqual(
      result.rows.map(({ email }) => email),
      ["alice@example.com", "bob@example.com", "carol@example.com"],
    );
    assert.deepEqual(output.errors, []);
    assert.deepEqual(output.logs, [
      "Normalized 2 participant email address(es) by trimming whitespace and converting to lowercase.",
    ]);
  });
});

test("leaves empty participant emails unchanged and clearly blocks the push", async () => {
  await withIsolatedParticipantsTable(async ({ pool, schema }) => {
    const originalEmails = [
      "",
      ...javascriptTrimWhitespaceCodePoints.map((codePoint) =>
        String.fromCodePoint(codePoint),
      ),
      " Valid@Example.com ",
    ];
    const placeholders = originalEmails
      .map((_, index) => `($${index + 1})`)
      .join(", ");
    await pool.query(
      `insert into "${schema}".participants (email) values ${placeholders}`,
      originalEmails,
    );
    const output = captureLogger();

    const mayPush = await normalizeParticipantEmails(pool, {
      schema,
      logger: output.logger,
    });

    assert.equal(mayPush, false);
    const result = await pool.query(
      `select email from "${schema}".participants order by id`,
    );
    assert.deepEqual(
      result.rows.map(({ email }) => email),
      originalEmails,
    );
    assert.deepEqual(output.logs, []);
    assert.match(
      output.errors[0],
      new RegExp(
        `${javascriptTrimWhitespaceCodePoints.length + 1} participant\\(s\\).*empty email address.*whitespace`,
        "i",
      ),
    );
    assert.match(output.errors.at(-1), /no participant data was changed/i);
  });
});

test("leaves unusable participant emails unchanged and clearly blocks the push", async () => {
  await withIsolatedParticipantsTable(async ({ pool, schema }) => {
    const originalEmails = [
      "coach.example.test",
      "coach@",
      "coach@example",
      "coach @example.test",
      " Valid@Example.com ",
    ];
    await pool.query(
      `insert into "${schema}".participants (email) values ($1), ($2), ($3), ($4), ($5)`,
      originalEmails,
    );
    const output = captureLogger();

    const mayPush = await normalizeParticipantEmails(pool, {
      schema,
      logger: output.logger,
    });

    assert.equal(mayPush, false);
    const result = await pool.query(
      `select email from "${schema}".participants order by id`,
    );
    assert.deepEqual(
      result.rows.map(({ email }) => email),
      originalEmails,
    );
    assert.deepEqual(output.logs, []);
    assert.match(
      output.errors[0],
      /4 participant\(s\).*unusable email address/i,
    );
    assert.match(output.errors.at(-1), /no participant data was changed/i);
  });
});

test("leaves canonical duplicates unchanged and clearly blocks the push", async () => {
  await withIsolatedParticipantsTable(async ({ pool, schema }) => {
    const originalEmails = [
      " Duplicate@Example.com",
      "duplicate@example.COM ",
      "Other@Example.com",
    ];
    await pool.query(
      `insert into "${schema}".participants (email) values ($1), ($2), ($3)`,
      originalEmails,
    );
    const output = captureLogger();

    const mayPush = await normalizeParticipantEmails(pool, {
      schema,
      logger: output.logger,
    });

    assert.equal(mayPush, false);
    const result = await pool.query(
      `select email from "${schema}".participants order by id`,
    );
    assert.deepEqual(
      result.rows.map(({ email }) => email),
      originalEmails,
    );
    assert.deepEqual(output.logs, []);
    assert.match(output.errors[0], /schema push stopped/i);
    assert.ok(
      output.errors.includes("- duplicate@example.com (2 participants)"),
    );
    assert.match(
      output.errors.at(-1),
      /resolve these duplicates safely before retrying/i,
    );
  });
});

test("releases a waiting participant update when duplicate detection rolls back", async () => {
  await withIsolatedParticipantsTable(async ({ pool, schema }) => {
    const advisoryLockKey = Number.parseInt(
      randomUUID().replaceAll("-", "").slice(0, 7),
      16,
    );
    const writerApplicationName = `email-rollback-writer-${randomUUID()}`;
    const controlClient = await pool.connect();
    const writerClient = await pool.connect();
    let duplicateCheckStarted;
    const duplicateCheckIsStarted = new Promise((resolve) => {
      duplicateCheckStarted = resolve;
    });

    try {
      await configureConcurrencyWriter(writerClient);
      const participants = await pool.query(
        `insert into "${schema}".participants (email) values ($1), ($2), ($3) returning id`,
        [
          " Duplicate@Example.com",
          "duplicate@example.COM ",
          "other@example.com",
        ],
      );
      const participantToUpdate = participants.rows[2].id;
      await controlClient.query("select pg_advisory_lock($1)", [
        advisoryLockKey,
      ]);
      await writerClient.query(
        "select set_config('application_name', $1, false)",
        [writerApplicationName],
      );

      const pausingPool = {
        query: (...args) => pool.query(...args),
        async connect() {
          const client = await pool.connect();
          return new Proxy(client, {
            get(target, property) {
              if (property === "query") {
                return async (query, values) => {
                  if (
                    typeof query === "string" &&
                    query.toLowerCase() === "begin"
                  ) {
                    const result = await target.query(query, values);
                    await target.query(
                      `set local lock_timeout = '${CONCURRENCY_LOCK_TIMEOUT_MS}ms'`,
                    );
                    await target.query(
                      `set local statement_timeout = '${CONCURRENCY_STATEMENT_TIMEOUT_MS}ms'`,
                    );
                    return result;
                  }
                  if (
                    typeof query === "string" &&
                    query.includes("having count(*) > 1")
                  ) {
                    duplicateCheckStarted();
                    await target.query("select pg_advisory_xact_lock($1)", [
                      advisoryLockKey,
                    ]);
                  }
                  return target.query(query, values);
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };

      const output = captureLogger();
      const preflight = normalizeParticipantEmails(pausingPool, {
        schema,
        logger: output.logger,
      });
      await duplicateCheckIsStarted;

      const concurrentUpdate = writerClient.query(
        `update "${schema}".participants set email = $1 where id = $2`,
        ["updated@example.com", participantToUpdate],
      );
      await waitForDatabaseCondition(
        pool,
        `select exists (
          select 1
          from pg_stat_activity
          where application_name = $1 and wait_event_type = 'Lock'
        ) as ready`,
        [writerApplicationName],
        "the concurrent participant update to wait on the preflight table lock",
      );

      await controlClient.query("select pg_advisory_unlock($1)", [
        advisoryLockKey,
      ]);
      assert.equal(await preflight, false);
      assert.equal((await concurrentUpdate).rowCount, 1);

      const result = await pool.query(
        `select email from "${schema}".participants order by id`,
      );
      assert.deepEqual(
        result.rows.map(({ email }) => email),
        [
          " Duplicate@Example.com",
          "duplicate@example.COM ",
          "updated@example.com",
        ],
      );
      assert.ok(
        output.errors.includes("- duplicate@example.com (2 participants)"),
      );
    } finally {
      await controlClient.query("select pg_advisory_unlock($1)", [
        advisoryLockKey,
      ]);
      await resetConcurrencyWriter(writerClient);
      controlClient.release();
      writerClient.release();
    }
  });
});

test("blocks a concurrent participant change until checking and normalization finish", async () => {
  await withIsolatedParticipantsTable(async ({ pool, schema }) => {
    const advisoryLockKey = Number.parseInt(
      randomUUID().replaceAll("-", "").slice(0, 7),
      16,
    );
    const writerApplicationName = `email-preflight-writer-${randomUUID()}`;
    const controlClient = await pool.connect();
    const writerClient = await pool.connect();

    try {
      await configureConcurrencyWriter(writerClient);
      await pool.query(
        `insert into "${schema}".participants (email) values ($1)`,
        [" Alice@Example.com "],
      );
      await pool.query(`create sequence "${schema}".normalization_started`);
      await pool.query(`
        create function "${schema}".pause_email_normalization()
        returns trigger
        language plpgsql
        as $$
        begin
          perform nextval('"${schema}".normalization_started');
          perform pg_advisory_xact_lock(${advisoryLockKey});
          return new;
        end
        $$
      `);
      await pool.query(`
        create trigger pause_email_normalization
        before update on "${schema}".participants
        for each statement execute function "${schema}".pause_email_normalization()
      `);
      await controlClient.query("select pg_advisory_lock($1)", [
        advisoryLockKey,
      ]);
      await writerClient.query(
        "select set_config('application_name', $1, false)",
        [writerApplicationName],
      );

      const firstOutput = captureLogger();
      const preflight = normalizeParticipantEmails(
        withConcurrencyTransactionTimeouts(pool),
        {
          schema,
          logger: firstOutput.logger,
        },
      );
      await waitForDatabaseCondition(
        pool,
        `select is_called as ready from "${schema}".normalization_started`,
        [],
        "the preflight normalization to pause after its duplicate check",
      );

      const concurrentWrite = writerClient.query(
        `insert into "${schema}".participants (email) values ($1)`,
        ["alice@example.com"],
      );
      await waitForDatabaseCondition(
        pool,
        `select exists (
          select 1
          from pg_stat_activity
          where application_name = $1 and wait_event_type = 'Lock'
        ) as ready`,
        [writerApplicationName],
        "the concurrent participant write to wait on the table lock",
      );

      await controlClient.query("select pg_advisory_unlock($1)", [
        advisoryLockKey,
      ]);
      assert.equal(await preflight, true);
      assert.equal((await concurrentWrite).rowCount, 1);

      const secondOutput = captureLogger();
      assert.equal(
        await normalizeParticipantEmails(pool, {
          schema,
          logger: secondOutput.logger,
        }),
        false,
      );
      assert.ok(
        secondOutput.errors.includes("- alice@example.com (2 participants)"),
      );
    } finally {
      await controlClient.query("select pg_advisory_unlock($1)", [
        advisoryLockKey,
      ]);
      await resetConcurrencyWriter(writerClient);
      controlClient.release();
      writerClient.release();
    }
  });
});

test("blocks a concurrent participant email update and detects its case-insensitive conflict", async () => {
  await withIsolatedParticipantsTable(async ({ pool, schema }) => {
    const advisoryLockKey = Number.parseInt(
      randomUUID().replaceAll("-", "").slice(0, 7),
      16,
    );
    const writerApplicationName = `email-update-writer-${randomUUID()}`;
    const controlClient = await pool.connect();
    const writerClient = await pool.connect();

    try {
      await configureConcurrencyWriter(writerClient);
      const participants = await pool.query(
        `insert into "${schema}".participants (email) values ($1), ($2) returning id`,
        [" Alice@Example.com ", "bob@example.com"],
      );
      const participantToUpdate = participants.rows[1].id;
      await pool.query(`create sequence "${schema}".normalization_started`);
      await pool.query(`
        create function "${schema}".pause_email_normalization()
        returns trigger
        language plpgsql
        as $$
        begin
          perform nextval('"${schema}".normalization_started');
          perform pg_advisory_xact_lock(${advisoryLockKey});
          return new;
        end
        $$
      `);
      await pool.query(`
        create trigger pause_email_normalization
        before update on "${schema}".participants
        for each statement execute function "${schema}".pause_email_normalization()
      `);
      await controlClient.query("select pg_advisory_lock($1)", [
        advisoryLockKey,
      ]);
      await writerClient.query(
        "select set_config('application_name', $1, false)",
        [writerApplicationName],
      );

      const firstOutput = captureLogger();
      const preflight = normalizeParticipantEmails(
        withConcurrencyTransactionTimeouts(pool),
        {
          schema,
          logger: firstOutput.logger,
        },
      );
      await waitForDatabaseCondition(
        pool,
        `select is_called as ready from "${schema}".normalization_started`,
        [],
        "the preflight normalization to pause after its duplicate check",
      );

      const concurrentUpdate = writerClient.query(
        `update "${schema}".participants set email = $1 where id = $2`,
        ["ALICE@EXAMPLE.COM", participantToUpdate],
      );
      await waitForDatabaseCondition(
        pool,
        `select exists (
          select 1
          from pg_stat_activity
          where application_name = $1 and wait_event_type = 'Lock'
        ) as ready`,
        [writerApplicationName],
        "the concurrent participant update to wait on the table lock",
      );

      await controlClient.query("select pg_advisory_unlock($1)", [
        advisoryLockKey,
      ]);
      assert.equal(await preflight, true);
      assert.equal((await concurrentUpdate).rowCount, 1);

      const secondOutput = captureLogger();
      assert.equal(
        await normalizeParticipantEmails(pool, {
          schema,
          logger: secondOutput.logger,
        }),
        false,
      );
      assert.ok(
        secondOutput.errors.includes("- alice@example.com (2 participants)"),
      );
    } finally {
      await controlClient.query("select pg_advisory_unlock($1)", [
        advisoryLockKey,
      ]);
      await resetConcurrencyWriter(writerClient);
      controlClient.release();
      writerClient.release();
    }
  });
});
