import assert from "node:assert/strict";
import test from "node:test";
import { participantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";
import { resolveParticipantAccess } from "./participantAccess.ts";

test("two concurrent claims can assign an allowlisted profile to exactly one Clerk user", async () => {
  const isolated = await createIsolatedTestDatabase("participant_access_test");
  const marker = `${Date.now()}-${process.pid}`;
  const email = `concurrent-claim-${marker}@example.test`;
  const userIds = [`user_${marker}_one`, `user_${marker}_two`] as const;
  const [participant] = await isolated.db.insert(participantsTable).values({
    schoolName: `Gelijktijdige claim ${marker}`,
    contactName: "Testdeelnemer",
    email,
  }).returning();

  const clients = await Promise.all([isolated.pool.connect(), isolated.pool.connect()]);
  let ready = 0;
  let releaseClaims!: () => void;
  const claimsReleased = new Promise<void>((resolve) => {
    releaseClaims = resolve;
  });

  try {
    const claims = userIds.map((userId, index) => resolveParticipantAccess(userId, {
      async getUser() {
        return {
          primaryEmailAddressId: `${userId}_email`,
          emailAddresses: [{
            id: `${userId}_email`,
            emailAddress: email.toUpperCase(),
            verification: { status: "verified" },
          }],
        };
      },
      async findByClerkUserId(id) {
        const result = await clients[index].query(
          "select id, email, clerk_user_id as \"clerkUserId\" from participants where clerk_user_id = $1 limit 1",
          [id],
        );
        return result.rows[0] ?? null;
      },
      async claimUnclaimedByEmail(normalizedEmail, id) {
        ready += 1;
        if (ready === userIds.length) releaseClaims();
        await claimsReleased;

        const result = await clients[index].query(
          `update participants
             set clerk_user_id = $1
           where lower(email) = $2
             and clerk_user_id is null
           returning id, email, clerk_user_id as "clerkUserId"`,
          [id, normalizedEmail],
        );
        return result.rows[0] ?? null;
      },
    }));

    const results = await Promise.all(claims);
    const winners = results.filter((result) => result !== null);
    assert.equal(winners.length, 1);

    const winnerId = winners[0].clerkUserId;
    const loserId = userIds.find((userId) => userId !== winnerId);
    assert.ok(loserId);

    const [stored] = await isolated.db.select().from(participantsTable)
      .where(eq(participantsTable.id, participant.id));
    assert.equal(stored.clerkUserId, winnerId);

    const losingProfiles = await isolated.db.select().from(participantsTable)
      .where(eq(participantsTable.clerkUserId, loserId));
    assert.equal(losingProfiles.length, 0);
  } finally {
    for (const client of clients) client.release();
    await isolated.dispose();
  }
});

test("two concurrent claims by the same Clerk user resolve to the same allowlisted profile", async () => {
  const isolated = await createIsolatedTestDatabase("participant_access_same_user_test");
  const marker = `${Date.now()}-${process.pid}`;
  const email = `same-user-concurrent-claim-${marker}@example.test`;
  const userId = `user_${marker}`;
  const [participant] = await isolated.db.insert(participantsTable).values({
    schoolName: `Gelijktijdige claim zelfde gebruiker ${marker}`,
    contactName: "Testdeelnemer",
    email,
  }).returning();

  const clients = await Promise.all([isolated.pool.connect(), isolated.pool.connect()]);
  let ready = 0;
  let releaseClaims!: () => void;
  const claimsReleased = new Promise<void>((resolve) => {
    releaseClaims = resolve;
  });

  try {
    const claims = clients.map((client) => resolveParticipantAccess(userId, {
      async getUser() {
        return {
          primaryEmailAddressId: `${userId}_email`,
          emailAddresses: [{
            id: `${userId}_email`,
            emailAddress: email.toUpperCase(),
            verification: { status: "verified" },
          }],
        };
      },
      async findByClerkUserId(id) {
        const result = await client.query(
          "select id, email, clerk_user_id as \"clerkUserId\" from participants where clerk_user_id = $1 limit 1",
          [id],
        );
        return result.rows[0] ?? null;
      },
      async claimUnclaimedByEmail(normalizedEmail, id) {
        ready += 1;
        if (ready === clients.length) releaseClaims();
        await claimsReleased;

        const result = await client.query(
          `update participants
             set clerk_user_id = $1
           where lower(email) = $2
             and clerk_user_id is null
           returning id, email, clerk_user_id as "clerkUserId"`,
          [id, normalizedEmail],
        );
        return result.rows[0] ?? null;
      },
    }));

    const results = await Promise.all(claims);
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.ok(result);
      assert.equal(result.id, participant.id);
      assert.equal(result.clerkUserId, userId);
    }

    const storedProfiles = await isolated.db.select().from(participantsTable)
      .where(eq(participantsTable.clerkUserId, userId));
    assert.equal(storedProfiles.length, 1);
    assert.equal(storedProfiles[0].id, participant.id);
  } finally {
    for (const client of clients) client.release();
    await isolated.dispose();
  }
});

