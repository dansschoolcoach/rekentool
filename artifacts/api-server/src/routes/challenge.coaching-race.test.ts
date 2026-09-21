import assert from "node:assert/strict";
import test, { after } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  coachMessagesTable,
  db,
  participantIdentityReleasesTable,
  participantsTable,
  pool,
} from "@workspace/db";
import { createAdminParticipantsRouter, type AdminParticipantsRouterOptions } from "./challenge.ts";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function startApp(
  database: typeof db,
  options: Partial<AdminParticipantsRouterOptions>,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info() {}, error() {} } as unknown as Request["log"];
    next();
  });
  app.use("/admin/participants", createAdminParticipantsRouter({
    database,
    signedInMiddleware: (_req, _res, next) => next(),
    adminMiddleware: async (_req, _res, next) => next(),
    getAdminUserId: () => "admin-test",
    getAdminDisplayName: () => "Testcoach",
    ...options,
  }));
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Interne serverfout." });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}

async function createParticipant(database: typeof db, email: string) {
  const [participant] = await database.insert(participantsTable).values({
    schoolName: "Dansschool",
    contactName: "Coach",
    email,
    country: "Nederland",
  }).returning();
  return participant;
}

after(async () => {
  await pool.end();
});


test("a message already in flight is rejected when concurrent deletion wins", async () => {
  const isolated = await createIsolatedTestDatabase("coaching_message_delete_race");
  const deleteLocked = deferred();
  const finishIdentityRevocation = deferred();
  const app = await startApp(isolated.db, {
    revokeIdentity: async () => {
      deleteLocked.resolve();
      await finishIdentityRevocation.promise;
      return "pending-invitations";
    },
  });
  try {
    const participant = await createParticipant(isolated.db, "message-race@example.test");
    const deletion = fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    await deleteLocked.promise;

    const message = fetch(`${app.baseUrl}/admin/participants/${participant.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Dit bericht mag niet aankomen." }),
    });
    finishIdentityRevocation.resolve();

    const [deleteResponse, messageResponse] = await Promise.all([deletion, message]);
    assert.equal(deleteResponse.status, 204);
    assert.equal(messageResponse.status, 404);
    assert.deepEqual(await isolated.db.select().from(coachMessagesTable), []);
  } finally {
    await app.close();
    await isolated.dispose();
  }
});


test("a reminder already in flight sends no email when concurrent deletion wins", async () => {
  const isolated = await createIsolatedTestDatabase("coaching_reminder_delete_race");
  const deleteLocked = deferred();
  const finishIdentityRevocation = deferred();
  const sentTo: string[] = [];
  const app = await startApp(isolated.db, {
    revokeIdentity: async () => {
      deleteLocked.resolve();
      await finishIdentityRevocation.promise;
      return "pending-invitations";
    },
    sendReminder: async (participant) => {
      sentTo.push(participant.email);
    },
  });
  try {
    const participant = await createParticipant(isolated.db, "reminder-race@example.test");
    const deletion = fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    await deleteLocked.promise;

    const reminder = fetch(`${app.baseUrl}/admin/participants/${participant.id}/reminder`, {
      method: "POST",
    });
    finishIdentityRevocation.resolve();

    const [deleteResponse, reminderResponse] = await Promise.all([deletion, reminder]);
    assert.equal(deleteResponse.status, 204);
    assert.equal(reminderResponse.status, 404);
    assert.deepEqual(sentTo, []);
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("a failed database commit after Clerk deletion releases the stale identity link", async () => {
  const isolated = await createIsolatedTestDatabase("participant_delete_commit_failure");
  const deletedUsers: string[] = [];
  const database = new Proxy(isolated.db, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (callback: Parameters<typeof isolated.db.transaction>[0]) =>
        isolated.db.transaction(async (tx) => {
          await callback(tx);
          throw new Error("simulated commit failure");
        });
    },
  });
  const app = await startApp(database, {
    deleteUser: async (userId) => {
      deletedUsers.push(userId);
    },
  });
  try {
    const participant = await createParticipant(isolated.db, "recoverable@example.test");
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-deleted-user" })
      .where(eq(participantsTable.id, participant.id));

    const firstResponse = await fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    assert.equal(firstResponse.status, 500);
    assert.deepEqual(deletedUsers, ["clerk-deleted-user", "clerk-deleted-user"]);

    const [recoverable] = await isolated.db.select().from(participantsTable);
    assert.equal(recoverable.id, participant.id);
    assert.equal(recoverable.clerkUserId, null);

    const retryResponse = await fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    assert.equal(retryResponse.status, 500);
    assert.deepEqual(deletedUsers, ["clerk-deleted-user", "clerk-deleted-user"]);
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("delayed compensation preserves an identity claimed after rollback", async () => {
  const isolated = await createIsolatedTestDatabase("participant_delete_reclaim_race");
  const compensationStarted = deferred();
  const finishCompensation = deferred();
  const deletedUsers: string[] = [];
  const database = new Proxy(isolated.db, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (callback: Parameters<typeof isolated.db.transaction>[0]) =>
        isolated.db.transaction(async (tx) => {
          await callback(tx);
          throw new Error("simulated commit failure");
        });
    },
  });
  const app = await startApp(database, {
    deleteUser: async (userId) => {
      deletedUsers.push(userId);
      if (deletedUsers.length === 2) {
        compensationStarted.resolve();
        await finishCompensation.promise;
        throw Object.assign(new Error("already deleted"), { status: 404 });
      }
    },
  });
  try {
    const participant = await createParticipant(isolated.db, "reclaimed@example.test");
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-old-user" })
      .where(eq(participantsTable.id, participant.id));

    const deletion = fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    await compensationStarted.promise;

    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-new-user" })
      .where(eq(participantsTable.id, participant.id));
    finishCompensation.resolve();

    const response = await deletion;
    assert.equal(response.status, 500);
    assert.deepEqual(deletedUsers, ["clerk-old-user", "clerk-old-user"]);

    const [reclaimed] = await isolated.db.select().from(participantsTable);
    assert.equal(reclaimed.id, participant.id);
    assert.equal(reclaimed.clerkUserId, "clerk-new-user");
    assert.deepEqual(await isolated.db.select().from(participantIdentityReleasesTable), []);
  } finally {
    finishCompensation.resolve();
    await app.close();
    await isolated.dispose();
  }
});

test("a durable retry releases the stale identity after transaction and immediate compensation failures", async () => {
  const isolated = await createIsolatedTestDatabase("participant_delete_compensation_failure");
  let databaseUnavailable = false;
  const database = new Proxy(isolated.db, {
    get(target, property, receiver) {
      if (databaseUnavailable && property !== "transaction") {
        return () => {
          throw new Error("simulated complete database outage");
        };
      }
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (callback: Parameters<typeof isolated.db.transaction>[0]) =>
        isolated.db.transaction(async (tx) => {
          await callback(tx);
          if (databaseUnavailable) throw new Error("simulated commit failure");
        });
    },
  });
  const deletedUsers: string[] = [];
  const app = await startApp(database, {
    deleteUser: async (userId) => {
      deletedUsers.push(userId);
      databaseUnavailable = true;
    },
  });
  try {
    const participant = await createParticipant(isolated.db, "durable-recovery@example.test");
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-durable-recovery" })
      .where(eq(participantsTable.id, participant.id));

    const response = await fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    assert.equal(response.status, 500);

    databaseUnavailable = false;
    const [stillLinked] = await isolated.db.select().from(participantsTable);
    assert.equal(stillLinked.clerkUserId, "clerk-durable-recovery");
    assert.equal((await isolated.db.select().from(participantIdentityReleasesTable)).length, 1);

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(database, async (userId) => {
      deletedUsers.push(userId);
      throw Object.assign(new Error("already deleted"), { status: 404 });
    }), 1);

    const [recoverable] = await isolated.db.select().from(participantsTable);
    assert.equal(recoverable.clerkUserId, null);
    assert.deepEqual(await isolated.db.select().from(participantIdentityReleasesTable), []);
    assert.deepEqual(deletedUsers, ["clerk-durable-recovery", "clerk-durable-recovery"]);
    assert.equal(await retryParticipantIdentityReleases(database, async () => {}), 0);
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("a durable retry keeps a newly claimed identity and its release after a database outage", async () => {
  const isolated = await createIsolatedTestDatabase("participant_identity_release_database_outage");
  let databaseUnavailable = false;
  const database = new Proxy(isolated.db, {
    get(target, property, receiver) {
      if (databaseUnavailable) {
        return () => {
          throw new Error("simulated complete database outage");
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const deletedUsers: string[] = [];
  try {
    const participant = await createParticipant(isolated.db, "reclaimed-during-retry@example.test");
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-old-user" })
      .where(eq(participantsTable.id, participant.id));
    await isolated.db.insert(participantIdentityReleasesTable).values({
      participantId: participant.id,
      clerkUserId: "clerk-old-user",
    });

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(database, async (userId) => {
      deletedUsers.push(userId);
      await isolated.db.update(participantsTable)
        .set({ clerkUserId: "clerk-new-user" })
        .where(eq(participantsTable.id, participant.id));
      databaseUnavailable = true;
    }), 1);

    databaseUnavailable = false;
    const [reclaimedAfterFailure] = await isolated.db.select().from(participantsTable);
    assert.equal(reclaimedAfterFailure.clerkUserId, "clerk-new-user");
    assert.equal((await isolated.db.select().from(participantIdentityReleasesTable)).length, 1);

    assert.equal(await retryParticipantIdentityReleases(database, async (userId) => {
      deletedUsers.push(userId);
      throw Object.assign(new Error("already deleted"), { status: 404 });
    }), 1);

    const [reclaimedAfterCleanup] = await isolated.db.select().from(participantsTable);
    assert.equal(reclaimedAfterCleanup.clerkUserId, "clerk-new-user");
    assert.deepEqual(await isolated.db.select().from(participantIdentityReleasesTable), []);
    assert.deepEqual(deletedUsers, ["clerk-old-user", "clerk-old-user"]);
  } finally {
    await isolated.dispose();
  }
});

test("an ambiguous Clerk deletion error keeps the durable intent for confirmation", async () => {
  const isolated = await createIsolatedTestDatabase("participant_delete_ambiguous_clerk_error");
  const app = await startApp(isolated.db, {
    deleteUser: async () => {
      throw new Error("simulated lost Clerk response");
    },
  });
  try {
    const participant = await createParticipant(isolated.db, "ambiguous-clerk@example.test");
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-ambiguous-deletion" })
      .where(eq(participantsTable.id, participant.id));

    const response = await fetch(`${app.baseUrl}/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    assert.equal(response.status, 502);

    const [stillLinked] = await isolated.db.select().from(participantsTable);
    assert.equal(stillLinked.clerkUserId, "clerk-ambiguous-deletion");
    assert.equal((await isolated.db.select().from(participantIdentityReleasesTable)).length, 1);

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(isolated.db, async () => {}), 1);

    const [recoverable] = await isolated.db.select().from(participantsTable);
    assert.equal(recoverable.clerkUserId, null);
    assert.deepEqual(await isolated.db.select().from(participantIdentityReleasesTable), []);
  } finally {
    await app.close();
    await isolated.dispose();
  }
});

