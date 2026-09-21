import assert from "node:assert/strict";
import test, { after } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  db,
  participantsTable,
  pool,
} from "@workspace/db";
import {
  javascriptTrimWhitespaceCodePoints,
  postgresJavaScriptTrimWhitespaceLiteral,
} from "@workspace/db/email-whitespace";
import {
  createAdminParticipantsRouter,
  isParticipantEmailConflict,
  type AdminParticipantsRouterOptions,
} from "./challenge.ts";
import { isUsableParticipantEmail } from "../services/participantImportValidation.ts";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";

const conflictMessage = { error: "Er bestaat al een deelnemer met dit e-mailadres." };
const unicodeCodePointLabel = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
const participantBody = (email: string, schoolName = "Dansschool") => ({
  schoolName,
  contactName: "Beheerder",
  email,
  country: "Nederland",
});

async function startApp(database: typeof db, overrides: Partial<AdminParticipantsRouterOptions> = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info() {} } as unknown as Request["log"];
    next();
  });
  app.use("/admin/participants", createAdminParticipantsRouter({
    database,
    signedInMiddleware: (_req, _res, next) => next(),
    adminMiddleware: async (_req, _res, next) => next(),
    ...overrides,
  }));
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Interne serverfout." });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function jsonRequest(baseUrl: string, path: string, method: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as unknown };
}

after(async () => {
  await pool.end();
});

test("recognizes the case-insensitive participant email index", () => {
  assert.equal(isParticipantEmailConflict({
    code: "23505",
    constraint: "participants_email_lower_unique",
  }), true);
  assert.equal(isParticipantEmailConflict({
    cause: {
      code: "23505",
      constraint: "participants_lower_idx",
    },
  }), true);
});

test("keeps compatibility with the previous participant email constraint", () => {
  assert.equal(isParticipantEmailConflict({
    code: "23505",
    constraint: "participants_email_unique",
  }), true);
  assert.equal(isParticipantEmailConflict({
    code: "23505",
    constraint: "participants_email_key",
  }), true);
});

test("does not disguise unrelated database errors as email conflicts", () => {
  assert.equal(isParticipantEmailConflict({
    code: "23505",
    constraint: "participants_clerk_user_id_unique",
  }), false);
  assert.equal(isParticipantEmailConflict(new Error("database unavailable")), false);
});

test("keeps the documented JavaScript trim whitespace set aligned with the runtime", () => {
  const documentedCodePoints = new Set<number>(javascriptTrimWhitespaceCodePoints);

  for (const codePoint of documentedCodePoints) {
    assert.equal(
      String.fromCodePoint(codePoint).trim(),
      "",
      `${unicodeCodePointLabel(codePoint)} is documented as JavaScript trim whitespace but the runtime did not trim it`,
    );
  }

  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (String.fromCodePoint(codePoint).trim() === "") {
      assert.equal(
        documentedCodePoints.has(codePoint),
        true,
        `${unicodeCodePointLabel(codePoint)} is trimmed by the runtime but is missing from the documented JavaScript trim whitespace set`,
      );
    }
  }
});

