import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import multer from "multer";
import {
  db,
  challengeSettingsTable,
  coachMessagesTable,
  participantsTable,
  weeklyEntriesTable,
  type ChallengeSetting,
  type CoachMessage,
  type Participant as DbParticipant,
  type WeeklyEntry as DbWeeklyEntry,
} from "@workspace/db";
import {
  CreateParticipantBody,
  GetChallengeResponse,
  GetDashboardResponse,
  GetAdminWeeklyEntriesResponse,
  GetAdminParticipantMessagesParams,
  GetAdminParticipantMessagesResponse,
  GetAdminParticipantViewParams,
  GetAdminParticipantViewResponse,
  GetLeaderboardResponse,
  GetMessagesResponse,
  GetParticipantsResponse,
  GetParticipantRecoveryStatusResponse,
  PreviewParticipantImportResponse,
  ConfirmParticipantImportResponse,
  GetWeeksResponse,
  GetWeeklyEntriesResponse,
  UpdateChallengeBody,
  UpdateAdminWeeklyEntryBody,
  UpdateAdminWeeklyEntryQueryParams,
  UpdateAdminWeeklyEntryResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
  GetProfilePreferencesResponse,
  UpdateProfilePreferencesBody,
  UpdateProfilePreferencesResponse,
  CreateParticipantMessageParams,
  CreateParticipantMessageBody,
  CreateParticipantMessageResponse,
  SendParticipantReminderParams,
  SendParticipantReminderResponse,
  UpdateParticipantBody,
  UpdateParticipantParams,
  DeleteParticipantParams,
  UpsertWeeklyEntryBody,
} from "@workspace/api-zod";
import {
  canonicalParticipantEmail,
  getOverdueParticipantIdentityReleases,
  queueParticipantIdentityRelease,
  resolveParticipantAccess,
  retryParticipantIdentityReleases,
  revokeParticipantIdentity,
} from "../services/participantAccess.ts";
import { isUsableParticipantEmail } from "../services/participantImportValidation.ts";
import { parseParticipantImport, type ParticipantImportPreview } from "../services/participantImport.ts";

const router: IRouter = Router();
const participantImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const DEFAULT_START = "2026-09-14";
const DEFAULT_END = "2026-10-11";
const PARTICIPANT_EMAIL_UNIQUE_CONSTRAINTS = new Set([
  "participants_email_lower_unique",
  "participants_lower_idx",
  "participants_email_unique",
  "participants_email_key",
]);

type AuthedRequest = Request & { userId?: string };

function parseAdminInput<T>(
  result: { success: true; data: T } | { success: false; error: { message: string } },
  res: Response,
): T | undefined {
  if (!result.success) {
    res.status(400).json({ error: result.error.message });
    return undefined;
  }
  return result.data;
}

export function isParticipantEmailConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const wrappedError = error as { cause?: unknown };
  const databaseError = (
    wrappedError.cause && typeof wrappedError.cause === "object"
      ? wrappedError.cause
      : error
  ) as { code?: unknown; constraint?: unknown };
  return databaseError.code === "23505"
    && typeof databaseError.constraint === "string"
    && PARTICIPANT_EMAIL_UNIQUE_CONSTRAINTS.has(databaseError.constraint);
}

function dateAtUtc(value: string | Date) {
  const normalized = value instanceof Date ? formatDate(value) : value;
  return new Date(`${normalized}T00:00:00Z`);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = dateAtUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function daysInclusive(start: string, end: string) {
  return Math.max(1, Math.floor((dateAtUtc(end).getTime() - dateAtUtc(start).getTime()) / 86400000) + 1);
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function totals(entries: DbWeeklyEntry[]) {
  return entries.reduce(
    (result, entry) => ({
      signups: result.signups + entry.signups,
      attendance: result.attendance + entry.attendance,
      enrolled: result.enrolled + entry.enrolled,
    }),
    { signups: 0, attendance: 0, enrolled: 0 },
  );
}

function scores(participant: DbParticipant, entryTotals: ReturnType<typeof totals>) {
  return {
    growthPercent: participant.startingMembers
      ? roundPercent((entryTotals.enrolled / Math.max(1, participant.startingMembers)) * 100)
      : 0,
    conversionPercent: roundPercent((entryTotals.enrolled / Math.max(1, entryTotals.signups)) * 100),
    attendancePercent: roundPercent((entryTotals.attendance / Math.max(1, entryTotals.signups)) * 100),
  };
}

function messageView(message: CoachMessage) {
  return {
    id: message.id,
    participantId: message.participantId,
    authorName: message.authorName,
    body: message.body,
    createdAt: message.createdAt,
  };
}

function adminDisplayName(req: AuthedRequest) {
  const claims = (getAuth(req).sessionClaims ?? {}) as Record<string, unknown>;
  if (typeof claims.name === "string" && claims.name.trim()) return claims.name;
  const firstName = typeof claims.firstName === "string" ? claims.firstName : "";
  const lastName = typeof claims.lastName === "string" ? claims.lastName : "";
  return [firstName, lastName].filter(Boolean).join(" ") || "ByB coach";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function sendReminderEmail(participant: DbParticipant) {
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!fromEmail) {
    throw new Error("RESEND_FROM_EMAIL is not configured");
  }

  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [participant.email],
      subject: "Herinnering: werk je ByB cijfers bij",
      text: `Hoi ${participant.contactName},\n\nWil je je actuele startleden en je weekcijfers bijwerken in de ByB Ledenchallenge? Zo houden we samen goed zicht op je groei.\n\nGroet,\nByB`,
      html: `<p>Hoi ${escapeHtml(participant.contactName)},</p><p>Wil je je actuele startleden en je weekcijfers bijwerken in de ByB Ledenchallenge? Zo houden we samen goed zicht op je groei.</p><p>Groet,<br />ByB</p><p style="color:#6b6a67;font-size:13px">Deze herinnering is voor ${escapeHtml(participant.schoolName)}.</p>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend gaf status ${response.status}: ${detail.slice(0, 300)}`);
  }
}