test("a failed identity release does not block another participant in the same retry round", async () => {
  const isolated = await createIsolatedTestDatabase("participant_identity_release_independent_retries");
  const attemptedUsers: string[] = [];
  try {
    const failingParticipant = await createParticipant(
      isolated.db,
      "failing-recovery@example.test",
    );
    const recoverableParticipant = await createParticipant(
      isolated.db,
      "successful-recovery@example.test",
    );
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-failing-recovery" })
      .where(eq(participantsTable.id, failingParticipant.id));
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-successful-recovery" })
      .where(eq(participantsTable.id, recoverableParticipant.id));
    await isolated.db.insert(participantIdentityReleasesTable).values([
      {
        participantId: failingParticipant.id,
        clerkUserId: "clerk-failing-recovery",
      },
      {
        participantId: recoverableParticipant.id,
        clerkUserId: "clerk-successful-recovery",
      },
    ]);

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(isolated.db, async (userId) => {
      attemptedUsers.push(userId);
      if (userId === "clerk-failing-recovery") {
        throw Object.assign(new Error("temporary Clerk failure"), { status: 503 });
      }
    }), 2);

    assert.deepEqual(
      attemptedUsers.sort(),
      ["clerk-failing-recovery", "clerk-successful-recovery"],
    );
    const [stillPending] = await isolated.db.select()
      .from(participantIdentityReleasesTable);
    assert.equal(stillPending.participantId, failingParticipant.id);
    assert.equal(stillPending.clerkUserId, "clerk-failing-recovery");

    const [failingAfterRetry] = await isolated.db.select()
      .from(participantsTable)
      .where(eq(participantsTable.id, failingParticipant.id));
    const [recoveredAfterRetry] = await isolated.db.select()
      .from(participantsTable)
      .where(eq(participantsTable.id, recoverableParticipant.id));
    assert.equal(failingAfterRetry.clerkUserId, "clerk-failing-recovery");
    assert.equal(recoveredAfterRetry.clerkUserId, null);
  } finally {
    await isolated.dispose();
  }
});

