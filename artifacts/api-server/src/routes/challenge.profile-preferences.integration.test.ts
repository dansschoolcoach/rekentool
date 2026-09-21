import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test, { after } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, participantsTable, pool, type Participant } from "@workspace/db";
import {
  createAdminParticipantsRouter,
  createProfilePreferencesRouter,
  type AdminParticipantsRouterOptions,
  type ProfilePreferencesRouterOptions,
} from "./challenge.ts";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";

const signedOutMessage = { error: "Je moet ingelogd zijn." };

function participant(id: number, clerkUserId: string): Participant {
  return {
    id,
    clerkUserId,
    schoolName: `Dansschool ${id}`,
    contactName: `Deelnemer ${id}`,
    email: `deelnemer${id}@example.test`,
    startingMembers: 10,
    targetNewMembers: 5,
    country: "Nederland",
    masterDataRoute: null,
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function startApp(options: {
  deleteParticipantDuringUpdate?: boolean;
  synchronizeConcurrentUpdates?: boolean;
} = {}) {
  const participants = new Map([
    ["participant-a", participant(17, "participant-a")],
    ["participant-b", participant(18, "participant-b")],
  ]);
  const requestParticipant = new AsyncLocalStorage<number | undefined>();
  let writes = 0;
  let deleteParticipantDuringUpdate = options.deleteParticipantDuringUpdate ?? false;
  let updatesStarted = 0;
  let releaseConcurrentUpdates: (() => void) | undefined;
  const concurrentUpdatesReleased = new Promise<void>((resolve) => {
    releaseConcurrentUpdates = resolve;
  });

  const database = {
    update(table: unknown) {
      assert.equal(table, participantsTable);
      return {
        set(values: Partial<Participant>) {
          return {
            where() {
              return {
                returning: async () => {
                  if (options.synchronizeConcurrentUpdates) {
                    updatesStarted += 1;
                    if (updatesStarted === 2) releaseConcurrentUpdates?.();
                    await concurrentUpdatesReleased;
                  }
                  const targetParticipantId = requestParticipant.getStore();
                  const targetEntry = [...participants.entries()].find(([, row]) => row.id === targetParticipantId);
                  const target = targetEntry?.[1];
                  if (deleteParticipantDuringUpdate) {
                    deleteParticipantDuringUpdate = false;
                    assert.ok(targetEntry);
                    participants.delete(targetEntry[0]);
                    return [];
                  }
                  assert.ok(target);
                  const { revision, ...plainValues } = values;
                  Object.assign(target, plainValues);
                  if (revision !== undefined) target.revision += 1;
                  writes += 1;
                  return [target];
                },
              };
            },
          };
        },
      };
    },
  } as unknown as NonNullable<ProfilePreferencesRouterOptions["database"]>;

  const signedInMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const userId = req.header("x-test-user");
    if (!userId) {
      res.status(401).json(signedOutMessage);
      return;
    }
    const current = participants.get(userId);
    requestParticipant.run(current?.id, next);
  };

  const app = express();
  app.use(express.json());
  app.use("/profile/preferences", createProfilePreferencesRouter({
    database,
    signedInMiddleware,
    getParticipant: async (req) => participants.get(req.header("x-test-user") ?? "") ?? null,
  }));
  app.use("/admin/participants", createAdminParticipantsRouter({
    database: database as NonNullable<AdminParticipantsRouterOptions["database"]>,
    signedInMiddleware,
    adminMiddleware: async (_req, _res, next) => next(),
    viewParticipant: async (row) => ({
      id: row.id,
      schoolName: row.schoolName,
      contactName: row.contactName,
      email: row.email,
      startingMembers: row.startingMembers,
      targetNewMembers: row.targetNewMembers,
      country: row.country,
      revision: row.revision,
      updatedAt: row.updatedAt,
      totals: { signups: 0, attendance: 0, enrolled: 0 },
      scores: { growthPercent: 0, conversionPercent: 0, attendancePercent: 0 },
    }),
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    participants,
    get writes() {
      return writes;
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

async function startDatabaseApp(database: typeof db) {
  const app = express();
  app.use(express.json());
  app.use("/profile/preferences", createProfilePreferencesRouter({
    database,
    signedInMiddleware: (req, res, next) => {
      if (!req.header("x-test-user")) {
        res.status(401).json(signedOutMessage);
        return;
      }
      next();
    },
    getParticipant: async (req) => {
      const userId = req.header("x-test-user");
      if (!userId) return null;
      const [participant] = await database.select().from(participantsTable)
        .where(eq(participantsTable.clerkUserId, userId))
        .limit(1);
      return participant ?? null;
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

after(async () => {
  await pool.end();
});

test("profile preference routes reject signed-out requests", async () => {
  const app = await startApp();
  try {
    const [getResponse, patchResponse] = await Promise.all([
      fetch(`${app.baseUrl}/profile/preferences`),
      fetch(`${app.baseUrl}/profile/preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masterDataRoute: "manual" }),
      }),
    ]);

    assert.deepEqual(
      await Promise.all([getResponse, patchResponse].map(async response => ({
        status: response.status,
        body: await response.json(),
      }))),
      [
        { status: 401, body: signedOutMessage },
        { status: 401, body: signedOutMessage },
      ],
    );
    assert.equal(app.writes, 0);
  } finally {
    await app.close();
  }
});

test("profile preference routes reject signed-in accounts without a participant profile", async () => {
  const app = await startApp();
  try {
    const [getResponse, patchResponse] = await Promise.all([
      fetch(`${app.baseUrl}/profile/preferences`, {
        headers: { "x-test-user": "account-without-participant" },
      }),
      fetch(`${app.baseUrl}/profile/preferences`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-user": "account-without-participant",
        },
        body: JSON.stringify({ masterDataRoute: "manual" }),
      }),
    ]);

    assert.deepEqual(
      await Promise.all([getResponse, patchResponse].map(async response => ({
        status: response.status,
        body: await response.json(),
      }))),
      [
        { status: 401, body: { error: "Geen deelnemersprofiel gevonden." } },
        { status: 401, body: { error: "Geen deelnemersprofiel gevonden." } },
      ],
    );
    assert.equal(app.participants.get("participant-a")?.masterDataRoute, null);
    assert.equal(app.participants.get("participant-b")?.masterDataRoute, null);
    assert.equal(app.writes, 0);
  } finally {
    await app.close();
  }
});

test("a participant stores and reads only their own master-data route", async () => {
  const app = await startApp();
  try {
    const saved = await fetch(`${app.baseUrl}/profile/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": "participant-a" },
      body: JSON.stringify({ masterDataRoute: "excel" }),
    });
    const read = await fetch(`${app.baseUrl}/profile/preferences`, {
      headers: { "x-test-user": "participant-a" },
    });

    assert.deepEqual({ status: saved.status, body: await saved.json() }, {
      status: 200,
      body: { masterDataRoute: "excel" },
    });
    assert.deepEqual({ status: read.status, body: await read.json() }, {
      status: 200,
      body: { masterDataRoute: "excel" },
    });
    assert.equal(app.participants.get("participant-a")?.masterDataRoute, "excel");
    assert.equal(app.participants.get("participant-b")?.masterDataRoute, null);
    assert.equal(app.writes, 1);
  } finally {
    await app.close();
  }
});

test("concurrent preference updates stay isolated to the authenticated participant", async () => {
  const app = await startApp({ synchronizeConcurrentUpdates: true });
  try {
    const [savedA, savedB] = await Promise.all([
      fetch(`${app.baseUrl}/profile/preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-test-user": "participant-a" },
        body: JSON.stringify({ masterDataRoute: "excel" }),
      }),
      fetch(`${app.baseUrl}/profile/preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-test-user": "participant-b" },
        body: JSON.stringify({ masterDataRoute: "manual" }),
      }),
    ]);

    assert.deepEqual(
      await Promise.all([savedA, savedB].map(async response => ({
        status: response.status,
        body: await response.json(),
      }))),
      [
        { status: 200, body: { masterDataRoute: "excel" } },
        { status: 200, body: { masterDataRoute: "manual" } },
      ],
    );

    const [readA, readB] = await Promise.all([
      fetch(`${app.baseUrl}/profile/preferences`, {
        headers: { "x-test-user": "participant-a" },
      }),
      fetch(`${app.baseUrl}/profile/preferences`, {
        headers: { "x-test-user": "participant-b" },
      }),
    ]);

    assert.deepEqual(
      await Promise.all([readA, readB].map(async response => ({
        status: response.status,
        body: await response.json(),
      }))),
      [
        { status: 200, body: { masterDataRoute: "excel" } },
        { status: 200, body: { masterDataRoute: "manual" } },
      ],
    );
    assert.equal(app.participants.get("participant-a")?.masterDataRoute, "excel");
    assert.equal(app.participants.get("participant-b")?.masterDataRoute, "manual");
    assert.equal(app.writes, 2);
  } finally {
    await app.close();
  }
});

test("concurrent preference updates stay isolated with a real database", async () => {
  const isolated = await createIsolatedTestDatabase("profile_preferences_concurrency");
  const app = await startDatabaseApp(isolated.db);
  try {
    await isolated.db.insert(participantsTable).values([
      {
        clerkUserId: "database-participant-a",
        schoolName: "Dansschool A",
        contactName: "Deelnemer A",
        email: "database-participant-a@example.test",
        country: "Nederland",
      },
      {
        clerkUserId: "database-participant-b",
        schoolName: "Dansschool B",
        contactName: "Deelnemer B",
        email: "database-participant-b@example.test",
        country: "Nederland",
      },
    ]);

    const [savedA, savedB] = await Promise.all([
      fetch(`${app.baseUrl}/profile/preferences`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-user": "database-participant-a",
        },
        body: JSON.stringify({ masterDataRoute: "excel" }),
      }),
      fetch(`${app.baseUrl}/profile/preferences`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-user": "database-participant-b",
        },
        body: JSON.stringify({ masterDataRoute: "manual" }),
      }),
    ]);

    assert.deepEqual(
      await Promise.all([savedA, savedB].map(async response => ({
        status: response.status,
        body: await response.json(),
      }))),
      [
        { status: 200, body: { masterDataRoute: "excel" } },
        { status: 200, body: { masterDataRoute: "manual" } },
      ],
    );

    const [readA, readB] = await Promise.all([
      fetch(`${app.baseUrl}/profile/preferences`, {
        headers: { "x-test-user": "database-participant-a" },
      }),
      fetch(`${app.baseUrl}/profile/preferences`, {
        headers: { "x-test-user": "database-participant-b" },
      }),
    ]);

    assert.deepEqual(
      await Promise.all([readA, readB].map(async response => ({
        status: response.status,
        body: await response.json(),
      }))),
      [
        { status: 200, body: { masterDataRoute: "excel" } },
        { status: 200, body: { masterDataRoute: "manual" } },
      ],
    );
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("invalid master-data routes are rejected without a database change", async () => {
  const app = await startApp();
  try {
    const response = await fetch(`${app.baseUrl}/profile/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": "participant-a" },
      body: JSON.stringify({ masterDataRoute: "anders" }),
    });

    assert.equal(response.status, 400);
    assert.equal(app.participants.get("participant-a")?.masterDataRoute, null);
    assert.equal(app.writes, 0);
  } finally {
    await app.close();
  }
});

test("a preference update returns a controlled error when the participant disappears during saving", async () => {
  const app = await startApp({ deleteParticipantDuringUpdate: true });
  try {
    const response = await fetch(`${app.baseUrl}/profile/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": "participant-a" },
      body: JSON.stringify({ masterDataRoute: "excel" }),
    });

    assert.deepEqual({ status: response.status, body: await response.json() }, {
      status: 404,
      body: { error: "Geen deelnemersprofiel gevonden." },
    });
    assert.equal(app.participants.has("participant-a"), false);
    assert.equal(app.participants.get("participant-b")?.masterDataRoute, null);
    assert.equal(app.writes, 0);
  } finally {
    await app.close();
  }
});

test("an admin profile change leaves the master-data route unchanged", async () => {
  const app = await startApp();
  try {
    const target = app.participants.get("participant-a");
    assert.ok(target);
    target.masterDataRoute = "manual";
    const response = await fetch(`${app.baseUrl}/admin/participants/${target.id}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": "participant-a" },
      body: JSON.stringify({ startingMembers: 12, revision: target.revision }),
    });

    assert.equal(response.status, 200);
    assert.equal(target.startingMembers, 12);
    assert.equal(target.masterDataRoute, "manual");
  } finally {
    await app.close();
  }
});