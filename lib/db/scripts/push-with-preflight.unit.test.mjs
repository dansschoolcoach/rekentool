import assert from "node:assert/strict";
import test from "node:test";
import { javascriptTrimWhitespaceCodePoints } from "../src/emailWhitespace.mjs";
import { normalizeParticipantEmails } from "./push-with-preflight.mjs";

test("keeps the shared whitespace codepoints aligned with JavaScript trim", () => {
  const sharedCodePoints = new Set(javascriptTrimWhitespaceCodePoints);
  const runtimeCodePoints = new Set();

  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (String.fromCodePoint(codePoint).trim() === "") {
      runtimeCodePoints.add(codePoint);
    }
  }

  const formatCodePoints = (codePoints) =>
    codePoints
      .map((codePoint) => `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`)
      .join(", ");
  const missingCodePoints = [...runtimeCodePoints].filter(
    (codePoint) => !sharedCodePoints.has(codePoint),
  );
  const extraCodePoints = [...sharedCodePoints].filter(
    (codePoint) => !runtimeCodePoints.has(codePoint),
  );
  const differences = [
    missingCodePoints.length > 0
      ? `Missing codepoints recognized by JavaScript trim: ${formatCodePoints(missingCodePoints)}`
      : null,
    extraCodePoints.length > 0
      ? `Extra codepoints not recognized by JavaScript trim: ${formatCodePoints(extraCodePoints)}`
      : null,
  ].filter(Boolean);

  assert.equal(
    differences.length,
    0,
    `Shared JavaScript trim whitespace is out of sync.\n${differences.join("\n")}`,
  );
});

test("accepts an isolated schema without a participants table without changing anything", async () => {
  const queries = [];
  const pool = {
    async query(query, values) {
      queries.push({ query, values });
      return { rows: [{ exists: false }] };
    },
    async connect() {
      assert.fail("The preflight must not open a transaction when participants is absent.");
    },
  };
  const logs = [];
  const errors = [];

  const mayPush = await normalizeParticipantEmails(pool, {
    schema: "empty_isolated_schema",
    logger: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  });

  assert.equal(mayPush, true);
  assert.deepEqual(queries, [
    {
      query: "select to_regclass($1) is not null as exists",
      values: ["empty_isolated_schema.participants"],
    },
  ]);
  assert.deepEqual(logs, []);
  assert.deepEqual(errors, []);
});