test("a failed identity release database cleanup does not block another participant in the same retry round", async () => {
  const isolated = await createIsolatedTestDatabase(
    "participant_identity_release_independent_database_retries",
  );
  let releaseDeletions = 0;
  const database = new Proxy(isolated.db, {
    get(target, property, receiver) {
      if (property !== "delete") return Reflect.get(target, property, receiver);
      return (table: Parameters<typeof isolated.db.delete>[0]) => {
        if (table === participantIdentityReleasesTable && releaseDeletions++ === 0) {
          throw new Error("simulated release cleanup failure");
        }
        return isolated.db.delete(table);
      };
    },
  });
  const attemptedUsers: string[] = [];
  try {
    const failingParticipant = await createParticipant(
      isolated.db,
      "database-failing-recovery@example.test",
    );
    const recoverableParticipant = await createParticipant(
      isolated.db,
      "database-successful-recovery@example.test",
    );
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-database-failing-recovery" })
      .where(eq(participantsTable.id, failingParticipant.id));
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-database-successful-recovery" })
      .where(eq(participantsTable.id, recoverableParticipant.id));
    await isolated.db.insert(participantIdentityReleasesTable).values([
      {
        participantId: failingParticipant.id,
        clerkUserId: "clerk-database-failing-recovery",
      },
      {
        participantId: recoverableParticipant.id,
        clerkUserId: "clerk-database-successful-recovery",
      },
    ]);

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(database, async (userId) => {
      attemptedUsers.push(userId);
    }), 2);

    assert.deepEqual(attemptedUsers, [
      "clerk-database-failing-recovery",
      "clerk-database-successful-recovery",
    ]);
    const pending = await isolated.db.select()
      .from(participantIdentityReleasesTable);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].participantId, failingParticipant.id);
    assert.equal(pending[0].clerkUserId, "clerk-database-failing-recovery");

    const [failingAfterRetry] = await isolated.db.select()
      .from(participantsTable)
      .where(eq(participantsTable.id, failingParticipant.id));
    const [recoveredAfterRetry] = await isolated.db.select()
      .from(participantsTable)
      .where(eq(participantsTable.id, recoverableParticipant.id));
    assert.equal(failingAfterRetry.clerkUserId, null);
    assert.equal(recoveredAfterRetry.clerkUserId, null);

    assert.equal(await retryParticipantIdentityReleases(
      database,
      async (userId) => {
        attemptedUsers.push(userId);
        throw Object.assign(new Error("already deleted"), { status: 404 });
      },
    ), 1);
    assert.deepEqual(attemptedUsers, [
      "clerk-database-failing-recovery",
      "clerk-database-successful-recovery",
      "clerk-database-failing-recovery",
    ]);
    assert.deepEqual(
      await isolated.db.select().from(participantIdentityReleasesTable),
      [],
    );
  } finally {
    await isolated.dispose();
  }
});