async function activeChallenge() {
  const existing = await db.select().from(challengeSettingsTable).where(eq(challengeSettingsTable.isActive, true)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db.insert(challengeSettingsTable).values({
    name: "ByB Ledenchallenge",
    startDate: DEFAULT_START,
    endDate: DEFAULT_END,
    isActive: true,
  }).returning();
  return created;
}

function challengeView(challenge: ChallengeSetting) {
  const totalDays = daysInclusive(challenge.startDate, challenge.endDate);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = dateAtUtc(challenge.startDate);
  const end = dateAtUtc(challenge.endDate);
  const currentDay = today < start ? 0 : Math.min(totalDays, Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1));
  const daysRemaining = today > end ? 0 : Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000));
  const totalWeeks = Math.ceil(totalDays / 7);
  return {
    id: challenge.id,
    name: challenge.name,
    startDate: challenge.startDate,
    endDate: challenge.endDate,
    totalDays,
    daysRemaining,
    currentDay,
    currentWeek: currentDay ? Math.ceil(currentDay / 7) : 0,
    totalWeeks,
    isActive: challenge.isActive,
  };
}

function weeksView(challenge: ChallengeSetting) {
  const total = daysInclusive(challenge.startDate, challenge.endDate);
  const totalWeeks = Math.ceil(total / 7);
  const today = new Date();
  const todayValue = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).getTime();
  return Array.from({ length: totalWeeks }, (_, index) => {
    const weekNumber = index + 1;
    const startDate = addDays(challenge.startDate, index * 7);
    const endDate = addDays(startDate, Math.min(6, total - index * 7 - 1));
    const isPast = dateAtUtc(endDate).getTime() < todayValue;
    const isCurrent = dateAtUtc(startDate).getTime() <= todayValue && dateAtUtc(endDate).getTime() >= todayValue;
    return {
      weekNumber,
      label: `Week ${weekNumber}`,
      startDate,
      endDate,
      isCurrent,
      isPast,
    };
  });
}

async function entriesFor(participantId: number) {
  return db.select().from(weeklyEntriesTable)
    .where(eq(weeklyEntriesTable.participantId, participantId))
    .orderBy(asc(weeklyEntriesTable.weekNumber));
}

async function participantView(participant: DbParticipant) {
  const entries = await entriesFor(participant.id);
  const entryTotals = totals(entries);
  return {
    id: participant.id,
    schoolName: participant.schoolName,
    contactName: participant.contactName,
    email: participant.email,
    startingMembers: participant.startingMembers,
    targetNewMembers: participant.targetNewMembers,
    country: participant.country,
    revision: participant.revision,
    updatedAt: participant.updatedAt,
    totals: entryTotals,
    scores: scores(participant, entryTotals),
  };
}

export async function currentParticipant(req: AuthedRequest) {
  const auth = getAuth(req);
  const userId = auth.userId;
  if (!userId) return null;
  const [existing] = await db.select().from(participantsTable)
    .where(eq(participantsTable.clerkUserId, userId))
    .limit(1);
  if (existing) return existing;
  if (await requestIsAdmin(req)) return null;
  return resolveParticipantAccess(userId, {
    getUser: (id) => clerkClient.users.getUser(id),
    async findByClerkUserId(id) {
      const [participant] = await db.select().from(participantsTable)
        .where(eq(participantsTable.clerkUserId, id))
        .limit(1);
      return participant ?? null;
    },
    async claimUnclaimedByEmail(email, id) {
      const [participant] = await db.update(participantsTable)
        .set({ clerkUserId: id })
        .where(and(
          eq(participantsTable.email, canonicalParticipantEmail(email)),
          isNull(participantsTable.clerkUserId),
        ))
        .returning();
      return participant ?? null;
    },
  });
}

export function requireSignedIn(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Je moet ingelogd zijn." });
    return;
  }
  next();
}

export async function requestIsAdmin(req: AuthedRequest) {
  const auth = getAuth(req);
  const claims = (auth.sessionClaims ?? {}) as Record<string, any>;
  const metadata = (claims.metadata ?? claims.publicMetadata ?? claims.public_metadata ?? {}) as Record<string, unknown>;
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  const configuredAdminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (!auth.userId) return false;

  let isAdmin = metadata.role === "admin" || Boolean(configuredAdminEmail && email === configuredAdminEmail);
  if (!isAdmin) {
    try {
      const user = await clerkClient.users.getUser(auth.userId);
      const hasConfiguredEmail = configuredAdminEmail
        ? user.emailAddresses.some((address) => address.emailAddress.toLowerCase() === configuredAdminEmail)
        : false;
      isAdmin = user.publicMetadata.role === "admin" || hasConfiguredEmail;
    } catch {
      isAdmin = false;
    }
  }
  return isAdmin;
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!await requestIsAdmin(req)) {
    res.status(403).json({ error: "Alleen admins hebben toegang tot dit onderdeel." });
    return;
  }
  next();
}

