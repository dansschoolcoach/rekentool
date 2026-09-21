import assert from "node:assert/strict";
import test from "node:test";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createIsolatedTestDatabase, getApplicationTableNames } from "./isolatedDatabase.ts";

test("discovers a newly exported application table without changing the isolated database helper", () => {
  const existingExport = pgTable("existing_test_table", {
    id: serial("id").primaryKey(),
  });
  const laterSchemaExtension = pgTable("later_schema_extension", {
    id: serial("id").primaryKey(),
    value: text("value").notNull(),
  });

  assert.deepEqual(
    getApplicationTableNames({
      existingExport,
      insertExistingSchema: { parse: () => undefined },
      laterSchemaExtension,
    }).sort(),
    ["existing_test_table", "later_schema_extension"],
  );
});

test("isolated databases reject rows that reference a missing parent", async () => {
  const isolated = await createIsolatedTestDatabase("foreign_key_regression");

  try {
    await assert.rejects(
      isolated.pool.query(
        `insert into weekly_entries (participant_id, week_number, signups, attendance, enrolled)
         values ($1, $2, $3, $4, $5)`,
        [2_147_483_647, 1, 0, 0, 0],
      ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "23503",
    );
  } finally {
    await isolated.dispose();
  }
});

test("isolated databases preserve CASCADE deletes from the public application schema", async () => {
  const isolated = await createIsolatedTestDatabase("foreign_key_cascade_regression");

  try {
    const participant = await isolated.pool.query<{ id: number }>(
      `insert into participants (school_name, contact_name, email)
       values ($1, $2, $3)
       returning id`,
      ["Testschool", "Testcontact", "cascade@example.com"],
    );
    const season = await isolated.pool.query<{ id: number }>(
      `insert into financial_seasons (participant_id, name, start_date, end_date, country)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [participant.rows[0].id, "Testseizoen", "2026-01-01", "2026-12-31", "Nederland"],
    );
    const teacher = await isolated.pool.query<{ id: number }>(
      `insert into financial_teachers (season_id, name, hourly_rate_cents)
       values ($1, $2, $3)
       returning id`,
      [season.rows[0].id, "Testdocent", 5_000],
    );

    await isolated.pool.query("delete from financial_seasons where id = $1", [season.rows[0].id]);

    const remainingTeacher = await isolated.pool.query(
      "select id from financial_teachers where id = $1",
      [teacher.rows[0].id],
    );
    assert.equal(remainingTeacher.rowCount, 0);
  } finally {
    await isolated.dispose();
  }
});

test("isolated databases preserve SET NULL deletes from the public application schema", async () => {
  const isolated = await createIsolatedTestDatabase("foreign_key_set_null_regression");

  try {
    const participant = await isolated.pool.query<{ id: number }>(
      `insert into participants (school_name, contact_name, email)
       values ($1, $2, $3)
       returning id`,
      ["Testschool", "Testcontact", "set-null@example.com"],
    );
    const season = await isolated.pool.query<{ id: number }>(
      `insert into financial_seasons (participant_id, name, start_date, end_date, country)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [participant.rows[0].id, "Testseizoen", "2026-01-01", "2026-12-31", "Nederland"],
    );
    const teacher = await isolated.pool.query<{ id: number }>(
      `insert into financial_teachers (season_id, name, hourly_rate_cents)
       values ($1, $2, $3)
       returning id`,
      [season.rows[0].id, "Testdocent", 5_000],
    );
    const lesson = await isolated.pool.query<{ id: number }>(
      `insert into financial_lessons
         (season_id, teacher_id, name, weekday, start_time, duration_minutes, active_from, active_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [season.rows[0].id, teacher.rows[0].id, "Testles", 1, "19:00", 60, "2026-01-01", "2026-12-31"],
    );

    await isolated.pool.query("delete from financial_teachers where id = $1", [teacher.rows[0].id]);

    const remainingLesson = await isolated.pool.query<{ teacher_id: number | null }>(
      "select teacher_id from financial_lessons where id = $1",
      [lesson.rows[0].id],
    );
    assert.equal(remainingLesson.rowCount, 1);
    assert.equal(remainingLesson.rows[0].teacher_id, null);
  } finally {
    await isolated.dispose();
  }
});