test("a failed overdue warning update does not block identity releases in the same retry round", async () => {
  const isolated = await createIsolatedTestDatabase(
    "participant_identity_release_warning_failure",
  );
  let warningUpdates = 0;
  const database = new Proxy(isolated.db, {
    get(target, property, receiver) {
      if (property !== "update") return Reflect.get(target, property, receiver);
      return (table: Parameters<typeof isolated.db.update>[0]) => {
        if (table === participantIdentityReleasesTable && warningUpdates++ === 0) {
          throw new Error("simulated warning update failure");
        }
        return isolated.db.update(table);
      };
    },
  });
  const attemptedUsers: string[] = [];
  const warnings: number[] = [];
  try {
    const firstParticipant = await createParticipant(
      isolated.db,
      "overdue-warning-failure@example.test",
    );
    const secondParticipant = await createParticipant(
      isolated.db,
      "overdue-warning-success@example.test",
    );
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-overdue-warning-failure" })
      .where(eq(participantsTable.id, firstParticipant.id));
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-overdue-warning-success" })
      .where(eq(participantsTable.id, secondParticipant.id));

    const now = new Date("2026-09-19T12:00:00.000Z");
    const createdAt = new Date(now.getTime() - 16 * 60 * 1_000);
    await isolated.db.insert(participantIdentityReleasesTable).values([
      {
        participantId: firstParticipant.id,
        clerkUserId: "clerk-overdue-warning-failure",
        createdAt,
      },
      {
        participantId: secondParticipant.id,
        clerkUserId: "clerk-overdue-warning-success",
        createdAt,
      },
    ]);

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(
      database,
      async (userId) => {
        attemptedUsers.push(userId);
      },
      {
        now,
        warn: ({ participantId }) => {
          warnings.push(participantId);
        },
      },
    ), 2);

    assert.deepEqual(attemptedUsers, [
      "clerk-overdue-warning-failure",
      "clerk-overdue-warning-success",
    ]);
    assert.deepEqual(warnings, [secondParticipant.id]);
    assert.deepEqual(
      await isolated.db.select().from(participantIdentityReleasesTable),
      [],
    );
    const participants = await isolated.db.select().from(participantsTable);
    assert.ok(participants.every((participant) => participant.clerkUserId === null));
  } finally {
    await isolated.dispose();
  }
});

