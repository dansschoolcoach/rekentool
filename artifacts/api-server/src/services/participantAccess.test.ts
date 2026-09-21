import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isParticipantIdentityReleaseOverdue,
  getOverdueParticipantIdentityReleases,
  PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS,
  PARTICIPANT_IDENTITY_RELEASE_WARNING_INTERVAL_MS,
  retryParticipantIdentityReleases,
  resolveParticipantAccess,
  revokeParticipantIdentity,
  shouldWarnForParticipantIdentityRelease,
  type ClerkUser,
  type ParticipantAccessDependencies,
} from "./participantAccess.ts";

type Participant = {
  id: number;
  email: string;
  clerkUserId: string | null;
};

function accessFixture(options: {
  participant?: Participant;
  user?: ClerkUser;
} = {}) {
  let participant = options.participant ?? {
    id: 1,
    email: "lid@example.nl",
    clerkUserId: null,
  };
  const user = options.user ?? {
    primaryEmailAddressId: "email_1",
    emailAddresses: [{
      id: "email_1",
      emailAddress: "LID@example.nl",
      verification: { status: "verified" },
    }],
  };
  const dependencies: ParticipantAccessDependencies<Participant> = {
    async getUser() {
      return user;
    },
    async findByClerkUserId(userId) {
      return participant.clerkUserId === userId ? participant : null;
    },
    async claimUnclaimedByEmail(email, userId) {
      if (participant.email.toLowerCase() !== email || participant.clerkUserId) return null;
      participant = { ...participant, clerkUserId: userId };
      return participant;
    },
  };
  return { dependencies, current: () => participant };
}