test("POST rejects an existing participant email with different casing", async () => {
  const isolated = await createIsolatedTestDatabase("participant_email_post");
  const app = await startApp(isolated.db);
  try {
    const first = await jsonRequest(app.baseUrl, "/admin/participants", "POST", participantBody("Coach@Example.test"));
    const duplicate = await jsonRequest(app.baseUrl, "/admin/participants", "POST", participantBody("coach@example.TEST", "Andere school"));

    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, conflictMessage);
    const [stored] = await isolated.db.select().from(participantsTable);
    assert.equal(stored.email, "coach@example.test");
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("database rejects non-canonical participant emails from direct imports", async () => {
  const isolated = await createIsolatedTestDatabase("participant_email_import");
  try {
    await isolated.pool.query(`
      alter table participants
      drop constraint if exists participants_email_lowercase,
      drop constraint if exists participants_email_canonical,
      drop constraint if exists participants_email_usable,
       add constraint participants_email_canonical check (
         translate(email, ${postgresJavaScriptTrimWhitespaceLiteral}, '') <> ''
         and email = lower(btrim(email))
       ),
       add constraint participants_email_usable check (
         translate(email, ${postgresJavaScriptTrimWhitespaceLiteral}, '') = email
         and email ~ '^[^@]+@[^@]+\\.[^@]+$'
       )
    `);
    await assert.rejects(
      isolated.db.insert(participantsTable).values(participantBody(" import@example.test ")),
      (error: unknown) => {
        const databaseError = (error as { cause?: { code?: string; constraint?: string } }).cause;
        return databaseError?.code === "23514"
          && databaseError.constraint === "participants_email_canonical";
      },
    );
    for (const email of ["", "   ", "\t", "\n", "\u00a0", "\ufeff"]) {
      await assert.rejects(
        isolated.db.insert(participantsTable).values(participantBody(email)),
        (error: unknown) => {
          const databaseError = (error as { cause?: { code?: string; constraint?: string } }).cause;
          return databaseError?.code === "23514"
            && databaseError.constraint === "participants_email_canonical";
        },
      );
    }
    for (const email of ["coach.example.test", "coach@", "coach@example"]) {
      await assert.rejects(
        isolated.db.insert(participantsTable).values(participantBody(email)),
        (error: unknown) => {
          const databaseError = (error as { cause?: { code?: string; constraint?: string } }).cause;
          return databaseError?.code === "23514"
            && databaseError.constraint === "participants_email_usable";
        },
      );
    }
  } finally {
    await isolated.dispose();
  }
});

test("API and database agree on usable participant email formats", async () => {
  const isolated = await createIsolatedTestDatabase("participant_email_contract");
  const cases = [
    { email: "coach@example.test", usable: true },
    { email: "coach+challenge@example.test", usable: true },
    { email: "voornaam.achternaam@sub.example.test", usable: true },
    { email: "o'coach@example.test", usable: true },
    { email: "cöach@voorbeeld.test", usable: true },
    { email: "coach.example.test", usable: false },
    { email: "coach@", usable: false },
    { email: "@example.test", usable: false },
    { email: "coach@example", usable: false },
    { email: "coach@@example.test", usable: false },
    { email: "coach @example.test", usable: false },
    { email: "coach@example.test extra", usable: false },
    { email: "coach\u00a0@example.test", usable: false },
    { email: "coach@\u2003example.test", usable: false },
    { email: "coach@example\u202f.test", usable: false },
    { email: "coach@example.test\u3000extra", usable: false },
    { email: "coach@\ufeffexample.test", usable: false },
  ] as const;

  try {
    for (const [index, { email, usable }] of cases.entries()) {
      const apiAccepts = isUsableParticipantEmail(email);
      let databaseAccepts = true;
      try {
        await isolated.db.insert(participantsTable).values(
          participantBody(email, `Contractschool ${index}`),
        );
      } catch (error) {
        const databaseError = (error as { cause?: { code?: string; constraint?: string } }).cause;
        if (databaseError?.code !== "23514") throw error;
        databaseAccepts = false;
      }

      assert.equal(apiAccepts, usable, `unexpected API result for ${JSON.stringify(email)}`);
      assert.equal(databaseAccepts, usable, `unexpected database result for ${JSON.stringify(email)}`);
      assert.equal(
        apiAccepts,
        databaseAccepts,
        `API and database disagree for ${JSON.stringify(email)}`,
      );
    }
  } finally {
    await isolated.dispose();
  }
});

test("API and database reject every supported whitespace codepoint throughout participant emails", async () => {
  const isolated = await createIsolatedTestDatabase("participant_email_whitespace_contract");
  const positions = [
    { name: "local part", email: (whitespace: string) => `coach${whitespace}team@example.test` },
    { name: "domain", email: (whitespace: string) => `coach@${whitespace}example.test` },
    { name: "domain label", email: (whitespace: string) => `coach@example${whitespace}.test` },
  ] as const;

  try {
    for (const codePoint of javascriptTrimWhitespaceCodePoints) {
      const whitespace = String.fromCodePoint(codePoint);
      const codePointLabel = unicodeCodePointLabel(codePoint);

      for (const position of positions) {
        const email = position.email(whitespace);
        const caseLabel = `${codePointLabel} in ${position.name}`;
        const apiAccepts = isUsableParticipantEmail(email);
        let databaseAccepts = true;

        try {
          await isolated.db.insert(participantsTable).values(
            participantBody(email, `Whitespace ${codePointLabel} ${position.name}`),
          );
        } catch (error) {
          const databaseError = (error as { cause?: { code?: string; constraint?: string } }).cause;
          if (databaseError?.code !== "23514") throw error;
          databaseAccepts = false;
        }

        assert.equal(apiAccepts, false, `API accepted ${caseLabel}`);
        assert.equal(databaseAccepts, false, `database accepted ${caseLabel}`);
        assert.equal(apiAccepts, databaseAccepts, `API and database disagree for ${caseLabel}`);
      }
    }
  } finally {
    await isolated.dispose();
  }
});

test("admin participant changes reject empty email input with a clear validation error", async () => {
  const isolated = await createIsolatedTestDatabase("participant_empty_email_admin");
  const app = await startApp(isolated.db);
  try {
    for (const email of ["", "   "]) {
      const created = await jsonRequest(
        app.baseUrl,
        "/admin/participants",
        "POST",
        participantBody(email),
      );
      assert.equal(created.status, 400);
      assert.deepEqual(created.body, { error: "Vul een e-mailadres in." });
    }

    const [participant] = await isolated.db.insert(participantsTable)
      .values(participantBody("existing@example.test"))
      .returning();
    const updated = await jsonRequest(
      app.baseUrl,
      `/admin/participants/${participant.id}`,
      "PATCH",
      { email: "   ", revision: participant.revision },
    );
    assert.equal(updated.status, 400);
    assert.deepEqual(updated.body, { error: "Vul een e-mailadres in." });
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("admin participant changes reject the same unusable email formats as imports", async () => {
  const isolated = await createIsolatedTestDatabase("participant_invalid_email_admin");
  const app = await startApp(isolated.db);
  try {
    for (const email of ["coach.example.test", "coach@", "coach@example", "coach @example.test"]) {
      const created = await jsonRequest(
        app.baseUrl,
        "/admin/participants",
        "POST",
        participantBody(email),
      );
      assert.equal(created.status, 400);
      assert.deepEqual(created.body, { error: "Vul een geldig e-mailadres in." });
    }

    const [participant] = await isolated.db.insert(participantsTable)
      .values(participantBody("existing@example.test"))
      .returning();
    const updated = await jsonRequest(
      app.baseUrl,
      `/admin/participants/${participant.id}`,
      "PATCH",
      { email: "coach@example", revision: participant.revision },
    );
    assert.equal(updated.status, 400);
    assert.deepEqual(updated.body, { error: "Vul een geldig e-mailadres in." });
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("concurrent participant profile changes cannot silently overwrite each other", async () => {
  const isolated = await createIsolatedTestDatabase("participant_profile_concurrency");
  const app = await startApp(isolated.db);
  try {
    const [participant] = await isolated.db.insert(participantsTable)
      .values(participantBody("concurrent-profile@example.test"))
      .returning();
    const openedRevision = participant.revision;
    const first = await jsonRequest(
      app.baseUrl,
      `/admin/participants/${participant.id}`,
      "PATCH",
      { contactName: "Eerste beheerder", revision: openedRevision },
    );
    const second = await jsonRequest(
      app.baseUrl,
      `/admin/participants/${participant.id}`,
      "PATCH",
      { schoolName: "Tweede wijziging", revision: openedRevision },
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal((second.body as { currentParticipant: { contactName: string } }).currentParticipant.contactName, "Eerste beheerder");
    const [stored] = await isolated.db.select().from(participantsTable);
    assert.equal(stored.contactName, "Eerste beheerder");
    assert.equal(stored.schoolName, "Dansschool");
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("POST stores surrounding whitespace and capitalization canonically", async () => {
  const isolated = await createIsolatedTestDatabase("participant_email_canonical_post");
  const app = await startApp(isolated.db);
  try {
    const created = await jsonRequest(
      app.baseUrl,
      "/admin/participants",
      "POST",
      participantBody(" Coach@Example.TEST "),
    );

    assert.equal(created.status, 201);
    const [stored] = await isolated.db.select().from(participantsTable);
    assert.equal(stored.email, "coach@example.test");
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("participant view is admin-only and returns scoped read-only challenge data", async () => {
  const isolated = await createIsolatedTestDatabase("participant_readonly_view");
  const [participant] = await isolated.db.insert(participantsTable).values(participantBody("view@example.test")).returning();
  const [otherParticipant] = await isolated.db.insert(participantsTable).values(participantBody("other-view@example.test", "Andere school")).returning();
  const challenge = {
    id: 1,
    name: "ByB Ledenchallenge",
    startDate: "2026-09-14",
    endDate: "2026-10-11",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const entries = [{
    id: 41,
    participantId: participant.id,
    weekNumber: 1,
    signups: 8,
    attendance: 6,
    enrolled: 3,
    updatedAt: new Date(),
  }];
  const otherEntries = [{
    id: 42,
    participantId: otherParticipant.id,
    weekNumber: 1,
    signups: 99,
    attendance: 98,
    enrolled: 97,
    updatedAt: new Date(),
  }];
  const viewParticipant: NonNullable<AdminParticipantsRouterOptions["viewParticipant"]> = async (row) => ({
    id: row.id,
    schoolName: row.schoolName,
    contactName: row.contactName,
    email: row.email,
    startingMembers: row.startingMembers,
    targetNewMembers: row.targetNewMembers,
    country: row.country,
    revision: row.revision,
    updatedAt: row.updatedAt,
    totals: { signups: 8, attendance: 6, enrolled: 3 },
    scores: { growthPercent: 0, conversionPercent: 37.5, attendancePercent: 75 },
  });

  const denied = await startApp(isolated.db, {
    adminMiddleware: async (_req, res) => { res.status(403).json({ error: "Alleen admins." }); },
  });
  try {
    assert.equal((await fetch(`${denied.baseUrl}/admin/participants/${participant.id}/view`)).status, 403);
  } finally {
    await denied.close();
  }

  const allowed = await startApp(isolated.db, {
    viewParticipant,
    getChallenge: async () => challenge,
    getEntries: async (participantId) => participantId === participant.id ? entries : otherEntries,
    getMessages: async (participantId) => participantId === participant.id ? [] : [{
      id: 99,
      participantId: otherParticipant.id,
      adminUserId: "admin",
      authorName: "Coach",
      body: "Bericht voor andere deelnemer",
      createdAt: new Date(),
    }],
  });
  try {
    const response = await fetch(`${allowed.baseUrl}/admin/participants/${participant.id}/view`);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.participant.id, participant.id);
    assert.deepEqual(body.entries.map((entry: any) => ({
      weekNumber: entry.weekNumber,
      signups: entry.signups,
      attendance: entry.attendance,
      enrolled: entry.enrolled,
    })), [{ weekNumber: 1, signups: 8, attendance: 6, enrolled: 3 }]);
    assert.equal(body.weeks.length, 4);
    assert.deepEqual(body.messages, []);
    assert.equal(JSON.stringify(body).includes("Bericht voor andere deelnemer"), false);
    assert.equal(JSON.stringify(body).includes("99"), false);
    assert.equal("save" in body, false);
  } finally {
    await allowed.close();
    await isolated.dispose();
  }
});

test("PATCH rejects another participant's email with different casing", async () => {
  const isolated = await createIsolatedTestDatabase("participant_email_patch");
  const app = await startApp(isolated.db);
  try {
    const [existing, changed] = await isolated.db.insert(participantsTable).values([
      participantBody("existing@example.test", "Bestaande school"),
      participantBody("changed@example.test", "Te wijzigen school"),
    ]).returning();
    assert.ok(existing);
    assert.ok(changed);

    const duplicate = await jsonRequest(
      app.baseUrl,
      `/admin/participants/${changed.id}`,
      "PATCH",
      { email: "Existing@Example.TEST", revision: changed.revision },
    );

    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, conflictMessage);
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("unrelated database failures remain server errors", async () => {
  const database = {
    insert() {
      return {
        values() {
          return {
            returning: async () => {
              throw new Error("database unavailable");
            },
          };
        },
      };
    },
  } as unknown as NonNullable<AdminParticipantsRouterOptions["database"]>;
  const app = await startApp(database);
  try {
    const response = await jsonRequest(app.baseUrl, "/admin/participants", "POST", participantBody("new@example.test"));
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: "Interne serverfout." });
  } finally {
    await app.close();
  }
});