test("a failed overdue warning callback still releases the participant identity", async () => {
  const isolated = await createIsolatedTestDatabase(
    "participant_identity_release_warning_callback_failure",
  );
  const attemptedUsers: string[] = [];
  try {
    const participant = await createParticipant(
      isolated.db,
      "overdue-warning-callback-failure@example.test",
    );
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-overdue-warning-callback-failure" })
      .where(eq(participantsTable.id, participant.id));

    const now = new Date("2026-09-19T12:00:00.000Z");
    await isolated.db.insert(participantIdentityReleasesTable).values({
      participantId: participant.id,
      clerkUserId: "clerk-overdue-warning-callback-failure",
      createdAt: new Date(now.getTime() - 16 * 60 * 1_000),
    });

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(
      isolated.db,
      async (userId) => {
        attemptedUsers.push(userId);
      },
      {
        now,
        warn: () => {
          throw new Error("simulated warning callback failure");
        },
      },
    ), 1);

    assert.deepEqual(attemptedUsers, ["clerk-overdue-warning-callback-failure"]);
    assert.deepEqual(
      await isolated.db.select().from(participantIdentityReleasesTable),
      [],
    );
    const [releasedParticipant] = await isolated.db.select()
      .from(participantsTable)
      .where(eq(participantsTable.id, participant.id));
    assert.equal(releasedParticipant.clerkUserId, null);
  } finally {
    await isolated.dispose();
  }
});

test("a rejected async overdue warning still releases the participant identity", async () => {
  const isolated = await createIsolatedTestDatabase(
    "participant_identity_release_async_warning_callback_failure",
  );
  const attemptedUsers: string[] = [];
  try {
    const participant = await createParticipant(
      isolated.db,
      "overdue-async-warning-callback-failure@example.test",
    );
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-overdue-async-warning-callback-failure" })
      .where(eq(participantsTable.id, participant.id));

    const now = new Date("2026-09-19T12:00:00.000Z");
    await isolated.db.insert(participantIdentityReleasesTable).values({
      participantId: participant.id,
      clerkUserId: "clerk-overdue-async-warning-callback-failure",
      createdAt: new Date(now.getTime() - 16 * 60 * 1_000),
    });

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    assert.equal(await retryParticipantIdentityReleases(
      isolated.db,
      async (userId) => {
        attemptedUsers.push(userId);
      },
      {
        now,
        warn: async () => {
          throw new Error("simulated async warning callback failure");
        },
      },
    ), 1);

    assert.deepEqual(attemptedUsers, ["clerk-overdue-async-warning-callback-failure"]);
    assert.deepEqual(
      await isolated.db.select().from(participantIdentityReleasesTable),
      [],
    );
    const [releasedParticipant] = await isolated.db.select()
      .from(participantsTable)
      .where(eq(participantsTable.id, participant.id));
    assert.equal(releasedParticipant.clerkUserId, null);
  } finally {
    await isolated.dispose();
  }
});