export type AdminParticipantsRouterOptions = {
  database?: typeof db;
  signedInMiddleware?: typeof requireSignedIn;
  adminMiddleware?: typeof requireAdmin;
  viewParticipant?: typeof participantView;
  getChallenge?: typeof activeChallenge;
  getEntries?: typeof entriesFor;
  getMessages?: (participantId: number) => Promise<CoachMessage[]>;
  revokeIdentity?: typeof revokeParticipantIdentity;
  queueIdentityRelease?: typeof queueParticipantIdentityRelease;
  retryIdentityReleases?: typeof retryParticipantIdentityReleases;
  getRecoveryStatus?: typeof getOverdueParticipantIdentityReleases;
  sendReminder?: typeof sendReminderEmail;
  deleteUser?: (userId: string) => Promise<unknown>;
  getPendingInvitations?: (email: string) => Promise<Array<{ id: string; emailAddress: string }>>;
  revokeInvitation?: (invitationId: string) => Promise<unknown>;
  getAdminUserId?: (req: AuthedRequest) => string;
  getAdminDisplayName?: (req: AuthedRequest) => string;
};

export function createAdminParticipantsRouter({
  database = db,
  signedInMiddleware = requireSignedIn,
  adminMiddleware = requireAdmin,
  viewParticipant = participantView,
  getChallenge = activeChallenge,
  getEntries = entriesFor,
  getMessages = (participantId) => db.select().from(coachMessagesTable)
    .where(eq(coachMessagesTable.participantId, participantId))
    .orderBy(asc(coachMessagesTable.createdAt)),
  revokeIdentity = revokeParticipantIdentity,
  queueIdentityRelease = queueParticipantIdentityRelease,
  retryIdentityReleases = retryParticipantIdentityReleases,
  getRecoveryStatus = getOverdueParticipantIdentityReleases,
  sendReminder = sendReminderEmail,
  deleteUser = (userId) => clerkClient.users.deleteUser(userId),
  getPendingInvitations = async (email) => {
    const invitations = await clerkClient.invitations.getInvitationList({
      query: email,
      status: "pending",
    });
    return invitations.data;
  },
  revokeInvitation = (invitationId) => clerkClient.invitations.revokeInvitation(invitationId),
  getAdminUserId = (req) => getAuth(req).userId ?? "unknown",
  getAdminDisplayName = adminDisplayName,
}: AdminParticipantsRouterOptions = {}) {
  const adminParticipantsRouter: IRouter = Router();

  adminParticipantsRouter.get("/", signedInMiddleware, adminMiddleware, async (_req, res) => {
    const participants = await database.select().from(participantsTable).orderBy(desc(participantsTable.createdAt));
    res.json(GetParticipantsResponse.parse(await Promise.all(participants.map(viewParticipant))));
  });

  adminParticipantsRouter.get("/recovery-status", signedInMiddleware, adminMiddleware, async (_req, res) => {
    res.json(GetParticipantRecoveryStatusResponse.parse(await getRecoveryStatus(database)));
  });

  async function validatedParticipantImport(file: Express.Multer.File): Promise<ParticipantImportPreview> {
    const preview = await parseParticipantImport(file.buffer);
    const canonicalEmails = preview.rows
      .map(row => canonicalParticipantEmail(row.email))
      .filter(email => email !== "");
    const existing = canonicalEmails.length === 0
      ? []
      : await database.select({ email: participantsTable.email })
        .from(participantsTable)
        .where(inArray(participantsTable.email, canonicalEmails));
    const existingEmails = new Set(existing.map(row => row.email));
    const existingEmailIssues = preview.rows.flatMap((row) => {
      const email = canonicalParticipantEmail(row.email);
      if (!existingEmails.has(email)) return [];
      return [{
        row: row.row,
        column: "E-mailadres",
        participant: row.schoolName,
        message: `Rij ${row.row} (${row.schoolName}): er bestaat al een deelnemer met dit e-mailadres.`,
      }];
    });
    const issues = [...preview.issues, ...existingEmailIssues];
    return { ...preview, valid: issues.length === 0, issues };
  }

  adminParticipantsRouter.post(
    "/import/preview",
    signedInMiddleware,
    adminMiddleware,
    participantImportUpload.single("file"),
    async (req, res): Promise<void> => {
      if (!req.file) {
        res.status(422).json({ valid: false, rows: [], issues: [{ row: 1, column: "Bestand", participant: "bestand", message: "Kies een Excelbestand." }] });
        return;
      }
      const preview = await validatedParticipantImport(req.file);
      res.status(preview.valid ? 200 : 422).json(PreviewParticipantImportResponse.parse(preview));
    },
  );

  adminParticipantsRouter.post(
    "/import/confirm",
    signedInMiddleware,
    adminMiddleware,
    participantImportUpload.single("file"),
    async (req, res): Promise<void> => {
      if (!req.file) {
        res.status(422).json({ valid: false, rows: [], issues: [{ row: 1, column: "Bestand", participant: "bestand", message: "Kies een Excelbestand." }] });
        return;
      }
      const preview = await validatedParticipantImport(req.file);
      if (!preview.valid) {
        res.status(422).json(PreviewParticipantImportResponse.parse(preview));
        return;
      }

      try {
        const importedCount = await database.transaction(async (tx) => {
          await tx.insert(participantsTable).values(preview.rows.map(row => ({
            schoolName: row.schoolName,
            contactName: row.contactName,
            email: canonicalParticipantEmail(row.email),
            country: row.country,
          })));
          return preview.rows.length;
        });
        res.status(201).json(ConfirmParticipantImportResponse.parse({ importedCount }));
      } catch (error) {
        if (isParticipantEmailConflict(error)) {
          req.log.info("Participant import conflicted with an existing email");
          res.status(409).json({ error: "Een e-mailadres uit het bestand bestaat intussen al. Controleer het bestand opnieuw." });
          return;
        }
        throw error;
      }
    },
  );

  adminParticipantsRouter.get("/:id/view", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const params = parseAdminInput(GetAdminParticipantViewParams.safeParse(req.params), res);
    if (!params) return;
    const { id } = params;
    const [participant] = await database.select().from(participantsTable)
      .where(eq(participantsTable.id, id))
      .limit(1);
    if (!participant) {
      res.status(404).json({ error: "Deelnemer niet gevonden." });
      return;
    }
    const [challenge, entries, messages] = await Promise.all([
      getChallenge(),
      getEntries(participant.id),
      getMessages(participant.id),
    ]);
    const entryTotals = totals(entries);
    res.json(GetAdminParticipantViewResponse.parse({
      participant: await viewParticipant(participant),
      challenge: challengeView(challenge),
      totals: entryTotals,
      scores: scores(participant, entryTotals),
      entries: entries.map((entry) => ({
        id: entry.id,
        weekNumber: entry.weekNumber,
        signups: entry.signups,
        attendance: entry.attendance,
        enrolled: entry.enrolled,
        updatedAt: entry.updatedAt,
      })),
      weeks: weeksView(challenge),
      messages,
    }));
  });

  adminParticipantsRouter.post("/", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const parsedInput = CreateParticipantBody.safeParse(req.body);
    if (!parsedInput.success) {
      res.status(400).json({ error: parsedInput.error.message });
      return;
    }
    const input = parsedInput.data;
    const email = canonicalParticipantEmail(input.email);
    if (!email) {
      res.status(400).json({ error: "Vul een e-mailadres in." });
      return;
    }
    if (!isUsableParticipantEmail(email)) {
      res.status(400).json({ error: "Vul een geldig e-mailadres in." });
      return;
    }
    let created: DbParticipant;
    try {
      [created] = await database.insert(participantsTable).values({
        schoolName: input.schoolName,
        contactName: input.contactName,
        email,
        country: input.country,
      }).returning();
    } catch (error) {
      if (isParticipantEmailConflict(error)) {
        req.log.info({ email }, "Participant email already exists");
        res.status(409).json({ error: "Er bestaat al een deelnemer met dit e-mailadres." });
        return;
      }
      throw error;
    }
    res.status(201).json(await viewParticipant(created));
  });

  adminParticipantsRouter.patch("/:id", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const params = parseAdminInput(UpdateParticipantParams.safeParse({ id: Number(req.params.id) }), res);
    if (!params) return;
    const { id } = params;
    const parsedInput = UpdateParticipantBody.safeParse(req.body);
    if (!parsedInput.success) {
      res.status(400).json({ error: parsedInput.error.message });
      return;
    }
    const input = parsedInput.data;
    if (!Number.isInteger(input.revision)) {
      res.status(400).json({ error: "Ongeldige deelnemerversie." });
      return;
    }
    const email = input.email === undefined ? undefined : canonicalParticipantEmail(input.email);
    const expectedRevision = input.revision;
    if (email === "") {
      res.status(400).json({ error: "Vul een e-mailadres in." });
      return;
    }
    if (email !== undefined && !isUsableParticipantEmail(email)) {
      res.status(400).json({ error: "Vul een geldig e-mailadres in." });
      return;
    }
    let updated: DbParticipant | undefined;
    try {
      [updated] = await database.update(participantsTable)
        .set({
          schoolName: input.schoolName,
          contactName: input.contactName,
          startingMembers: input.startingMembers,
          targetNewMembers: input.targetNewMembers,
          country: input.country,
          revision: sql`${participantsTable.revision} + 1`,
          ...(email !== undefined ? { email } : {}),
        })
        .where(and(
          eq(participantsTable.id, id),
          eq(participantsTable.revision, expectedRevision),
        ))
        .returning();
    } catch (error) {
      if (isParticipantEmailConflict(error)) {
        req.log.info({ participantId: id }, "Participant email already exists");
        res.status(409).json({ error: "Er bestaat al een deelnemer met dit e-mailadres." });
        return;
      }
      throw error;
    }
    if (!updated) {
      const [current] = await database.select().from(participantsTable)
        .where(eq(participantsTable.id, id))
        .limit(1);
      if (!current) {
        res.status(404).json({ error: "Deelnemer niet gevonden." });
        return;
      }
      res.status(409).json({
        error: "Deze deelnemer is intussen gewijzigd. De actuele waarden zijn opnieuw geladen.",
        currentParticipant: await viewParticipant(current),
      });
      return;
    }
    res.json(await viewParticipant(updated));
  });

  adminParticipantsRouter.patch("/:id/profile", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const params = parseAdminInput(UpdateParticipantParams.safeParse({ id: Number(req.params.id) }), res);
    if (!params) return;
    const { id } = params;
    const parsedInput = UpdateProfileBody.safeParse(req.body);
    if (!parsedInput.success) {
      res.status(400).json({ error: parsedInput.error.message });
      return;
    }
    const input = parsedInput.data;
    if (!Number.isInteger(input.revision)) {
      res.status(400).json({ error: "Ongeldige deelnemerversie." });
      return;
    }
    if (input.startingMembers === undefined && input.targetNewMembers === undefined) {
      res.status(400).json({ error: "Vul minstens één profielwaarde in." });
      return;
    }
    if (input.targetNewMembers !== undefined && !Number.isInteger(input.targetNewMembers)) {
      res.status(400).json({ error: "Je groeidoel moet een heel aantal leden zijn." });
      return;
    }
    const [updated] = await database.update(participantsTable)
      .set({
        ...(input.startingMembers !== undefined ? { startingMembers: input.startingMembers } : {}),
        ...(input.targetNewMembers !== undefined ? { targetNewMembers: input.targetNewMembers } : {}),
        revision: sql`${participantsTable.revision} + 1`,
      })
      .where(and(
        eq(participantsTable.id, id),
        eq(participantsTable.revision, input.revision),
      ))
      .returning();
    if (!updated) {
      const [current] = await database.select().from(participantsTable)
        .where(eq(participantsTable.id, id))
        .limit(1);
      if (!current) {
        res.status(404).json({ error: "Deelnemer niet gevonden." });
        return;
      }
      res.status(409).json({
        error: "Deze deelnemer is intussen gewijzigd. De actuele waarden zijn opnieuw geladen.",
        currentParticipant: await viewParticipant(current),
      });
      return;
    }
    res.json(await viewParticipant(updated));
  });

  adminParticipantsRouter.post("/:id/weekly-entries", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const params = parseAdminInput(UpdateParticipantParams.safeParse({ id: Number(req.params.id) }), res);
    if (!params) return;
    const { id } = params;
    const parsedInput = UpsertWeeklyEntryBody.safeParse(req.body);
    if (!parsedInput.success) {
      res.status(400).json({ error: parsedInput.error.message });
      return;
    }
    const input = parsedInput.data;
    const challenge = await getChallenge();
    if (input.weekNumber > Math.ceil(daysInclusive(challenge.startDate, challenge.endDate) / 7)) {
      res.status(400).json({ error: "Deze week valt buiten de challengeperiode." });
      return;
    }
    const saved = await database.transaction(async (tx) => {
      const [participant] = await tx.select({ id: participantsTable.id })
        .from(participantsTable)
        .where(eq(participantsTable.id, id))
        .limit(1)
        .for("update");
      if (!participant) return undefined;
      const [existing] = await tx.select().from(weeklyEntriesTable)
        .where(and(
          eq(weeklyEntriesTable.participantId, id),
          eq(weeklyEntriesTable.weekNumber, input.weekNumber),
        ))
        .limit(1);
      if (existing) {
        const [updated] = await tx.update(weeklyEntriesTable)
          .set({
            signups: input.signups,
            attendance: input.attendance,
            enrolled: input.enrolled,
            updatedAt: new Date(),
          })
          .where(and(
            eq(weeklyEntriesTable.id, existing.id),
            eq(weeklyEntriesTable.participantId, id),
          ))
          .returning();
        return updated;
      }
      const [created] = await tx.insert(weeklyEntriesTable).values({
        participantId: id,
        weekNumber: input.weekNumber,
        signups: input.signups,
        attendance: input.attendance,
        enrolled: input.enrolled,
      }).returning();
      return created;
    });
    if (!saved) {
      res.status(404).json({ error: "Deelnemer niet gevonden." });
      return;
    }
    res.json(GetWeeklyEntriesResponse.parse([saved])[0]);
  });

  adminParticipantsRouter.delete("/:id", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const params = parseAdminInput(DeleteParticipantParams.safeParse({ id: Number(req.params.id) }), res);
    if (!params) return;
    const { id } = params;
    let deletedClerkUserId: string | null = null;
    let outcome: { status: "missing" } | { status: "identity-error"; hasLoginAccount: boolean } | { status: "deleted" };
    try {
      outcome = await database.transaction(async (tx) => {
        const [participant] = await tx.select().from(participantsTable)
          .where(eq(participantsTable.id, id))
          .limit(1)
          .for("update");
        if (!participant) return { status: "missing" as const };

        try {
          if (participant.clerkUserId) {
            await queueIdentityRelease(database, participant.id, participant.clerkUserId);
          }
          const revocation = await revokeIdentity(participant, {
            deleteUser,
            getPendingInvitations,
            revokeInvitation,
          });
          if (revocation === "login-account") {
            deletedClerkUserId = participant.clerkUserId;
          }
        } catch (error) {
          req.log.error({ err: error, participantId: id }, "Could not revoke participant identity");
          return {
            status: "identity-error" as const,
            hasLoginAccount: Boolean(participant.clerkUserId),
          };
        }

        await tx.delete(participantsTable).where(eq(participantsTable.id, id));
        return { status: "deleted" as const };
      });
    } catch (error) {
      if (deletedClerkUserId) {
        try {
          await retryIdentityReleases(database, deleteUser);
          req.log.error(
            { err: error, participantId: id },
            "Participant deletion failed after Clerk deletion; released stale identity link",
          );
        } catch (recoveryError) {
          req.log.error(
            { err: recoveryError, participantId: id, originalError: error },
            "Participant deletion compensation failed; durable retry remains queued",
          );
        }
      }
      throw error;
    }

    if (outcome.status === "missing") {
      res.status(404).json({ error: "Deelnemer niet gevonden." });
      return;
    }
    if (outcome.status === "identity-error") {
      res.status(502).json({
        error: outcome.hasLoginAccount
          ? "Het loginaccount kon niet worden verwijderd. De deelnemer is behouden."
          : "De openstaande uitnodiging kon niet worden ingetrokken. Probeer het opnieuw.",
      });
      return;
    }
    res.status(204).send();
  });

  adminParticipantsRouter.get("/:id/messages", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const params = parseAdminInput(GetAdminParticipantMessagesParams.safeParse({ id: Number(req.params.id) }), res);
    if (!params) return;
    const { id } = params;
    const messages = await database.select().from(coachMessagesTable)
      .where(eq(coachMessagesTable.participantId, id))
      .orderBy(asc(coachMessagesTable.createdAt));
    res.json(GetAdminParticipantMessagesResponse.parse(messages.map(messageView)));
  });

  adminParticipantsRouter.post("/:id/messages", signedInMiddleware, adminMiddleware, async (req: AuthedRequest, res): Promise<void> => {
    const params = parseAdminInput(CreateParticipantMessageParams.safeParse({ id: Number(req.params.id) }), res);
    if (!params) return;
    const { id } = params;
    const parsedInput = CreateParticipantMessageBody.safeParse(req.body);
    if (!parsedInput.success) {
      res.status(400).json({ error: parsedInput.error.message });
      return;
    }
    const input = parsedInput.data;
    const body = input.body.trim();
    if (!body) {
      res.status(400).json({ error: "Schrijf eerst een bericht." });
      return;
    }

    const created = await database.transaction(async (tx) => {
      const [participant] = await tx.select({ id: participantsTable.id }).from(participantsTable)
        .where(eq(participantsTable.id, id))
        .limit(1)
        .for("update");
      if (!participant) return undefined;
      const [message] = await tx.insert(coachMessagesTable).values({
        participantId: id,
        adminUserId: getAdminUserId(req),
        authorName: getAdminDisplayName(req),
        body,
      }).returning();
      return message;
    });
    if (!created) {
      res.status(404).json({ error: "Deelnemer niet gevonden." });
      return;
    }
    res.status(201).json(CreateParticipantMessageResponse.parse(messageView(created)));
  });

  adminParticipantsRouter.post("/:id/reminder", signedInMiddleware, adminMiddleware, async (req, res): Promise<void> => {
    const params = parseAdminInput(SendParticipantReminderParams.safeParse({ id: Number(req.params.id) }), res);
    if (!params) return;
    const { id } = params;
    try {
      const participant = await database.transaction(async (tx) => {
        const [lockedParticipant] = await tx.select().from(participantsTable)
          .where(eq(participantsTable.id, id))
          .limit(1)
          .for("update");
        if (!lockedParticipant) return undefined;
        await sendReminder(lockedParticipant);
        return lockedParticipant;
      });
      if (!participant) {
        res.status(404).json({ error: "Deelnemer niet gevonden." });
        return;
      }
      res.json(SendParticipantReminderResponse.parse({
        success: true,
        message: `Herinnering verstuurd naar ${participant.email}.`,
      }));
    } catch (error) {
      req.log.error({ err: error, participantId: id }, "Could not send participant reminder");
      res.status(502).json({ error: "De herinnering kon niet worden verstuurd. Controleer de Resend-configuratie." });
    }
  });

  adminParticipantsRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const message = error instanceof Error ? error.message : "";
    const isMultipartError = error instanceof multer.MulterError
      || message.startsWith("Multipart:")
      || message === "Unexpected end of form";
    if (isMultipartError) {
      res.status(422).json({
        valid: false,
        rows: [],
        issues: [{
          row: 1,
          column: "Bestand",
          participant: "bestand",
          message: error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
            ? "Het bestand is te groot (maximaal 5 MB)."
            : "Het uploadbestand kan niet worden verwerkt.",
        }],
      });
      return;
    }
    next(error);
  });
  return adminParticipantsRouter;
}

