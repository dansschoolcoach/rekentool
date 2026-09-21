import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { postgresJavaScriptTrimWhitespaceLiteral } from "../src/emailWhitespace.mjs";

const { Pool } = pg;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function normalizeParticipantEmails(pool, options = {}) {
  const { schema = "public", logger = console } = options;
  const participantsTable = `${quoteIdentifier(schema)}.${quoteIdentifier("participants")}`;
  const tableExists = await pool.query(
    "select to_regclass($1) is not null as exists",
    [`${schema}.participants`],
  );

  if (!tableExists.rows[0]?.exists) return true;

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`lock table ${participantsTable} in share row exclusive mode`);

    const emptyEmails = await client.query(`
        select count(*)::integer as participant_count
        from ${participantsTable}
        where translate(email, ${postgresJavaScriptTrimWhitespaceLiteral}, '') = ''
      `);

    if (emptyEmails.rows[0]?.participant_count > 0) {
      logger.error(
        `Database schema push stopped: ${emptyEmails.rows[0].participant_count} participant(s) have an empty email address or one containing only whitespace.`,
      );
      logger.error("Add a usable email address to these participants before retrying the schema push. No participant data was changed.");
      await client.query("rollback");
      return false;
    }

    const unusableEmails = await client.query(`
        select count(*)::integer as participant_count
        from ${participantsTable}
        where translate(lower(btrim(email)), ${postgresJavaScriptTrimWhitespaceLiteral}, '') <> lower(btrim(email))
           or lower(btrim(email)) !~ '^[^@]+@[^@]+\\.[^@]+$'
      `);

    if (unusableEmails.rows[0]?.participant_count > 0) {
      logger.error(
        `Database schema push stopped: ${unusableEmails.rows[0].participant_count} participant(s) have an unusable email address.`,
      );
      logger.error("Correct these participant email addresses before retrying the schema push. No participant data was changed.");
      await client.query("rollback");
      return false;
    }

    const duplicates = await client.query(`
        select lower(btrim(email)) as normalized_email, count(*)::integer as participant_count
        from ${participantsTable}
        group by lower(btrim(email))
        having count(*) > 1
        order by lower(btrim(email))
      `);

    if (duplicates.rowCount > 0) {
      logger.error(
        "Database schema push stopped: participants contain duplicate email addresses after trimming whitespace and ignoring capitalization.",
      );
      for (const duplicate of duplicates.rows) {
        logger.error(`- ${duplicate.normalized_email} (${duplicate.participant_count} participants)`);
      }
      logger.error("Resolve these duplicates safely before retrying the schema push.");
      await client.query("rollback");
      return false;
    }

    const normalized = await client.query(`
          update ${participantsTable}
          set email = lower(btrim(email))
          where email <> lower(btrim(email))
        `);
    await client.query("commit");
    if (normalized.rowCount > 0) {
      logger.log(`Normalized ${normalized.rowCount} participant email address(es) by trimming whitespace and converting to lowercase.`);
    }
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set before pushing the database schema.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let mayPush;
  try {
    mayPush = await normalizeParticipantEmails(pool);
  } finally {
    await pool.end();
  }

  if (!mayPush) {
    process.exitCode = 1;
    return;
  }

  const drizzleArguments = ["push"];
  if (process.argv.includes("--force")) drizzleArguments.push("--force");
  drizzleArguments.push("--config", "./drizzle.config.ts");

  const result = spawnSync(
    process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit",
    drizzleArguments,
    { cwd: new URL("..", import.meta.url), stdio: "inherit", shell: false },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}