test("concurrent durable retries claim one overdue warning and safely finish the release", async () => {
  const isolated = await createIsolatedTestDatabase(
    "participant_identity_release_warning_race",
  );
  const bothRoundsSelected = deferred();
  let selectedRounds = 0;
  const database = new Proxy(isolated.db, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      return (...args: Parameters<typeof isolated.db.select>) => {
        const selection = isolated.db.select(...args);
        return new Proxy(selection, {
          get(selectTarget, selectProperty, selectReceiver) {
            if (selectProperty !== "from") {
              return Reflect.get(selectTarget, selectProperty, selectReceiver);
            }
            return async (table: Parameters<typeof selection.from>[0]) => {
              const rows = await selection.from(table);
              if (table === participantIdentityReleasesTable) {
                selectedRounds += 1;
                if (selectedRounds === 2) bothRoundsSelected.resolve();
                await bothRoundsSelected.promise;
              }
              return rows;
            };
          },
        });
      };
    },
  }) as typeof isolated.db;
  const warnings: number[] = [];
  const deletedUsers: string[] = [];
  try {
    const participant = await createParticipant(
      isolated.db,
      "concurrent-overdue-warning@example.test",
    );
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-concurrent-overdue-warning" })
      .where(eq(participantsTable.id, participant.id));
    const now = new Date("2026-09-19T12:00:00.000Z");
    await isolated.db.insert(participantIdentityReleasesTable).values({
      participantId: participant.id,
      clerkUserId: "clerk-concurrent-overdue-warning",
      createdAt: new Date(now.getTime() - 16 * 60 * 1_000),
    });

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    const retry = () => retryParticipantIdentityReleases(
      database,
      async (userId) => {
        deletedUsers.push(userId);
      },
      {
        now,
        warn: ({ releaseId }) => {
          warnings.push(releaseId);
        },
      },
    );

    assert.deepEqual(await Promise.all([retry(), retry()]), [1, 1]);
    assert.equal(selectedRounds, 2);
    assert.equal(warnings.length, 1);
    assert.deepEqual(deletedUsers, [
      "clerk-concurrent-overdue-warning",
      "clerk-concurrent-overdue-warning",
    ]);
    assert.deepEqual(
      await isolated.db.select().from(participantIdentityReleasesTable),
      [],
    );
    const [releasedParticipant] = await isolated.db.select().from(participantsTable);
    assert.equal(releasedParticipant.clerkUserId, null);
  } finally {
    bothRoundsSelected.resolve();
    await isolated.dispose();
  }
});

test("concurrent durable retries preserve an identity claimed while both delete the stale account", async () => {
  const isolated = await createIsolatedTestDatabase("participant_identity_release_retry_race");
  const bothDeletionsStarted = deferred();
  const finishDeletions = deferred();
  const deletedUsers: string[] = [];
  try {
    const participant = await createParticipant(isolated.db, "concurrent-recovery@example.test");
    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-old-user" })
      .where(eq(participantsTable.id, participant.id));
    await isolated.db.insert(participantIdentityReleasesTable).values({
      participantId: participant.id,
      clerkUserId: "clerk-old-user",
    });

    const { retryParticipantIdentityReleases } = await import("../services/participantAccess.ts");
    const deleteUser = async (userId: string) => {
      deletedUsers.push(userId);
      const attempt = deletedUsers.length;
      if (attempt === 2) bothDeletionsStarted.resolve();
      await finishDeletions.promise;
      if (attempt === 2) {
        throw Object.assign(new Error("already deleted"), { status: 404 });
      }
    };

    const firstRetry = retryParticipantIdentityReleases(isolated.db, deleteUser);
    const secondRetry = retryParticipantIdentityReleases(isolated.db, deleteUser);
    await bothDeletionsStarted.promise;

    await isolated.db.update(participantsTable)
      .set({ clerkUserId: "clerk-new-user" })
      .where(eq(participantsTable.id, participant.id));
    finishDeletions.resolve();

    assert.deepEqual(await Promise.all([firstRetry, secondRetry]), [1, 1]);
    assert.deepEqual(deletedUsers, ["clerk-old-user", "clerk-old-user"]);

    const [reclaimed] = await isolated.db.select().from(participantsTable);
    assert.equal(reclaimed.clerkUserId, "clerk-new-user");
    assert.deepEqual(await isolated.db.select().from(participantIdentityReleasesTable), []);
    assert.equal(await retryParticipantIdentityReleases(isolated.db, async () => {}), 0);
  } finally {
    finishDeletions.resolve();
    await isolated.dispose();
  }
});