describe("participant access boundary", () => {
  it("marks only identity releases older than the warning threshold as overdue", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const release = (ageMs: number) => ({
      id: 1,
      participantId: 2,
      createdAt: new Date(now.getTime() - ageMs),
    });

    assert.equal(
      isParticipantIdentityReleaseOverdue(
        release(PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS + 1),
        now,
      ),
      true,
    );
    assert.equal(
      isParticipantIdentityReleaseOverdue(
        release(PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS),
        now,
      ),
      false,
    );
    assert.equal(
      isParticipantIdentityReleaseOverdue(release(30_000), now),
      false,
    );
  });

  it("reports overdue releases using only internal record context and waiting time", async () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const rows = [
      {
        id: 10,
        participantId: 4,
        clerkUserId: "must-not-be-returned",
        createdAt: new Date(now.getTime() - PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS - 60_000),
      },
      {
        id: 11,
        participantId: 5,
        clerkUserId: "also-private",
        createdAt: new Date(now.getTime() - 30_000),
      },
    ];
    const database = {
      select() {
        return { from: async () => rows };
      },
    } as unknown as Parameters<typeof getOverdueParticipantIdentityReleases>[0];

    assert.deepEqual(await getOverdueParticipantIdentityReleases(database, now), {
      overdueCount: 1,
      records: [{
        releaseId: 10,
        participantId: 4,
        waitingMinutes: 16,
      }],
    });
  });

  it("warns overdue recovery records independently at the hourly repeat interval", async () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const overdueSince = new Date(
      now.getTime() - PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS - 60_000,
    );
    const rows = [
      {
        id: 10,
        participantId: 1,
        clerkUserId: "user_recently_warned",
        createdAt: overdueSince,
        lastWarnedAt: new Date(
          now.getTime() - PARTICIPANT_IDENTITY_RELEASE_WARNING_INTERVAL_MS + 1,
        ),
      },
      {
        id: 20,
        participantId: 2,
        clerkUserId: "user_never_warned",
        createdAt: overdueSince,
        lastWarnedAt: null,
      },
      {
        id: 30,
        participantId: 3,
        clerkUserId: "user_repeat_due",
        createdAt: overdueSince,
        lastWarnedAt: new Date(
          now.getTime() - PARTICIPANT_IDENTITY_RELEASE_WARNING_INTERVAL_MS,
        ),
      },
    ];
    const warnedReleaseIds: number[] = [];
    const warningUpdates: number[] = [];
    const database = {
      select() {
        return { from: async () => rows };
      },
      update(table: unknown) {
        return {
          set(values: { lastWarnedAt?: Date; clerkUserId?: null }) {
            return {
              where() {
                if (!("lastWarnedAt" in values)) {
                  return Promise.resolve();
                }
                const releaseId = warningUpdates.length === 0 ? 20 : 30;
                warningUpdates.push(releaseId);
                return {
                  async returning() {
                    return [{ id: releaseId }];
                  },
                };
              },
            };
          },
        };
      },
      delete() {
        return { async where() {} };
      },
    } as unknown as Parameters<typeof retryParticipantIdentityReleases>[0];

    await retryParticipantIdentityReleases(
      database,
      async () => {
        throw new Error("keep pending for the next retry");
      },
      {
        now,
        warn: ({ releaseId }) => {
          warnedReleaseIds.push(releaseId);
        },
      },
    );

    assert.deepEqual(warnedReleaseIds, [20, 30]);
    assert.deepEqual(warningUpdates, [20, 30]);
    assert.equal(shouldWarnForParticipantIdentityRelease(rows[0], now), false);
    assert.equal(shouldWarnForParticipantIdentityRelease(rows[1], now), true);
    assert.equal(shouldWarnForParticipantIdentityRelease(rows[2], now), true);
  });

  it("warns only once when overlapping recovery rounds read the same overdue record", async () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const release = {
      id: 40,
      participantId: 4,
      clerkUserId: "user_overlapping_retries",
      createdAt: new Date(
        now.getTime() - PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS - 60_000,
      ),
      lastWarnedAt: null as Date | null,
    };
    let selectCount = 0;
    let releaseSelects: (() => void) | undefined;
    const bothRoundsSelected = new Promise<void>((resolve) => {
      releaseSelects = resolve;
    });
    let warningClaimCount = 0;
    const warnedReleaseIds: number[] = [];
    const database = {
      select() {
        return {
          async from() {
            const snapshot = [{ ...release }];
            selectCount += 1;
            if (selectCount === 2) releaseSelects?.();
            await bothRoundsSelected;
            return snapshot;
          },
        };
      },
      update() {
        return {
          set(values: { lastWarnedAt?: Date; clerkUserId?: null }) {
            return {
              where() {
                if (!("lastWarnedAt" in values)) {
                  return Promise.resolve();
                }
                return {
                  async returning() {
                    if (release.lastWarnedAt !== null) return [];
                    release.lastWarnedAt = values.lastWarnedAt ?? null;
                    warningClaimCount += 1;
                    return [{ id: release.id }];
                  },
                };
              },
            };
          },
        };
      },
      delete() {
        return { async where() {} };
      },
    } as unknown as Parameters<typeof retryParticipantIdentityReleases>[0];

    await Promise.all([
      retryParticipantIdentityReleases(
        database,
        async () => {
          throw new Error("keep pending for the next retry");
        },
        {
          now,
          warn: ({ releaseId }) => {
            warnedReleaseIds.push(releaseId);
          },
        },
      ),
      retryParticipantIdentityReleases(
        database,
        async () => {
          throw new Error("keep pending for the next retry");
        },
        {
          now,
          warn: ({ releaseId }) => {
            warnedReleaseIds.push(releaseId);
          },
        },
      ),
    ]);

    assert.equal(selectCount, 2);
    assert.equal(warningClaimCount, 1);
    assert.deepEqual(warnedReleaseIds, [40]);
  });

  it("lets a verified allowlisted email claim its participant profile", async () => {
    const fixture = accessFixture();
    const resolved = await resolveParticipantAccess("user_1", fixture.dependencies);

    assert.equal(resolved?.id, 1);
    assert.equal(fixture.current().clerkUserId, "user_1");
  });

  it("claims with the canonical form of a verified Clerk email", async () => {
    const fixture = accessFixture({
      user: {
        primaryEmailAddressId: "email_1",
        emailAddresses: [{
          id: "email_1",
          emailAddress: " LID@Example.NL ",
          verification: { status: "verified" },
        }],
      },
    });

    const resolved = await resolveParticipantAccess("user_1", fixture.dependencies);

    assert.equal(resolved?.id, 1);
  });

  it("does not create access for an email that is not allowlisted", async () => {
    const fixture = accessFixture({
      user: {
        primaryEmailAddressId: "email_2",
        emailAddresses: [{
          id: "email_2",
          emailAddress: "onbekend@example.nl",
          verification: { status: "verified" },
        }],
      },
    });

    assert.equal(await resolveParticipantAccess("user_2", fixture.dependencies), null);
    assert.equal(fixture.current().clerkUserId, null);
  });

  it("does not create access for an unverified email", async () => {
    const fixture = accessFixture({
      user: {
        primaryEmailAddressId: "email_1",
        emailAddresses: [{
          id: "email_1",
          emailAddress: "lid@example.nl",
          verification: { status: "unverified" },
        }],
      },
    });

    assert.equal(await resolveParticipantAccess("user_2", fixture.dependencies), null);
    assert.equal(fixture.current().clerkUserId, null);
  });

  it("does not let a second account take over a claimed profile", async () => {
    const fixture = accessFixture({
      participant: { id: 1, email: "lid@example.nl", clerkUserId: "user_1" },
    });

    assert.equal(await resolveParticipantAccess("user_2", fixture.dependencies), null);
    assert.equal(fixture.current().clerkUserId, "user_1");
  });

  it("deletes the linked Clerk account when a participant is removed", async () => {
    const deletedUsers: string[] = [];
    await revokeParticipantIdentity(
      { email: "lid@example.nl", clerkUserId: "user_1" },
      {
        async deleteUser(userId) {
          deletedUsers.push(userId);
        },
        async getPendingInvitations() {
          throw new Error("linked participants must not use invitation cleanup");
        },
        async revokeInvitation() {},
      },
    );

    assert.deepEqual(deletedUsers, ["user_1"]);
  });

  it("continues with later identity releases after one database failure", async () => {
    const releases = [
      {
        id: 10,
        participantId: 1,
        clerkUserId: "user_stuck",
        createdAt: new Date(),
      },
      {
        id: 20,
        participantId: 2,
        clerkUserId: "user_valid",
        createdAt: new Date(),
      },
    ];
    const deletedUsers: string[] = [];
    const updatedParticipants: number[] = [];
    const deletedReleases: number[] = [];
    let updateNumber = 0;
    const database = {
      select() {
        return { from: async () => releases };
      },
      update() {
        updateNumber += 1;
        const currentUpdate = updateNumber;
        return {
          set(values: { lastWarnedAt?: Date }) {
            return {
              async where() {
                if ("lastWarnedAt" in values) return;
                if (currentUpdate === 1) throw new Error("database unavailable");
                updatedParticipants.push(2);
              },
            };
          },
        };
      },
      delete() {
        return {
          async where() {
            deletedReleases.push(20);
          },
        };
      },
    } as unknown as Parameters<typeof retryParticipantIdentityReleases>[0];

    const processed = await retryParticipantIdentityReleases(database, async (userId) => {
      deletedUsers.push(userId);
    });

    assert.equal(processed, 2);
    assert.deepEqual(deletedUsers, ["user_stuck", "user_valid"]);
    assert.deepEqual(updatedParticipants, [2]);
    assert.deepEqual(deletedReleases, [20]);
  });
});
