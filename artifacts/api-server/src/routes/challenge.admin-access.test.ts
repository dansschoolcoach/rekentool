import assert from "node:assert/strict";
import test from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { coachMessagesTable, participantsTable, weeklyEntriesTable } from "@workspace/db";
import { malformedJsonErrorHandler } from "../middlewares/malformedJsonErrorHandler.ts";
import {
  createAdminWeeklyEntriesRouter,
  createAdminParticipantsRouter,
  type AdminWeeklyEntriesRouterOptions,
  type AdminParticipantsRouterOptions,
} from "./challenge.ts";

const signedOutMessage = { error: "Je moet ingelogd zijn." };
const forbiddenMessage = { error: "Alleen admins hebben toegang tot dit onderdeel." };
const participant = {
  id: 17,
  schoolName: "Dansschool",
  contactName: "Beheerder",
  email: "beheerder@example.test",
  startingMembers: 0,
  targetNewMembers: 0,
  country: "Nederland",
  revision: 1,
  clerkUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const adminWeeklyEntry = {
  id: 29,
  participantId: participant.id,
  weekNumber: 1,
  signups: 4,
  attendance: 3,
  enrolled: 2,
  updatedAt: new Date(),
};

type TestRole = "signed-out" | "participant" | "admin";

async function startApp(role: TestRole) {
  const reached = {
    create: 0,
    update: 0,
    database: 0,
    email: 0,
    participants: 0,
    challenge: 0,
    entries: 0,
    messages: 0,
    recovery: 0,
  };
  const message = {
    id: 23,
    participantId: participant.id,
    adminUserId: "admin-user",
    authorName: "Beheerder",
    body: "Testbericht",
    createdAt: new Date(),
  };
  const weeklyEntry = adminWeeklyEntry;
  const transaction = async (callback: (tx: unknown) => Promise<unknown>) => {
    reached.database += 1;
    const selection = {
      from(table: unknown) {
        if (table === weeklyEntriesTable) {
          return {
            where() {
              return { limit: async () => [] };
            },
          };
        }
        assert.equal(table, participantsTable);
        return {
          where() {
            return {
              limit() {
                return {
                  for: async () => [participant],
                };
              },
            };
          },
        };
      },
    };
    const tx = {
      select: () => selection,
      insert(table: unknown) {
        assert.ok(table === coachMessagesTable || table === weeklyEntriesTable);
        return {
          values() {
            return { returning: async () => [table === coachMessagesTable ? message : weeklyEntry] };
          },
        };
      },
      delete(table: unknown) {
        assert.equal(table, participantsTable);
        return { where: async () => undefined };
      },
    };
    return callback(tx);
  };
  const database = {
    select() {
      reached.database += 1;
      return {
        from(table: unknown) {
          if (table === participantsTable) {
            reached.participants += 1;
            return {
              orderBy: async () => [participant],
              where() {
                return { limit: async () => [participant] };
              },
            };
          }
          assert.equal(table, coachMessagesTable);
          reached.messages += 1;
          return {
            where() {
              return { orderBy: async () => [] };
            },
          };
        },
      };
    },
    transaction,
    insert(table: unknown) {
      assert.equal(table, participantsTable);
      reached.create += 1;
      return {
        values() {
          return { returning: async () => [participant] };
        },
      };
    },
    update(table: unknown) {
      assert.equal(table, participantsTable);
      reached.update += 1;
      return {
        set() {
          return {
            where() {
              return { returning: async () => [participant] };
            },
          };
        },
      };
    },
  } as unknown as NonNullable<AdminParticipantsRouterOptions["database"]>;

  const signedInMiddleware = (_req: Request, res: Response, next: NextFunction) => {
    if (role === "signed-out") {
      res.status(401).json(signedOutMessage);
      return;
    }
    next();
  };
  const adminMiddleware = async (_req: Request, res: Response, next: NextFunction) => {
    if (role !== "admin") {
      res.status(403).json(forbiddenMessage);
      return;
    }
    next();
  };

  const app = express();
  app.use("/admin", signedInMiddleware, adminMiddleware);
  app.use(express.json());
  app.use(malformedJsonErrorHandler);
  app.use((req, _res, next) => {
    req.log = { info() {} } as unknown as Request["log"];
    next();
  });
  app.use("/admin/participants", createAdminParticipantsRouter({
    database,
    signedInMiddleware,
    adminMiddleware,
    getChallenge: async () => {
      reached.challenge += 1;
      return {
        id: 1,
        name: "Ledenchallenge",
        startDate: "2026-01-01",
        endDate: "2026-01-07",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    getEntries: async () => {
      reached.entries += 1;
      return [];
    },
    getMessages: async () => {
      reached.messages += 1;
      return [];
    },
    revokeIdentity: async () => "pending-invitations",
    sendReminder: async () => {
      reached.email += 1;
    },
    getAdminUserId: () => message.adminUserId,
    getAdminDisplayName: () => message.authorName,
    getRecoveryStatus: async () => {
      reached.recovery += 1;
      return {
        overdueCount: 1,
        records: [{ releaseId: 41, participantId: participant.id, waitingMinutes: 18 }],
      };
    },
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
    reached,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

async function requestBothRoutes(role: TestRole) {
  const app = await startApp(role);
  try {
    const create = await fetch(`${app.baseUrl}/admin/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schoolName: participant.schoolName,
        contactName: participant.contactName,
        email: participant.email,
        country: participant.country,
      }),
    });
    const update = await fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolName: "Gewijzigde dansschool", revision: participant.revision }),
    });
    return {
      create: { status: create.status, body: await create.json() as unknown },
      update: { status: update.status, body: await update.json() as unknown },
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestMalformedAdminMutations(role: TestRole) {
  const app = await startApp(role);
  try {
    const requests = [
      { path: "/admin/participants", method: "POST" },
      { path: `/admin/participants/${participant.id}`, method: "PATCH" },
      { path: `/admin/participants/${participant.id}/profile`, method: "PATCH" },
      { path: `/admin/participants/${participant.id}/weekly-entries`, method: "POST" },
      { path: `/admin/participants/${participant.id}/messages`, method: "POST" },
    ];
    const responses = await Promise.all(requests.map(({ path, method }) => fetch(`${app.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: '{"kapot":',
    })));
    return {
      responses: await Promise.all(responses.map(async response => ({
        status: response.status,
        body: await response.json() as unknown,
      }))),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestOversizedAdminMutations(role: TestRole = "admin") {
  const app = await startApp(role);
  try {
    const requests = [
      { path: "/admin/participants", method: "POST" },
      { path: `/admin/participants/${participant.id}`, method: "PATCH" },
      { path: `/admin/participants/${participant.id}/profile`, method: "PATCH" },
      { path: `/admin/participants/${participant.id}/weekly-entries`, method: "POST" },
      { path: `/admin/participants/${participant.id}/messages`, method: "POST" },
    ];
    const oversizedBody = JSON.stringify({ value: "x".repeat(101 * 1024) });
    const responses = await Promise.all(requests.map(({ path, method }) => fetch(`${app.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: oversizedBody,
    })));
    return {
      responses: await Promise.all(responses.map(async response => ({
        status: response.status,
        body: await response.json() as unknown,
      }))),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestSensitiveRoutes(role: TestRole) {
  const app = await startApp(role);
  try {
    const requests = await Promise.all([
      fetch(`${app.baseUrl}/admin/participants/${participant.id}`, { method: "DELETE" }),
      fetch(`${app.baseUrl}/admin/participants/${participant.id}/messages`),
      fetch(`${app.baseUrl}/admin/participants/${participant.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Testbericht" }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${participant.id}/reminder`, { method: "POST" }),
    ]);
    return {
      responses: await Promise.all(requests.map(async response => ({
        status: response.status,
        body: response.status === 204 ? undefined : await response.json() as unknown,
      }))),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestReadRoutes(role: TestRole) {
  const app = await startApp(role);
  try {
    const responses = await Promise.all([
      fetch(`${app.baseUrl}/admin/participants`),
      fetch(`${app.baseUrl}/admin/participants/recovery-status`),
      fetch(`${app.baseUrl}/admin/participants/${participant.id}/view`),
    ]);
    return {
      responses: await Promise.all(responses.map(async response => ({
        status: response.status,
        body: await response.json() as unknown,
      }))),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestProfileAndWeeklyRoutes(role: TestRole) {
  const app = await startApp(role);
  try {
    const responses = await Promise.all([
      fetch(`${app.baseUrl}/admin/participants/${participant.id}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startingMembers: 12, revision: participant.revision }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${participant.id}/weekly-entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekNumber: 1, signups: 4, attendance: 3, enrolled: 2 }),
      }),
    ]);
    return {
      responses: await Promise.all(responses.map(async response => ({
        status: response.status,
        body: await response.json() as unknown,
      }))),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestInvalidProfileAndWeeklyRoutes() {
  const app = await startApp("admin");
  try {
    const profile = await fetch(`${app.baseUrl}/admin/participants/${participant.id}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startingMembers: -1, revision: participant.revision }),
    });
    const weeklyEntry = await fetch(`${app.baseUrl}/admin/participants/${participant.id}/weekly-entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekNumber: 1, signups: -1, attendance: 3, enrolled: 2 }),
    });
    return {
      responses: [profile, weeklyEntry].map(response => ({ status: response.status })),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestOtherInvalidAdminMutations() {
  const app = await startApp("admin");
  try {
    const responses = await Promise.all([
      fetch(`${app.baseUrl}/admin/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schoolName: 123 }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: "oud" }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${participant.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: 123 }),
      }),
    ]);
    return {
      responses: responses.map(response => ({ status: response.status })),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestInvalidAdminParticipantLinks(role: TestRole = "admin") {
  const app = await startApp(role);
  try {
    const invalidId = "geen-deelnemer";
    const responses = await Promise.all([
      fetch(`${app.baseUrl}/admin/participants/${invalidId}/view`),
      fetch(`${app.baseUrl}/admin/participants/${invalidId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schoolName: "Gewijzigd", revision: participant.revision }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${invalidId}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startingMembers: 12, revision: participant.revision }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${invalidId}/weekly-entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekNumber: 1, signups: 4, attendance: 3, enrolled: 2 }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${invalidId}`, { method: "DELETE" }),
      fetch(`${app.baseUrl}/admin/participants/${invalidId}/messages`),
      fetch(`${app.baseUrl}/admin/participants/${invalidId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Testbericht" }),
      }),
      fetch(`${app.baseUrl}/admin/participants/${invalidId}/reminder`, { method: "POST" }),
    ]);
    return {
      responses: await Promise.all(responses.map(async response => ({
        status: response.status,
        body: await response.json() as unknown,
      }))),
      reached: app.reached,
    };
  } finally {
    await app.close();
  }
}

async function requestAdminWeeklyEntry(query: string, role: TestRole = "admin") {
  let databaseActions = 0;
  const updatedAt = new Date();
  const database = {
    update(table: unknown) {
      databaseActions += 1;
      assert.equal(table, weeklyEntriesTable);
      return {
        set() {
          return {
            where() {
              return { returning: async () => [{ ...adminWeeklyEntry, updatedAt }] };
            },
          };
        },
      };
    },
    select() {
      databaseActions += 1;
      return {
        from(table: unknown) {
          assert.equal(table, participantsTable);
          return {
            where() {
              return { limit: async () => [participant] };
            },
          };
        },
      };
    },
  } as unknown as NonNullable<AdminWeeklyEntriesRouterOptions["database"]>;
  const signedInMiddleware = (_req: Request, res: Response, next: NextFunction) => {
    if (role === "signed-out") {
      res.status(401).json(signedOutMessage);
      return;
    }
    next();
  };
  const adminMiddleware = async (_req: Request, res: Response, next: NextFunction) => {
    if (role !== "admin") {
      res.status(403).json(forbiddenMessage);
      return;
    }
    next();
  };
  const app = express();
  app.use(express.json());
  app.use("/admin/weekly-entries", createAdminWeeklyEntriesRouter({
    database,
    signedInMiddleware,
    adminMiddleware,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/admin/weekly-entries?${query}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signups: 5, attendance: 4, enrolled: 3 }),
    });
    return { status: response.status, body: await response.json() as unknown, databaseActions };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

const noReadsOrSideEffects = {
  create: 0,
  update: 0,
  database: 0,
  email: 0,
  participants: 0,
  challenge: 0,
  entries: 0,
  messages: 0,
  recovery: 0,
};

test("participant create and update reject signed-out requests with 401", async () => {
  const result = await requestBothRoutes("signed-out");

  assert.deepEqual(result.create, { status: 401, body: signedOutMessage });
  assert.deepEqual(result.update, { status: 401, body: signedOutMessage });
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("participant create and update reject non-admin participants with 403", async () => {
  const result = await requestBothRoutes("participant");

  assert.deepEqual(result.create, { status: 403, body: forbiddenMessage });
  assert.deepEqual(result.update, { status: 403, body: forbiddenMessage });
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("participant create and update reach their handlers for admins", async () => {
  const result = await requestBothRoutes("admin");

  assert.equal(result.create.status, 201);
  assert.equal(result.update.status, 200);
  assert.deepEqual(result.reached, {
    ...noReadsOrSideEffects,
    create: 1,
    update: 1,
  });
});

test("malformed admin JSON rejects signed-out requests before parsing without side effects", async () => {
  const result = await requestMalformedAdminMutations("signed-out");

  assert.deepEqual(result.responses, Array.from({ length: 5 }, () => ({
    status: 401,
    body: signedOutMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("malformed admin JSON rejects non-admin participants before parsing without side effects", async () => {
  const result = await requestMalformedAdminMutations("participant");

  assert.deepEqual(result.responses, Array.from({ length: 5 }, () => ({
    status: 403,
    body: forbiddenMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("malformed admin JSON returns a fixed 400 response without side effects", async () => {
  const result = await requestMalformedAdminMutations("admin");

  assert.deepEqual(result.responses, Array.from({ length: 5 }, () => ({
    status: 400,
    body: { error: "De JSON in dit verzoek is ongeldig." },
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("oversized admin JSON rejects signed-out requests before parsing without side effects", async () => {
  const result = await requestOversizedAdminMutations("signed-out");

  assert.deepEqual(result.responses, Array.from({ length: 5 }, () => ({
    status: 401,
    body: signedOutMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("oversized admin JSON rejects non-admin participants before parsing without side effects", async () => {
  const result = await requestOversizedAdminMutations("participant");

  assert.deepEqual(result.responses, Array.from({ length: 5 }, () => ({
    status: 403,
    body: forbiddenMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("oversized admin JSON returns a fixed 413 response without side effects", async () => {
  const result = await requestOversizedAdminMutations();

  assert.deepEqual(result.responses, Array.from({ length: 5 }, () => ({
    status: 413,
    body: { error: "De JSON in dit verzoek is te groot." },
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("sensitive participant actions reject signed-out requests with 401 without side effects", async () => {
  const result = await requestSensitiveRoutes("signed-out");

  assert.deepEqual(result.responses, Array.from({ length: 4 }, () => ({
    status: 401,
    body: signedOutMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("sensitive participant actions reject non-admin participants with 403 without side effects", async () => {
  const result = await requestSensitiveRoutes("participant");

  assert.deepEqual(result.responses, Array.from({ length: 4 }, () => ({
    status: 403,
    body: forbiddenMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("sensitive participant actions reach every handler for admins", async () => {
  const result = await requestSensitiveRoutes("admin");

  assert.deepEqual(result.responses.map(response => response.status), [204, 200, 201, 200]);
  assert.deepEqual(result.reached, {
    ...noReadsOrSideEffects,
    database: 4,
    email: 1,
    messages: 1,
  });
});

test("participant list, recovery status and detail reject signed-out requests with 401 without reading data", async () => {
  const result = await requestReadRoutes("signed-out");

  assert.deepEqual(result.responses, Array.from({ length: 3 }, () => ({
    status: 401,
    body: signedOutMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("participant list, recovery status and detail reject non-admin participants with 403 without reading data", async () => {
  const result = await requestReadRoutes("participant");

  assert.deepEqual(result.responses, Array.from({ length: 3 }, () => ({
    status: 403,
    body: forbiddenMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("participant list, recovery status and detail reach their handlers for admins", async () => {
  const result = await requestReadRoutes("admin");

  assert.deepEqual(result.responses.map(response => response.status), [200, 200, 200]);
  assert.deepEqual(result.responses[1]?.body, {
    overdueCount: 1,
    records: [{ releaseId: 41, participantId: participant.id, waitingMinutes: 18 }],
  });
  assert.deepEqual(result.reached, {
    ...noReadsOrSideEffects,
    database: 2,
    participants: 2,
    challenge: 1,
    entries: 1,
    messages: 1,
    recovery: 1,
  });
});

test("profile and weekly entry changes reject signed-out requests with 401 without database actions", async () => {
  const result = await requestProfileAndWeeklyRoutes("signed-out");

  assert.deepEqual(result.responses, Array.from({ length: 2 }, () => ({
    status: 401,
    body: signedOutMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("profile and weekly entry changes reject non-admin participants with 403 without database actions", async () => {
  const result = await requestProfileAndWeeklyRoutes("participant");

  assert.deepEqual(result.responses, Array.from({ length: 2 }, () => ({
    status: 403,
    body: forbiddenMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("invalid admin profile and weekly entry values return 400 without database actions", async () => {
  const result = await requestInvalidProfileAndWeeklyRoutes();

  assert.deepEqual(result.responses, [{ status: 400 }, { status: 400 }]);
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("other invalid admin participant payloads return 400 without database actions", async () => {
  const result = await requestOtherInvalidAdminMutations();

  assert.deepEqual(result.responses, [{ status: 400 }, { status: 400 }, { status: 400 }]);
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("invalid admin participant path values return 400 without database or email actions", async () => {
  const result = await requestInvalidAdminParticipantLinks();

  assert.deepEqual(result.responses.map(response => response.status), Array.from({ length: 8 }, () => 400));
  assert.ok(result.responses.every(response => (
    typeof response.body === "object"
    && response.body !== null
    && "error" in response.body
  )));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("invalid participant path values reject signed-out requests with 401 without database or email actions", async () => {
  const result = await requestInvalidAdminParticipantLinks("signed-out");

  assert.deepEqual(result.responses, Array.from({ length: 8 }, () => ({
    status: 401,
    body: signedOutMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("invalid participant path values reject non-admin participants with 403 without database or email actions", async () => {
  const result = await requestInvalidAdminParticipantLinks("participant");

  assert.deepEqual(result.responses, Array.from({ length: 8 }, () => ({
    status: 403,
    body: forbiddenMessage,
  })));
  assert.deepEqual(result.reached, noReadsOrSideEffects);
});

test("invalid admin weekly entry query values return 400 without database actions", async () => {
  for (const query of ["id=geen-getal&participantId=17", "id=29&participantId=geen-getal", "id=29"]) {
    const result = await requestAdminWeeklyEntry(query);
    assert.equal(result.status, 400);
    assert.equal(result.databaseActions, 0);
  }
});

test("invalid weekly entry query values reject signed-out requests with 401 without database actions", async () => {
  for (const query of ["id=geen-getal&participantId=17", "id=29&participantId=geen-getal", "id=29"]) {
    const result = await requestAdminWeeklyEntry(query, "signed-out");
    assert.deepEqual(
      { status: result.status, body: result.body, databaseActions: result.databaseActions },
      { status: 401, body: signedOutMessage, databaseActions: 0 },
    );
  }
});

test("invalid weekly entry query values reject non-admin participants with 403 without database actions", async () => {
  for (const query of ["id=geen-getal&participantId=17", "id=29&participantId=geen-getal", "id=29"]) {
    const result = await requestAdminWeeklyEntry(query, "participant");
    assert.deepEqual(
      { status: result.status, body: result.body, databaseActions: result.databaseActions },
      { status: 403, body: forbiddenMessage, databaseActions: 0 },
    );
  }
});

test("valid admin weekly entry query values still update and return the entry", async () => {
  const result = await requestAdminWeeklyEntry(`id=${adminWeeklyEntry.id}&participantId=${participant.id}`);

  assert.equal(result.status, 200);
  assert.equal(result.databaseActions, 2);
  assert.equal((result.body as { id: number }).id, adminWeeklyEntry.id);
});

test("profile and weekly entry changes reach both handlers for admins", async () => {
  const result = await requestProfileAndWeeklyRoutes("admin");

  assert.deepEqual(result.responses.map(response => response.status), [200, 200]);
  assert.deepEqual(result.reached, {
    ...noReadsOrSideEffects,
    update: 1,
    database: 1,
    challenge: 1,
  });
});