router.get("/challenge", async (_req, res) => {
  const challenge = await activeChallenge();
  res.json(GetChallengeResponse.parse(challengeView(challenge)));
});

router.get("/weeks", async (_req, res) => {
  const challenge = await activeChallenge();
  res.json(GetWeeksResponse.parse(weeksView(challenge)));
});

router.get("/dashboard", requireSignedIn, async (req: AuthedRequest, res) => {
  const participant = await currentParticipant(req);
  if (!participant) {
    res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
    return;
  }
  const challenge = await activeChallenge();
  const entries = await entriesFor(participant.id);
  const entryTotals = totals(entries);
  res.json(GetDashboardResponse.parse({
    participant: await participantView(participant),
    challenge: challengeView(challenge),
    totals: entryTotals,
    scores: scores(participant, entryTotals),
    entries: entries.map((entry) => ({
      id: entry.id,
      weekNumber: entry.weekNumber,
      signups: entry.signups,
      attendance: entry.attendance,
      enrolled: entry.enrolled,
      updatedAt: entry.updatedAt,
    })),
  }));
});

router.get("/weekly-entries", requireSignedIn, async (req: AuthedRequest, res) => {
  const participant = await currentParticipant(req);
  const challenge = await activeChallenge();
  const entries = participant ? await entriesFor(participant.id) : [];
  res.json(GetWeeklyEntriesResponse.parse(entries.map((entry) => ({
    id: entry.id,
    weekNumber: entry.weekNumber,
    signups: entry.signups,
    attendance: entry.attendance,
    enrolled: entry.enrolled,
    updatedAt: entry.updatedAt,
  }))));
});

