import { and, eq, isNull, lte, or } from "drizzle-orm";
import {
  participantIdentityReleasesTable,
  participantsTable,
  type db,
} from "@workspace/db";
import { logger } from "../lib/logger.ts";

export type ClerkEmailAddress = {
  id: string;
  emailAddress: string;
  verification?: { status?: string } | null;
};

export type ClerkUser = {
  primaryEmailAddressId?: string | null;
  emailAddresses: ClerkEmailAddress[];
};

export type ParticipantWithIdentity = {
  clerkUserId: string | null;
  email: string;
};

export type ParticipantAccessDependencies<TParticipant extends ParticipantWithIdentity> = {
  getUser(userId: string): Promise<ClerkUser>;
  findByClerkUserId(userId: string): Promise<TParticipant | null>;
  claimUnclaimedByEmail(email: string, userId: string): Promise<TParticipant | null>;
};

export function canonicalParticipantEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function resolveParticipantAccess<TParticipant extends ParticipantWithIdentity>(
  userId: string,
  dependencies: ParticipantAccessDependencies<TParticipant>,
): Promise<TParticipant | null> {
  const existing = await dependencies.findByClerkUserId(userId);
  if (existing) return existing;

  const user = await dependencies.getUser(userId);
  const primaryEmail = user.emailAddresses.find(
    (address) => address.id === user.primaryEmailAddressId,
  );
  if (!primaryEmail || primaryEmail.verification?.status !== "verified") return null;

  const claimed = await dependencies.claimUnclaimedByEmail(
    canonicalParticipantEmail(primaryEmail.emailAddress),
    userId,
  );
  if (claimed) return claimed;

  // A concurrent request may have completed this user's claim first.
  return dependencies.findByClerkUserId(userId);
}

type Invitation = { id: string; emailAddress: string };

export type ParticipantIdentityDependencies = {
  deleteUser(userId: string): Promise<unknown>;
  getPendingInvitations(email: string): Promise<Invitation[]>;
  revokeInvitation(invitationId: string): Promise<unknown>;
};

export type ParticipantIdentityRevocation = "login-account" | "pending-invitations";

export async function revokeParticipantIdentity(
  participant: ParticipantWithIdentity,
  dependencies: ParticipantIdentityDependencies,
): Promise<ParticipantIdentityRevocation> {
  if (participant.clerkUserId) {
    try {
      await dependencies.deleteUser(participant.clerkUserId);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
    return "login-account";
  }

  const email = canonicalParticipantEmail(participant.email);
  const invitations = await dependencies.getPendingInvitations(email);
  await Promise.all(
    invitations
      .filter((invitation) => canonicalParticipantEmail(invitation.emailAddress) === email)
      .map((invitation) => dependencies.revokeInvitation(invitation.id)),
  );
  return "pending-invitations";
}

type ParticipantDatabase = typeof db;

export const PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS = 15 * 60 * 1_000;
export const PARTICIPANT_IDENTITY_RELEASE_WARNING_INTERVAL_MS = 60 * 60 * 1_000;

type PendingParticipantIdentityRelease = {
  id: number;
  participantId: number;
  createdAt: Date;
  lastWarnedAt?: Date | null;
};

export function isParticipantIdentityReleaseOverdue(
  release: PendingParticipantIdentityRelease,
  now = new Date(),
) {
  return now.getTime() - release.createdAt.getTime()
    > PARTICIPANT_IDENTITY_RELEASE_WARNING_AGE_MS;
}

export function shouldWarnForParticipantIdentityRelease(
  release: PendingParticipantIdentityRelease,
  now = new Date(),
) {
  if (!isParticipantIdentityReleaseOverdue(release, now)) return false;
  return !release.lastWarnedAt
    || now.getTime() - release.lastWarnedAt.getTime()
      >= PARTICIPANT_IDENTITY_RELEASE_WARNING_INTERVAL_MS;
}

export async function getOverdueParticipantIdentityReleases(
  database: ParticipantDatabase,
  now = new Date(),
) {
  const pending = await database.select({
    id: participantIdentityReleasesTable.id,
    participantId: participantIdentityReleasesTable.participantId,
    createdAt: participantIdentityReleasesTable.createdAt,
  }).from(participantIdentityReleasesTable);
  const records = pending
    .filter((release) => isParticipantIdentityReleaseOverdue(release, now))
    .map((release) => ({
      releaseId: release.id,
      participantId: release.participantId,
      waitingMinutes: Math.floor((now.getTime() - release.createdAt.getTime()) / 60_000),
    }))
    .sort((left, right) => right.waitingMinutes - left.waitingMinutes);
  return { overdueCount: records.length, records };
}

export async function queueParticipantIdentityRelease(
  database: ParticipantDatabase,
  participantId: number,
  clerkUserId: string,
) {
  await database.insert(participantIdentityReleasesTable)
    .values({ participantId, clerkUserId })
    .onConflictDoNothing();
}

export async function retryParticipantIdentityReleases(
  database: ParticipantDatabase,
  deleteUser: (userId: string) => Promise<unknown>,
  options: {
    now?: Date;
    warn?: (context: {
      participantId: number;
      releaseId: number;
      waitingMinutes: number;
    }) => void | Promise<void>;
  } = {},
) {
  const now = options.now ?? new Date();
  const warn = options.warn ?? ((context) => {
    logger.warn(context, "Participant identity release has remained pending too long");
  });
  const pending = await database.select().from(participantIdentityReleasesTable);
  for (const release of pending) {
    if (shouldWarnForParticipantIdentityRelease(release, now)) {
      try {
        const claimedWarnings = await database.update(participantIdentityReleasesTable)
          .set({ lastWarnedAt: now })
          .where(and(
            eq(participantIdentityReleasesTable.id, release.id),
            or(
              isNull(participantIdentityReleasesTable.lastWarnedAt),
              lte(
                participantIdentityReleasesTable.lastWarnedAt,
                new Date(now.getTime() - PARTICIPANT_IDENTITY_RELEASE_WARNING_INTERVAL_MS),
              ),
            ),
          ))
          .returning({ id: participantIdentityReleasesTable.id });
        if (claimedWarnings.length > 0) {
          await warn({
            participantId: release.participantId,
            releaseId: release.id,
            waitingMinutes: Math.floor((now.getTime() - release.createdAt.getTime()) / 60_000),
          });
        }
      } catch (error) {
        logger.error({
          err: error,
          participantId: release.participantId,
          releaseId: release.id,
        }, "Could not record participant identity release warning");
      }
    }

    try {
      try {
        await deleteUser(release.clerkUserId);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
      await database.update(participantsTable)
        .set({ clerkUserId: null })
        .where(and(
          eq(participantsTable.id, release.participantId),
          eq(participantsTable.clerkUserId, release.clerkUserId),
        ));
      await database.delete(participantIdentityReleasesTable)
        .where(eq(participantIdentityReleasesTable.id, release.id));
    } catch (error) {
      logger.error({
        err: error,
        participantId: release.participantId,
        releaseId: release.id,
      }, "Could not retry participant identity release");
    }
  }
  return pending.length;
}