test("a burst of concurrent claims by the same Clerk user all resolve to one allowlisted profile", async () => {
  const isolated = await createIsolatedTestDatabase("participant_access_burst_test");
  const marker = `${Date.now()}-${process.pid}`;
  const email = `burst-concurrent-claim-${marker}@example.test`;
  const userId = `user_${marker}`;
  const claimCount = 8;
  const [participant] = await isolated.db.insert(participantsTable).values({
    schoolName: `Piek gelijktijdige claims ${marker}`,
    contactName: "Testdeelnemer",
    email,
  }).returning();

  const clients = await Promise.all(
    Array.from({ length: claimCount }, () => isolated.pool.connect()),
  );
  let ready = 0;
  let releaseClaims!: () => void;
  const claimsReleased = new Promise<void>((resolve) => {
    releaseClaims = resolve;
  });

  try {
    const claims = clients.map((client) => resolveParticipantAccess(userId, {
      async getUser() {
        return {
          primaryEmailAddressId: `${userId}_email`,
          emailAddresses: [{
            id: `${userId}_email`,
            emailAddress: email.toUpperCase(),
            verification: { status: "verified" },
          }],
        };
      },
      async findByClerkUserId(id) {
        const result = await client.query(
          "select id, email, clerk_user_id as \"clerkUserId\" from participants where clerk_user_id = $1 limit 1",
          [id],
        );
        return result.rows[0] ?? null;
      },
      async claimUnclaimedByEmail(normalizedEmail, id) {
        ready += 1;
        if (ready === clients.length) releaseClaims();
        await claimsReleased;

        const result = await client.query(
          `update participants
             set clerk_user_id = $1
           where lower(email) = $2
             and clerk_user_id is null
           returning id, email, clerk_user_id as "clerkUserId"`,
          [id, normalizedEmail],
        );
        return result.rows[0] ?? null;
      },
    }));

    const results = await Promise.all(claims);
    assert.equal(results.length, claimCount);
    for (const result of results) {
      assert.ok(result);
      assert.equal(result.id, participant.id);
      assert.equal(result.clerkUserId, userId);
    }

    const storedProfiles = await isolated.db.select().from(participantsTable)
      .where(eq(participantsTable.clerkUserId, userId));
    assert.equal(storedProfiles.length, 1);
    assert.equal(storedProfiles[0].id, participant.id);
  } finally {
    for (const client of clients) client.release();
    await isolated.dispose();
  }
});

test("a burst of concurrent claims by different Clerk users assigns one allowlisted profile exactly once", async () => {
  const isolated = await createIsolatedTestDatabase("participant_access_different_users_burst_test");
  const marker = `${Date.now()}-${process.pid}`;
  const email = `different-users-burst-claim-${marker}@example.test`;
  const claimCount = 8;
  const userIds = Array.from(
    { length: claimCount },
    (_, index) => `user_${marker}_${index}`,
  );
  const [participant] = await isolated.db.insert(participantsTable).values({
    schoolName: `Piek verschillende gebruikers ${marker}`,
    contactName: "Testdeelnemer",
    email,
  }).returning();

  const clients = await Promise.all(
    Array.from({ length: claimCount }, () => isolated.pool.connect()),
  );
  let ready = 0;
  let releaseClaims!: () => void;
  const claimsReleased = new Promise<void>((resolve) => {
    releaseClaims = resolve;
  });

  try {
    const claims = userIds.map((userId, index) => resolveParticipantAccess(userId, {
      async getUser() {
        return {
          primaryEmailAddressId: `${userId}_email`,
          emailAddresses: [{
            id: `${userId}_email`,
            emailAddress: email.toUpperCase(),
            verification: { status: "verified" },
          }],
        };
      },
      async findByClerkUserId(id) {
        const result = await clients[index].query(
          "select id, email, clerk_user_id as \"clerkUserId\" from participants where clerk_user_id = $1 limit 1",
          [id],
        );
        return result.rows[0] ?? null;
      },
      async claimUnclaimedByEmail(normalizedEmail, id) {
        ready += 1;
        if (ready === clients.length) releaseClaims();
        await claimsReleased;

        const result = await clients[index].query(
          `update participants
             set clerk_user_id = $1
           where lower(email) = $2
             and clerk_user_id is null
           returning id, email, clerk_user_id as "clerkUserId"`,
          [id, normalizedEmail],
        );
        return result.rows[0] ?? null;
      },
    }));

    const results = await Promise.all(claims);
    const winners = results.filter((result) => result !== null);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].id, participant.id);
    assert.ok(userIds.includes(winners[0].clerkUserId));

    const linkedProfiles = await isolated.db.select().from(participantsTable)
      .where(eq(participantsTable.id, participant.id));
    assert.equal(linkedProfiles.length, 1);
    assert.equal(linkedProfiles[0].clerkUserId, winners[0].clerkUserId);

    const profilesLinkedToClaimants = await isolated.db.select().from(participantsTable);
    assert.equal(
      profilesLinkedToClaimants.filter(
        (profile) => profile.clerkUserId !== null && userIds.includes(profile.clerkUserId),
      ).length,
      1,
    );
  } finally {
    for (const client of clients) client.release();
    await isolated.dispose();
  }
});