router.post("/weekly-entries", requireSignedIn, async (req: AuthedRequest, res) => {
  const input = UpsertWeeklyEntryBody.parse(req.body);
  const participant = await currentParticipant(req);
  const challenge = await activeChallenge();
  if (!participant) {
    res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
    return;
  }
  if (input.weekNumber > Math.ceil(daysInclusive(challenge.startDate, challenge.endDate) / 7)) {
    res.status(400).json({ error: "Deze week valt buiten de challengeperiode." });
    return;
  }
  const existing = await db.select().from(weeklyEntriesTable)
    .where(and(eq(weeklyEntriesTable.participantId, participant.id), eq(weeklyEntriesTable.weekNumber, input.weekNumber)))
    .limit(1);
  const [saved] = existing[0]
    ? await db.update(weeklyEntriesTable).set({
      signups: input.signups,
      attendance: input.attendance,
      enrolled: input.enrolled,
      updatedAt: new Date(),
    }).where(eq(weeklyEntriesTable.id, existing[0].id)).returning()
    : await db.insert(weeklyEntriesTable).values({
      participantId: participant.id,
      weekNumber: input.weekNumber,
      signups: input.signups,
      attendance: input.attendance,
      enrolled: input.enrolled,
    }).returning();
  res.json(GetWeeklyEntriesResponse.parse([saved])[0]);
});

