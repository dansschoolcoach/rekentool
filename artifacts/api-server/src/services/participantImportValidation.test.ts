import test from "node:test";
import assert from "node:assert/strict";
import {
  validateParticipantImportRows,
  type ParticipantImportSourceRow,
} from "./participantImportValidation.ts";

test("participant import reports empty email cells with their source row and participant", () => {
  const rows: ParticipantImportSourceRow[] = [
    { row: 2, schoolName: "Dansschool Noord", contactName: "Nina", email: "nina@example.test" },
    { row: 4, schoolName: "Dansschool Zuid", contactName: "Sam", email: "" },
  ];

  const result = validateParticipantImportRows(rows);

  assert.deepEqual(result.issues, [{
    row: 4,
    column: "E-mailadres",
    participant: "Dansschool Zuid",
    message: "Rij 4 (Dansschool Zuid): vul een e-mailadres in.",
  }]);
  assert.deepEqual(result.rows, rows);
  assert.equal(result.rows[0], rows[0]);
});

test("participant import reports whitespace-only email cells before persistence", () => {
  const rows: ParticipantImportSourceRow[] = [
    { row: 7, schoolName: "Dansschool West", contactName: "Alex", email: " \t\n " },
    { row: 8, schoolName: "Dansschool Oost", contactName: "Bo", email: "bo@example.test" },
  ];

  const result = validateParticipantImportRows(rows);

  assert.deepEqual(result.issues, [{
    row: 7,
    column: "E-mailadres",
    participant: "Dansschool West",
    message: "Rij 7 (Dansschool West): vul een e-mailadres in.",
  }]);
  assert.deepEqual(result.rows, rows);
  assert.equal(result.rows[1], rows[1]);
});

test("participant import reports every affected row and leaves valid rows unchanged", () => {
  const rows = [
    { row: 2, schoolName: "A", email: null, metadata: { source: "ledenlijst" } },
    { row: 3, schoolName: "B", email: " b@example.test ", metadata: { source: "ledenlijst" } },
    { row: 6, schoolName: "C", email: undefined, metadata: { source: "ledenlijst" } },
  ];

  const result = validateParticipantImportRows(rows);

  assert.deepEqual(result.issues.map(issue => issue.row), [2, 6]);
  assert.strictEqual(result.rows, rows);
  assert.deepEqual(result.rows[1], {
    row: 3,
    schoolName: "B",
    email: " b@example.test ",
    metadata: { source: "ledenlijst" },
  });
});

test("participant import reports every syntactically unusable email address", () => {
  const rows: ParticipantImportSourceRow[] = [
    { row: 2, schoolName: "Geen apenstaart", email: "coach.example.test" },
    { row: 3, schoolName: "Geen domeinnaam", email: "coach@" },
    { row: 4, schoolName: "Geen domeinpunt", email: "coach@example" },
    { row: 5, schoolName: "Witruimte", email: "coach @example.test" },
    { row: 6, schoolName: "Geldig", email: "coach+challenge@example.test" },
  ];

  const result = validateParticipantImportRows(rows);

  assert.deepEqual(result.issues.map(issue => ({
    row: issue.row,
    message: issue.message,
  })), [
    { row: 2, message: "Rij 2 (Geen apenstaart): vul een geldig e-mailadres in." },
    { row: 3, message: "Rij 3 (Geen domeinnaam): vul een geldig e-mailadres in." },
    { row: 4, message: "Rij 4 (Geen domeinpunt): vul een geldig e-mailadres in." },
    { row: 5, message: "Rij 5 (Witruimte): vul een geldig e-mailadres in." },
  ]);
  assert.strictEqual(result.rows, rows);
});