router.patch("/profile", requireSignedIn, async (req: AuthedRequest, res): Promise<void> => {
  const input = UpdateProfileBody.parse(req.body);
  if (!Number.isInteger(input.revision)) {
    res.status(400).json({ error: "Ongeldige deelnemerversie." });
    return;
  }
  if (input.startingMembers === undefined && input.targetNewMembers === undefined) {
    res.status(400).json({ error: "Vul minstens één profielwaarde in." });
    return;
  }
  if (input.targetNewMembers !== undefined && !Number.isInteger(input.targetNewMembers)) {
    res.status(400).json({ error: "Je groeidoel moet een heel aantal leden zijn." });
    return;
  }
  const participant = await currentParticipant(req);
  if (!participant) {
    res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
    return;
  }
  const [updated] = await db.update(participantsTable)
    .set({
      ...(input.startingMembers !== undefined ? { startingMembers: input.startingMembers } : {}),
      ...(input.targetNewMembers !== undefined ? { targetNewMembers: input.targetNewMembers } : {}),
      revision: sql`${participantsTable.revision} + 1`,
    })
    .where(and(
      eq(participantsTable.id, participant.id),
      eq(participantsTable.revision, input.revision),
    ))
    .returning();
  if (!updated) {
    const current = await currentParticipant(req);
    res.status(409).json({
      error: "Je profiel is intussen gewijzigd. De actuele waarden zijn opnieuw geladen.",
      currentParticipant: current ? await participantView(current) : null,
    });
    return;
  }
  res.json(UpdateProfileResponse.parse(await participantView(updated)));
});

export type ProfilePreferencesRouterOptions = {
  database?: typeof db;
  signedInMiddleware?: typeof requireSignedIn;
  getParticipant?: typeof currentParticipant;
};

export function createProfilePreferencesRouter({
  database = db,
  signedInMiddleware = requireSignedIn,
  getParticipant = currentParticipant,
}: ProfilePreferencesRouterOptions = {}) {
  const profilePreferencesRouter: IRouter = Router();

  profilePreferencesRouter.get("/", signedInMiddleware, async (req: AuthedRequest, res): Promise<void> => {
    const participant = await getParticipant(req);
    if (!participant) {
      res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
      return;
    }
    res.json(GetProfilePreferencesResponse.parse({
      masterDataRoute: participant.masterDataRoute,
    }));
  });

  profilePreferencesRouter.patch("/", signedInMiddleware, async (req: AuthedRequest, res): Promise<void> => {
    const parsedInput = UpdateProfilePreferencesBody.safeParse(req.body);
    if (!parsedInput.success) {
      res.status(400).json({ error: parsedInput.error.message });
      return;
    }
    const participant = await getParticipant(req);
    if (!participant) {
      res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
      return;
    }
    const [updated] = await database.update(participantsTable)
      .set({ masterDataRoute: parsedInput.data.masterDataRoute })
      .where(eq(participantsTable.id, participant.id))
      .returning({ masterDataRoute: participantsTable.masterDataRoute });
    if (!updated) {
      res.status(404).json({ error: "Geen deelnemersprofiel gevonden." });
      return;
    }
    res.json(UpdateProfilePreferencesResponse.parse(updated));
  });

  return profilePreferencesRouter;
}

router.use("/profile/preferences", createProfilePreferencesRouter());

router.get("/messages", requireSignedIn, async (req: AuthedRequest, res): Promise<void> => {
  const participant = await currentParticipant(req);
  if (!participant) {
    res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
    return;
  }
  const messages = await db.select().from(coachMessagesTable)
    .where(eq(coachMessagesTable.participantId, participant.id))
    .orderBy(asc(coachMessagesTable.createdAt));
  res.json(GetMessagesResponse.parse(messages.map(messageView)));
});

router.get("/leaderboard", requireSignedIn, async (req: AuthedRequest, res) => {
  const current = await currentParticipant(req);
  const participants = await db.select().from(participantsTable).orderBy(asc(participantsTable.schoolName));
  const ranked = await Promise.all(participants.map(async (participant) => {
    const entryTotals = totals(await entriesFor(participant.id));
    return {
      schoolName: participant.schoolName,
      contactName: participant.contactName,
      country: participant.country,
      growthPercent: scores(participant, entryTotals).growthPercent,
      conversionPercent: scores(participant, entryTotals).conversionPercent,
      enrolled: entryTotals.enrolled,
      isCurrentUser: current?.id === participant.id,
    };
  }));
  ranked.sort((a, b) => b.growthPercent - a.growthPercent || b.conversionPercent - a.conversionPercent || a.schoolName.localeCompare(b.schoolName));
  res.json(GetLeaderboardResponse.parse(ranked.map((entry, index) => ({ ...entry, rank: index + 1 }))));
});

router.use("/admin/participants", createAdminParticipantsRouter());

router.patch("/admin/challenge", requireSignedIn, requireAdmin, async (req, res) => {
  const parsedInput = UpdateChallengeBody.safeParse(req.body);
  if (!parsedInput.success) {
    res.status(400).json({ error: parsedInput.error.message });
    return;
  }
  const input = parsedInput.data;
  if (dateAtUtc(input.endDate) < dateAtUtc(input.startDate)) {
    res.status(400).json({ error: "De einddatum moet na de startdatum liggen." });
    return;
  }
  const challenge = await activeChallenge();
  const [updated] = await db.update(challengeSettingsTable).set({
    startDate: formatDate(input.startDate),
    endDate: formatDate(input.endDate),
    updatedAt: new Date(),
  }).where(eq(challengeSettingsTable.id, challenge.id)).returning();
  res.json(GetChallengeResponse.parse(challengeView(updated)));
});

router.get("/admin/weekly-entries", requireSignedIn, requireAdmin, async (_req, res) => {
  const entries = await db
    .select({
      id: weeklyEntriesTable.id,
      participantId: weeklyEntriesTable.participantId,
      schoolName: participantsTable.schoolName,
      weekNumber: weeklyEntriesTable.weekNumber,
      signups: weeklyEntriesTable.signups,
      attendance: weeklyEntriesTable.attendance,
      enrolled: weeklyEntriesTable.enrolled,
      updatedAt: weeklyEntriesTable.updatedAt,
    })
    .from(weeklyEntriesTable)
    .innerJoin(participantsTable, eq(weeklyEntriesTable.participantId, participantsTable.id))
    .orderBy(asc(participantsTable.schoolName), asc(weeklyEntriesTable.weekNumber));
  res.json(GetAdminWeeklyEntriesResponse.parse(entries));
});

export type AdminWeeklyEntriesRouterOptions = {
  database?: typeof db;
  signedInMiddleware?: typeof requireSignedIn;
  adminMiddleware?: typeof requireAdmin;
};

export function createAdminWeeklyEntriesRouter(options: AdminWeeklyEntriesRouterOptions = {}) {
  const database = options.database ?? db;
  const signedInMiddleware = options.signedInMiddleware ?? requireSignedIn;
  const adminMiddleware = options.adminMiddleware ?? requireAdmin;
  const adminWeeklyEntriesRouter = Router();

  adminWeeklyEntriesRouter.patch("/", signedInMiddleware, adminMiddleware, async (req, res) => {
    const query = parseAdminInput(UpdateAdminWeeklyEntryQueryParams.safeParse(req.query), res);
    if (!query) return;
    const { id, participantId } = query;
    const parsedInput = UpdateAdminWeeklyEntryBody.safeParse(req.body);
    if (!parsedInput.success) {
      res.status(400).json({ error: parsedInput.error.message });
      return;
    }
    const input = parsedInput.data;
    const [updated] = await database
      .update(weeklyEntriesTable)
      .set({ ...input, updatedAt: new Date() })
      .where(and(
        eq(weeklyEntriesTable.id, id),
        eq(weeklyEntriesTable.participantId, participantId),
      ))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Weekinvoer niet gevonden." });
      return;
    }
    const [participant] = await database
      .select()
      .from(participantsTable)
      .where(eq(participantsTable.id, updated.participantId))
      .limit(1);
    res.json(UpdateAdminWeeklyEntryResponse.parse({
      id: updated.id,
      participantId: updated.participantId,
      schoolName: participant.schoolName,
      weekNumber: updated.weekNumber,
      signups: updated.signups,
      attendance: updated.attendance,
      enrolled: updated.enrolled,
      updatedAt: updated.updatedAt,
    }));
  });

  return adminWeeklyEntriesRouter;
}

router.use("/admin/weekly-entries", createAdminWeeklyEntriesRouter());

export default router;