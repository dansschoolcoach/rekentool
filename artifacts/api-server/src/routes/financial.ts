import { getAuth } from "@clerk/express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import multer from "multer";
import {
  db as defaultDb, financialActivitiesTable, financialClosuresTable, financialFixedCostsTable,
  financialLessonMonthInputsTable, financialLessonsTable, financialLocationsTable,
  financialFileSubmissionsTable, financialMonthsTable, financialSeasonsTable, financialSubscriptionsTable, financialTaxYearsTable, financialTeachersTable,
  participantsTable,
} from "@workspace/db";
import {
  CreateFinancialFileSubmissionBody,
  CreateFinancialSeasonBody,
  RequestFinancialFileSubmissionUploadBody,
  UpdateAdminFinancialFileSubmissionBody,
  UpdateFinancialSeasonBody,
  UpdateFinancialTaxYearBody,
  UpsertFinancialMonthBody,
} from "@workspace/api-zod";
import { currentParticipant, requireAdmin, requireSignedIn } from "./challenge.ts";
import { calculateMonth, scheduledLessonCount, selectSnapshotCalculationContext } from "../services/financialCalculations.ts";
import { calculateFinancialCostTrends } from "../services/financialCostTrends.ts";
import { buildLessonSeasonForecast, lessonProfitabilityForMonth, monthlyRentAllocation } from "../services/financialLessonForecast.ts";
import { buildFinancialTaxYearSummary } from "../services/financialTaxYear.ts";
import {
  buildFinancialMonthSnapshot,
  lockFinancialSeasonMasterData,
  normalizeFinancialMonthSnapshot,
  UnsupportedFinancialSnapshotFormatError,
  UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT_ERROR_CODE,
} from "../services/financialSnapshot.ts";
import {
  buildScheduleImportTemplate,
  formatImportIssues,
  parseFinancialImport,
  parseScheduleImport,
  SCHEDULE_TEMPLATE_VERSION,
  WEEKDAY_LABELS,
  type ScheduleImportContext,
  type ScheduleImportRow,
  type SubscriptionImportRow,
  type TeacherImportRow,
} from "../services/financialImport.ts";
import {
  financialSubmissionStorage,
  XLSX_CONTENT_TYPE,
  type FinancialSubmissionStorage,
} from "../services/financialFileStorage.ts";

type AuthedRequest = Request & { userId?: string };
const toCents = (amount: number) => Math.round(amount * 100);
const euros = (amount: number) => amount / 100;
const dateValue = (value: string | Date) => value instanceof Date ? value.toISOString().slice(0, 10) : value;
const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value);
const financialImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_FINANCIAL_SUBMISSION_BYTES = 10 * 1024 * 1024;
const VALID_FINANCIAL_SUBMISSION_TYPES = new Set(["teachers", "subscriptions"]);
const VALID_FINANCIAL_SUBMISSION_STATUSES = new Set(["open", "in_progress", "processed"]);
export const INVALID_FINANCIAL_HISTORY_ERROR_CODE = "INVALID_FINANCIAL_HISTORY";
class FinancialMonthConflictError extends Error {}
class FinancialSeasonConflictError extends Error {}
class InvalidFinancialMonthError extends Error {}
class FinancialTaxYearConflictError extends Error {}
class InvalidFinancialScheduleImportError extends Error {}
const previousCalendarMonth = (month: string) => {
  const date = new Date(`${month}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
};
const lessonOverlapsMonth = (lesson: { activeFrom: string; activeUntil: string }, month: string) => {
  const start = new Date(`${month}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return lesson.activeFrom <= monthEnd && lesson.activeUntil >= month;
};

type FinancialRouterDependencies = {
  database?: typeof defaultDb;
  participantForRequest?: typeof currentParticipant;
  signedInMiddleware?: (req: AuthedRequest, res: Response, next: NextFunction) => unknown;
  adminMiddleware?: (req: AuthedRequest, res: Response, next: NextFunction) => unknown;
  adminDisplayNameForRequest?: (req: AuthedRequest) => string;
  beforeFinancialMonthResponse?: (updatedAt: string) => Promise<void>;
  beforeFinancialSeasonMasterSave?: () => Promise<void>;
  afterFinancialTeacherImportMutation?: () => Promise<void>;
  afterFinancialTeacherImportDelete?: () => Promise<void>;
  afterFinancialSubscriptionImportDelete?: () => Promise<void>;
  beforeFinancialScheduleInsert?: () => Promise<void>;
  submissionStorage?: FinancialSubmissionStorage;
  sendSubmissionProcessedEmail?: (input: {
    email: string;
    contactName: string;
    schoolName: string;
    seasonName: string;
    filename: string;
  }) => Promise<void>;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function sendProcessedSubmissionEmail(input: {
  email: string;
  contactName: string;
  schoolName: string;
  seasonName: string;
  filename: string;
}) {
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!fromEmail) throw new Error("RESEND_FROM_EMAIL is not configured");
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [input.email],
      subject: "Je financiële aanlevering is verwerkt",
      text: `Hoi ${input.contactName},\n\nJe aanlevering ${input.filename} voor ${input.seasonName} is verwerkt.\n\nJe kunt de actuele status ook terugzien in de ByB Ledenchallenge.\n\nGroet,\nByB`,
      html: `<p>Hoi ${escapeHtml(input.contactName)},</p><p>Je aanlevering <strong>${escapeHtml(input.filename)}</strong> voor ${escapeHtml(input.seasonName)} is verwerkt.</p><p>Je kunt de actuele status ook terugzien in de ByB Ledenchallenge.</p><p>Groet,<br />ByB</p><p style="color:#6b6a67;font-size:13px">Deze melding is voor ${escapeHtml(input.schoolName)}.</p>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend gaf status ${response.status}: ${detail.slice(0, 300)}`);
  }
}

export function createFinancialRouter({
  database: db = defaultDb,
  participantForRequest: currentParticipantForRequest = currentParticipant,
  signedInMiddleware = requireSignedIn,
  adminMiddleware = requireAdmin,
  adminDisplayNameForRequest = (req) => {
    const claims = (getAuth(req).sessionClaims ?? {}) as Record<string, unknown>;
    if (typeof claims.name === "string" && claims.name.trim()) return claims.name.trim();
    const firstName = typeof claims.firstName === "string" ? claims.firstName.trim() : "";
    const lastName = typeof claims.lastName === "string" ? claims.lastName.trim() : "";
    return [firstName, lastName].filter(Boolean).join(" ") || "ByB coach";
  },
  beforeFinancialMonthResponse,
  beforeFinancialSeasonMasterSave,
  afterFinancialTeacherImportMutation,
  afterFinancialTeacherImportDelete,
  afterFinancialSubscriptionImportDelete,
  beforeFinancialScheduleInsert,
  submissionStorage = financialSubmissionStorage,
  sendSubmissionProcessedEmail = sendProcessedSubmissionEmail,
}: FinancialRouterDependencies = {}): IRouter {
const router: IRouter = Router();

async function ownedSeason(participantId: number, id: number) {
  const [season] = await db.select().from(financialSeasonsTable).where(and(eq(financialSeasonsTable.id, id), eq(financialSeasonsTable.participantId, participantId))).limit(1);
  return season;
}
async function participantById(participantId: number) {
  const [participant] = await db.select({ id: participantsTable.id })
    .from(participantsTable)
    .where(eq(participantsTable.id, participantId))
    .limit(1);
  return participant;
}
function pathParticipantId(value: string | string[]) {
  if (Array.isArray(value)) value = value[0] ?? "";
  const participantId = Number(value);
  return Number.isSafeInteger(participantId) && participantId > 0 ? participantId : null;
}
function pathSeasonId(value: string | string[]) {
  if (Array.isArray(value)) value = value[0] ?? "";
  const seasonId = Number(value);
  return Number.isSafeInteger(seasonId) && seasonId > 0 ? seasonId : null;
}
function pathSubmissionId(value: string | string[]) {
  if (Array.isArray(value)) value = value[0] ?? "";
  const submissionId = Number(value);
  return Number.isSafeInteger(submissionId) && submissionId > 0 ? submissionId : null;
}
function validSubmissionFilename(value: string) {
  return value.length <= 255 && value.toLocaleLowerCase().endsWith(".xlsx") && !value.includes("/") && !value.includes("\\");
}
function submissionView(row: typeof financialFileSubmissionsTable.$inferSelect, seasonName: string, admin = false) {
  const view = {
    id: row.id,
    seasonId: row.seasonId,
    seasonName,
    fileType: row.fileType as "teachers" | "subscriptions",
    filename: row.originalFilename,
    sizeBytes: row.sizeBytes,
    status: row.status as "open" | "in_progress" | "processed",
    submittedAt: row.createdAt,
    downloadUrl: admin
      ? `/api/admin/financial/file-submissions/${row.id}/download`
      : `/api/financial/file-submissions/${row.id}/download`,
  };
  return admin ? {
    ...view,
    statusChangedAt: row.statusChangedAt,
    statusChangedBy: row.statusChangedBy,
    notificationAttemptedAt: row.notificationAttemptedAt,
    notificationSentAt: row.notificationSentAt,
    notificationError: row.notificationError,
  } : view;
}
function safeDownloadFilename(value: string) {
  return value.replace(/[\r\n"]/g, "_");
}
function pathCalendarYear(value: string | string[]) {
  if (Array.isArray(value)) value = value[0] ?? "";
  const calendarYear = Number(value);
  return Number.isInteger(calendarYear) && calendarYear >= 2020 && calendarYear <= 2100 ? calendarYear : null;
}
function validSubscription(subscription: ReturnType<typeof CreateFinancialSeasonBody.parse>["subscriptions"][number]) {
  if (subscription.productType === "punch_card") {
    return subscription.paymentFrequency === "one_time"
      && subscription.rideCount != null
      && subscription.installmentCount == null
      && subscription.durationMonths == null;
  }
  return subscription.paymentFrequency !== "one_time"
    && subscription.rideCount == null
    && subscription.validityMonths == null
    && (subscription.paymentFrequency === "installments"
      ? subscription.installmentCount != null
      : subscription.installmentCount == null);
}
function validLocation(location: ReturnType<typeof CreateFinancialSeasonBody.parse>["locations"][number]) {
  return location.rentFrequency === "month"
    ? location.rentTermCount === undefined || (location.rentTermCount != null && Number.isInteger(location.rentTermCount) && location.rentTermCount >= 1)
    : location.rentTermCount == null;
}
function publicMonth<T extends { _locationRentAllocationsCents?: unknown }>(month: T) {
  const { _locationRentAllocationsCents: _ignored, ...result } = month;
  return result;
}
function seasonView(season: typeof financialSeasonsTable.$inferSelect) {
  return { id: season.id, name: season.name, startDate: season.startDate, endDate: season.endDate, country: season.country, hasStarterDeduction: season.hasStarterDeduction, defaultSalary: euros(season.defaultSalaryCents), updatedAt: season.updatedAt.toISOString() };
}
const normalizedTeacherName = (name: string) => name.trim().toLocaleLowerCase();
const validExpectedUpdatedAt = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
function validTeacherImportRows(value: unknown): value is TeacherImportRow[] {
  return Array.isArray(value) && value.every(row =>
    row && typeof row.name === "string" && row.name.trim() !== ""
    && typeof row.hourlyRate === "number" && Number.isFinite(row.hourlyRate) && row.hourlyRate >= 0
    && typeof row.weeklyTravel === "number" && Number.isFinite(row.weeklyTravel) && row.weeklyTravel >= 0);
}
function validSubscriptionImportRows(value: unknown): value is SubscriptionImportRow[] {
  return Array.isArray(value) && value.every(row =>
    row && typeof row.name === "string" && row.name.trim() !== ""
    && (row.audience === "youth" || row.audience === "adult")
    && (row.productType === "subscription" || row.productType === "punch_card")
    && typeof row.paymentFrequency === "string"
    && typeof row.price === "number" && Number.isFinite(row.price) && row.price >= 0
    && (row.installmentCount == null || (Number.isInteger(row.installmentCount) && row.installmentCount >= 1))
    && (row.durationMonths == null || (Number.isInteger(row.durationMonths) && row.durationMonths >= 1))
    && (row.rideCount == null || (Number.isInteger(row.rideCount) && row.rideCount >= 1))
    && (row.validityMonths == null || (Number.isInteger(row.validityMonths) && row.validityMonths >= 1))
    && typeof row.vatRate === "number" && [0, 9, 21].includes(row.vatRate)
    && (row.productType === "punch_card"
      ? row.paymentFrequency === "one_time" && row.rideCount != null && row.installmentCount == null && row.durationMonths == null
      : row.paymentFrequency !== "one_time"
        && row.rideCount == null
        && row.validityMonths == null
        && (row.paymentFrequency === "installments" ? row.installmentCount != null : row.installmentCount == null)));
}
function validScheduleImportRows(value: unknown): value is ScheduleImportRow[] {
  return Array.isArray(value) && value.every(row =>
    row && typeof row.name === "string" && row.name.trim() !== ""
    && (row.teacherId == null || (Number.isSafeInteger(row.teacherId) && row.teacherId > 0))
    && typeof row.teacherLabel === "string"
    && Number.isSafeInteger(row.locationId) && row.locationId > 0
    && typeof row.locationLabel === "string"
    && Number.isSafeInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6
    && typeof row.weekdayLabel === "string"
    && typeof row.startTime === "string" && /^\d{2}:\d{2}$/.test(row.startTime)
    && Number.isSafeInteger(row.durationMinutes) && row.durationMinutes > 0
    && typeof row.activeFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.activeFrom)
    && typeof row.activeUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.activeUntil)
    && row.activeFrom <= row.activeUntil);
}
async function detail(season: typeof financialSeasonsTable.$inferSelect) {
  const teachers = await db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, season.id));
  const locations = await db.select().from(financialLocationsTable).where(eq(financialLocationsTable.seasonId, season.id));
  const subscriptions = await db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, season.id));
  const lessons = await db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, season.id));
  const closures = await db.select().from(financialClosuresTable).where(eq(financialClosuresTable.seasonId, season.id));
  const months = await calculatedMonths(season);
  const costTrends = calculateFinancialCostTrends(months);
  const lessonSeasonForecast = buildLessonSeasonForecast({
    startDate: season.startDate,
    endDate: season.endDate,
    teachers,
    locations,
    lessons,
    closures,
    savedMonths: months,
  });
  return { ...seasonView(season),
    teachers: teachers.map(x => ({ id: x.id, name: x.name, hourlyRate: euros(x.hourlyRateCents), weeklyTravel: euros(x.weeklyTravelCents) })),
    locations: locations.map(x => ({ id: x.id, name: x.name, rentFrequency: x.rentFrequency, rent: euros(x.rentCents), rentTermCount: x.rentFrequency === "month" ? x.rentTermCount ?? 12 : null, sessionMinutes: x.sessionMinutes })),
    subscriptions: subscriptions.map(x => ({
      id: x.id,
      name: x.name,
      audience: x.audience,
      productType: x.productType,
      paymentFrequency: x.paymentFrequency,
      price: euros(x.priceCents),
      installmentCount: x.installmentCount,
      durationMonths: x.durationMonths,
      rideCount: x.rideCount,
      validityMonths: x.validityMonths,
      vatRate: x.vatRateBasisPoints / 100,
    })),
    lessons: lessons.map(x => ({ id: x.id, teacherId: x.teacherId, locationId: x.locationId, name: x.name, weekday: x.weekday, startTime: x.startTime, durationMinutes: x.durationMinutes, activeFrom: x.activeFrom, activeUntil: x.activeUntil })),
    closures: closures.map(x => ({ id: x.id, name: x.name, startDate: x.startDate, endDate: x.endDate })),
    months: months.map(publicMonth),
    costTrends,
    lessonSeasonForecast,
  };
}
async function calculatedMonths(season: typeof financialSeasonsTable.$inferSelect, draftMonth?: string) {
  const teachers = await db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, season.id));
  const locations = await db.select().from(financialLocationsTable).where(eq(financialLocationsTable.seasonId, season.id));
  const subscriptions = await db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, season.id));
  const lessons = await db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, season.id));
  const closures = await db.select().from(financialClosuresTable).where(eq(financialClosuresTable.seasonId, season.id));
  const saved = await db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, season.id)).orderBy(asc(financialMonthsTable.month));
  const monthIds = saved.map(x => x.id);
  const fixed = monthIds.length ? await db.select().from(financialFixedCostsTable).where(inArray(financialFixedCostsTable.financialMonthId, monthIds)).orderBy(asc(financialFixedCostsTable.sortOrder), asc(financialFixedCostsTable.id)) : [];
  const activities = monthIds.length ? await db.select().from(financialActivitiesTable).where(inArray(financialActivitiesTable.financialMonthId, monthIds)) : [];
  const inputs = monthIds.length ? await db.select().from(financialLessonMonthInputsTable).where(inArray(financialLessonMonthInputsTable.financialMonthId, monthIds)) : [];
  const fixedByMonth = new Map<number, typeof fixed>(); const activitiesByMonth = new Map<number, typeof activities>(); const inputByMonth = new Map<number, typeof inputs>();
  for (const item of fixed) { const list = fixedByMonth.get(item.financialMonthId) ?? []; list.push(item); fixedByMonth.set(item.financialMonthId, list); }
  for (const item of activities) { const list = activitiesByMonth.get(item.financialMonthId) ?? []; list.push(item); activitiesByMonth.set(item.financialMonthId, list); }
  for (const item of inputs) { const list = inputByMonth.get(item.financialMonthId) ?? []; list.push(item); inputByMonth.set(item.financialMonthId, list); }
  let previousBalance = 0; let previousGross = 0; let cumulativeRevenue = 0; let cumulativeCosts = 0; let cumulativeTax = 0; let cumulativeNet = 0;
  const monthRecords = [...saved];
  if (draftMonth && !monthRecords.some(x => x.month === draftMonth)) {
    monthRecords.push({ id: 0, seasonId: season.id, month: draftMonth, contributionRevenueCents: 0, taxArrearsCents: 0, salaryOverrideCents: null, createdAt: new Date(), updatedAt: new Date() } as typeof saved[number]);
    monthRecords.sort((a, b) => a.month.localeCompare(b.month));
  }
  const latestSavedAttendance = new Map<number, { attendance: number; month: string }>();
  const rentAllocationByRecordId = new Map<number, Array<{ locationId: number; amountCents: number }>>();
  const alreadyAllocatedByLocation = new Map<number, number>();
  for (const record of saved) {
    const snapshot = normalizeFinancialMonthSnapshot(record.masterDataSnapshot as { formatVersion?: number; locations?: typeof locations; lessons?: typeof lessons; closures?: typeof closures; seasonStartDate?: string; seasonEndDate?: string } | null);
    const snapshotLocations = snapshot?.locations ?? locations;
    const snapshotLessons = snapshot?.lessons ?? lessons;
    const snapshotClosures = snapshot?.closures ?? closures;
    const allocation = monthlyRentAllocation({
      startDate: snapshot?.seasonStartDate ?? season.startDate,
      endDate: snapshot?.seasonEndDate ?? season.endDate,
      lessons: snapshotLessons,
    }, snapshotLocations, snapshotClosures).allocationByMonthAndLocation;
    const items = snapshotLocations
      .filter(location => location.rentFrequency === "month")
      .map(location => ({ locationId: location.id, amountCents: allocation.get(`${record.month}:${location.id}`) ?? 0 }))
      .filter(item => item.amountCents > 0);
    rentAllocationByRecordId.set(record.id, items);
    for (const item of items) {
      if (locations.some(location => location.id === item.locationId && location.rentFrequency === "month")) {
        alreadyAllocatedByLocation.set(item.locationId, (alreadyAllocatedByLocation.get(item.locationId) ?? 0) + item.amountCents);
      }
    }
  }
  const savedMonthNames = new Set(saved.map(record => record.month));
  return monthRecords.map((record) => {
    const isSaved = record.id !== 0;
    const snapshot = normalizeFinancialMonthSnapshot(record.masterDataSnapshot as { formatVersion?: number; teachers?: typeof teachers; locations?: typeof locations; subscriptions?: typeof subscriptions; lessons?: typeof lessons; closures?: typeof closures; seasonStartDate?: string; seasonEndDate?: string; country?: "Nederland" | "België"; hasStarterDeduction?: boolean; defaultSalaryCents?: number; lessonInputs?: Array<{ lessonId: number; attendance: number | null; lessonCountOverride: number | null }> } | null);
    const monthTeachers = snapshot?.teachers ?? teachers; const monthLocations = snapshot?.locations ?? locations;
    const monthSubscriptions = snapshot?.subscriptions ?? subscriptions; const monthLessons = snapshot?.lessons ?? lessons; const monthClosures = snapshot?.closures ?? closures;
    const context = selectSnapshotCalculationContext(snapshot, { country: season.country as "Nederland" | "België", hasStarterDeduction: season.hasStarterDeduction, defaultSalaryCents: season.defaultSalaryCents }, inputByMonth.get(record.id) ?? []);
    const activeMonthLessons = monthLessons.filter(lesson => lessonOverlapsMonth(lesson, record.month));
    const rawInputs = isSaved
      ? context.lessonInputs
      : activeMonthLessons.map(lesson => ({
        lessonId: lesson.id,
         attendance: latestSavedAttendance.get(lesson.id)?.attendance ?? null,
         attendanceSourceMonth: latestSavedAttendance.get(lesson.id)?.month ?? null,
        lessonCountOverride: null,
      }));
    const profitability = lessonProfitabilityForMonth({
      month: record.month,
      teachers: monthTeachers,
      locations: monthLocations,
      lessons: activeMonthLessons,
      closures: monthClosures,
      lessonInputs: rawInputs,
      contributionRevenueCents: record.contributionRevenueCents,
      seasonRentContext: {
        startDate: snapshot?.seasonStartDate ?? season.startDate,
        endDate: snapshot?.seasonEndDate ?? season.endDate,
        lessons: monthLessons,
        ...(isSaved ? {} : { excludedMonths: savedMonthNames, alreadyAllocatedByLocation }),
      },
    });
    if (isSaved) {
      for (const input of rawInputs) {
         if (input.attendance != null) latestSavedAttendance.set(input.lessonId, { attendance: input.attendance, month: record.month });
      }
    }
    const recordFixed = record.id ? fixedByMonth.get(record.id) ?? [] : [];
    const previousMonth = previousCalendarMonth(record.month);
    const previousRecord = saved.find(item => item.month === previousMonth);
    const previousFixed = previousRecord ? (fixedByMonth.get(previousRecord.id) ?? []).filter(item => item.frequency === "monthly") : [];
    const recordActivities = record.id ? activitiesByMonth.get(record.id) ?? [] : [];
    const result = calculateMonth({ contributionRevenueCents: record.contributionRevenueCents, activityRevenueCents: recordActivities.reduce((sum, x) => sum + x.amountCents, 0), fixedCostsCents: recordFixed.reduce((sum, x) => sum + x.amountCents, 0), lessonCostsCents: profitability.reduce((sum, x) => sum + x.lessonCostCents, 0), taxArrearsCents: record.taxArrearsCents, salaryCents: record.salaryOverrideCents ?? context.defaultSalaryCents, previousBalanceCents: previousBalance, cumulativeGrossBeforeCents: previousGross, country: context.country, hasStarterDeduction: context.hasStarterDeduction, taxYear: Number(record.month.slice(0, 4)) });
    previousBalance = result.bankBalanceCents; previousGross = result.cumulativeGrossCents; cumulativeRevenue += result.revenueCents; cumulativeCosts += result.costsCents; cumulativeTax += result.taxReserveCents; cumulativeNet += result.netProfitCents;
    return { month: record.month, isSaved, updatedAt: isSaved ? record.updatedAt.toISOString() : null, contributionRevenue: euros(record.contributionRevenueCents), taxArrears: euros(record.taxArrearsCents), salaryOverride: record.salaryOverrideCents == null ? null : euros(record.salaryOverrideCents), revenue: euros(result.revenueCents), costs: euros(result.costsCents), grossProfit: euros(result.grossProfitCents), taxReserve: euros(result.taxReserveCents), netProfit: euros(result.netProfitCents), salary: euros(result.salaryCents), bankBalance: euros(result.bankBalanceCents), fixedCosts: recordFixed.map(x => ({ group: x.costGroup, description: x.category, frequency: x.frequency as "monthly" | "yearly" | "one_time", amount: euros(x.amountCents) })), previousMonth: previousRecord ? previousMonth : null, previousMonthFixedCosts: previousFixed.map(x => ({ group: x.costGroup, description: x.category, frequency: x.frequency as "monthly" | "yearly" | "one_time", amount: euros(x.amountCents) })), activities: recordActivities.map(x => ({ name: x.name, amount: euros(x.amountCents) })), lessonInputs: rawInputs.map(x => ({ lessonId: x.lessonId, attendance: x.attendance, attendanceSourceMonth: isSaved ? null : ("attendanceSourceMonth" in x ? x.attendanceSourceMonth : null), lessonCountOverride: x.lessonCountOverride })), lessonProfitability: profitability.map(({ lessonCostCents: _ignored, ...row }) => row), cumulative: { revenue: euros(cumulativeRevenue), costs: euros(cumulativeCosts), grossProfit: euros(previousGross), taxReserve: euros(cumulativeTax), netProfit: euros(cumulativeNet), bankBalance: euros(previousBalance) }, _locationRentAllocationsCents: isSaved ? rentAllocationByRecordId.get(record.id) ?? [] : [] };
  });
}

async function taxYearSummary(participantId: number, calendarYear: number) {
  const seasons = await db.select().from(financialSeasonsTable).where(eq(financialSeasonsTable.participantId, participantId));
  const months: Array<{ month: string; grossProfitCents: number; country: "Nederland" | "België"; hasStarterDeduction: boolean }> = [];
  for (const season of seasons) {
    const rawMonths = await db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, season.id));
    const rawByMonth = new Map(rawMonths.map(month => [month.month, month]));
    const calculated = await calculatedMonths(season);
    for (const month of calculated) {
      if (!month.isSaved || !month.month.startsWith(`${calendarYear}-`)) continue;
      const raw = rawByMonth.get(month.month);
      const snapshot = normalizeFinancialMonthSnapshot(raw?.masterDataSnapshot as { country?: "Nederland" | "België"; hasStarterDeduction?: boolean } | null);
      months.push({
        month: month.month,
        grossProfitCents: toCents(month.grossProfit),
        country: snapshot?.country ?? season.country as "Nederland" | "België",
        hasStarterDeduction: snapshot?.hasStarterDeduction ?? season.hasStarterDeduction,
      });
    }
  }
  const [settings] = await db.select().from(financialTaxYearsTable)
    .where(and(eq(financialTaxYearsTable.participantId, participantId), eq(financialTaxYearsTable.calendarYear, calendarYear)))
    .limit(1);
  return buildFinancialTaxYearSummary({
    calendarYear,
    months,
    preliminaryPaymentsCents: settings?.preliminaryPaymentsCents ?? 0,
    updatedAt: settings?.updatedAt ?? null,
  });
}
async function saveMaster(tx: any, seasonId: number, input: ReturnType<typeof CreateFinancialSeasonBody.parse>) {
  const existingTeachers = await tx.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId));
  const existingLocations = await tx.select().from(financialLocationsTable).where(eq(financialLocationsTable.seasonId, seasonId));
  const existingSubscriptions = await tx.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId));
  const existingLessons = await tx.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
  const existingClosures = await tx.select().from(financialClosuresTable).where(eq(financialClosuresTable.seasonId, seasonId));
  const assertKnown = (provided: Array<{ id?: number }>, existing: Array<{ id: number }>, label: string) => {
    const known = new Set(existing.map(x => x.id));
    if (provided.some(x => x.id !== undefined && !known.has(x.id))) throw new Error(`INVALID_MASTER_ID:${label}`);
  };
  assertKnown(input.teachers, existingTeachers, "teacher"); assertKnown(input.locations, existingLocations, "location");
  assertKnown(input.subscriptions, existingSubscriptions, "subscription"); assertKnown(input.lessons, existingLessons, "lesson"); assertKnown(input.closures, existingClosures, "closure");
  const duplicateClientId = (items: Array<{ clientId?: string }>) => {
    const ids = items.flatMap(item => item.clientId ? [item.clientId] : []);
    return new Set(ids).size !== ids.length;
  };
  if (duplicateClientId(input.teachers) || duplicateClientId(input.locations)) throw new Error("DUPLICATE_CLIENT_ID");
  if (input.subscriptions.some(subscription => !validSubscription(subscription))) throw new Error("INVALID_SUBSCRIPTION");
  if (input.locations.some(location => !validLocation(location))) throw new Error("INVALID_LOCATION");
  const retainedTeacherIds = new Set(input.teachers.flatMap(x => x.id === undefined ? [] : [x.id]));
  const retainedLocationIds = new Set(input.locations.flatMap(x => x.id === undefined ? [] : [x.id]));
  const teacherClientIds = new Set(input.teachers.flatMap(x => x.clientId ? [x.clientId] : []));
  const locationClientIds = new Set(input.locations.flatMap(x => x.clientId ? [x.clientId] : []));
  if (input.lessons.some(x =>
    (x.teacherId != null && (x.teacherClientId != null || !retainedTeacherIds.has(x.teacherId))) ||
    (x.teacherClientId != null && !teacherClientIds.has(x.teacherClientId)) ||
    (x.locationId != null && (x.locationClientId != null || !retainedLocationIds.has(x.locationId))) ||
    (x.locationClientId != null && !locationClientIds.has(x.locationClientId))
  )) throw new Error("INVALID_MASTER_REFERENCE");
  const teacherIdByClientId = new Map<string, number>();
  const locationIdByClientId = new Map<string, number>();
  for (const teacher of input.teachers) {
    const values = { name: teacher.name, hourlyRateCents: toCents(teacher.hourlyRate), weeklyTravelCents: toCents(teacher.weeklyTravel), updatedAt: new Date() };
    if (teacher.id) await tx.update(financialTeachersTable).set(values).where(and(
      eq(financialTeachersTable.id, teacher.id),
      eq(financialTeachersTable.seasonId, seasonId),
    ));
    else {
      const [created] = await tx.insert(financialTeachersTable).values({ seasonId, ...values }).returning({ id: financialTeachersTable.id });
      if (teacher.clientId) teacherIdByClientId.set(teacher.clientId, created.id);
    }
  }
  for (const location of input.locations) {
    const values = { name: location.name, rentFrequency: location.rentFrequency, rentCents: toCents(location.rent), rentTermCount: location.rentFrequency === "month" ? location.rentTermCount ?? 12 : null, sessionMinutes: location.sessionMinutes ?? null, updatedAt: new Date() };
    if (location.id) await tx.update(financialLocationsTable).set(values).where(and(
      eq(financialLocationsTable.id, location.id),
      eq(financialLocationsTable.seasonId, seasonId),
    ));
    else {
      const [created] = await tx.insert(financialLocationsTable).values({ seasonId, ...values }).returning({ id: financialLocationsTable.id });
      if (location.clientId) locationIdByClientId.set(location.clientId, created.id);
    }
  }
  for (const subscription of input.subscriptions) {
    const values = {
      name: subscription.name,
      audience: subscription.audience,
      productType: subscription.productType,
      paymentFrequency: subscription.paymentFrequency,
      priceCents: toCents(subscription.price),
      installmentCount: subscription.installmentCount,
      durationMonths: subscription.durationMonths,
      rideCount: subscription.rideCount,
      validityMonths: subscription.validityMonths,
      vatRateBasisPoints: Math.round(subscription.vatRate * 100),
      updatedAt: new Date(),
    };
    if (subscription.id) await tx.update(financialSubscriptionsTable).set(values).where(and(
      eq(financialSubscriptionsTable.id, subscription.id),
      eq(financialSubscriptionsTable.seasonId, seasonId),
    ));
    else await tx.insert(financialSubscriptionsTable).values({ seasonId, ...values });
  }
  for (const closure of input.closures) {
    const values = { name: closure.name, startDate: dateValue(closure.startDate), endDate: dateValue(closure.endDate), updatedAt: new Date() };
    if (closure.id) await tx.update(financialClosuresTable).set(values).where(and(
      eq(financialClosuresTable.id, closure.id),
      eq(financialClosuresTable.seasonId, seasonId),
    ));
    else await tx.insert(financialClosuresTable).values({ seasonId, ...values });
  }
  for (const lesson of input.lessons) {
    const teacherId = lesson.teacherClientId ? teacherIdByClientId.get(lesson.teacherClientId) : lesson.teacherId;
    const locationId = lesson.locationClientId ? locationIdByClientId.get(lesson.locationClientId) : lesson.locationId;
    if ((lesson.teacherClientId && teacherId == null) || (lesson.locationClientId && locationId == null)) throw new Error("INVALID_MASTER_REFERENCE");
    const values = { name: lesson.name, teacherId: teacherId ?? null, locationId: locationId ?? null, weekday: lesson.weekday, startTime: lesson.startTime, durationMinutes: lesson.durationMinutes, activeFrom: dateValue(lesson.activeFrom), activeUntil: dateValue(lesson.activeUntil), updatedAt: new Date() };
    if (lesson.id) await tx.update(financialLessonsTable).set(values).where(and(
      eq(financialLessonsTable.id, lesson.id),
      eq(financialLessonsTable.seasonId, seasonId),
    ));
    else await tx.insert(financialLessonsTable).values({ seasonId, ...values });
  }
  const remove = async (table: any, existing: Array<{ id: number }>, retained: Array<{ id?: number }>) => {
    const retainedIds = new Set(retained.flatMap(x => x.id === undefined ? [] : [x.id]));
    const omitted = existing.filter(x => !retainedIds.has(x.id)).map(x => x.id);
    if (omitted.length) await tx.delete(table).where(and(
      inArray(table.id, omitted),
      eq(table.seasonId, seasonId),
    ));
  };
  await remove(financialLessonsTable, existingLessons, input.lessons);
  await remove(financialTeachersTable, existingTeachers, input.teachers);
  await remove(financialLocationsTable, existingLocations, input.locations);
  await remove(financialSubscriptionsTable, existingSubscriptions, input.subscriptions);
  await remove(financialClosuresTable, existingClosures, input.closures);
}

router.get("/financial/seasons", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req); if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  const seasons = await db.select().from(financialSeasonsTable).where(eq(financialSeasonsTable.participantId, participant.id)).orderBy(asc(financialSeasonsTable.startDate));
  res.json(seasons.map(seasonView));
});
router.post("/financial/seasons/:seasonId/file-submissions/upload", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req);
  if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  const seasonId = pathSeasonId(req.params.seasonId);
  if (seasonId == null) return void res.status(400).json({ error: "Ongeldig seizoen." });
  if (!await ownedSeason(participant.id, seasonId)) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  const parsed = RequestFinancialFileSubmissionUploadBody.safeParse(req.body);
  if (!parsed.success
    || !VALID_FINANCIAL_SUBMISSION_TYPES.has(parsed.data.fileType)
    || !validSubmissionFilename(parsed.data.filename)
    || parsed.data.sizeBytes > MAX_FINANCIAL_SUBMISSION_BYTES) {
    return void res.status(400).json({ error: "Kies een geldig .xlsx-bestand van maximaal 10 MB." });
  }
  const upload = await submissionStorage.requestUpload(participant.id, seasonId);
  await db.insert(financialFileSubmissionsTable).values({
    participantId: participant.id,
    seasonId,
    fileType: parsed.data.fileType,
    originalFilename: parsed.data.filename,
    objectPath: upload.objectPath,
    sizeBytes: parsed.data.sizeBytes,
    status: "uploading",
  });
  res.json(upload);
});
router.get("/financial/seasons/:seasonId/file-submissions", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req);
  if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  const seasonId = pathSeasonId(req.params.seasonId);
  if (seasonId == null) return void res.status(400).json({ error: "Ongeldig seizoen." });
  const season = await ownedSeason(participant.id, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  const rows = await db.select().from(financialFileSubmissionsTable)
    .where(and(
      eq(financialFileSubmissionsTable.participantId, participant.id),
      eq(financialFileSubmissionsTable.seasonId, seasonId),
      ne(financialFileSubmissionsTable.status, "uploading"),
      ne(financialFileSubmissionsTable.status, "deleting"),
    ))
    .orderBy(desc(financialFileSubmissionsTable.createdAt));
  res.json(rows.map(row => submissionView(row, season.name)));
});
router.post("/financial/seasons/:seasonId/file-submissions", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req);
  if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  const seasonId = pathSeasonId(req.params.seasonId);
  if (seasonId == null) return void res.status(400).json({ error: "Ongeldig seizoen." });
  const season = await ownedSeason(participant.id, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  const parsed = CreateFinancialFileSubmissionBody.safeParse(req.body);
  if (!parsed.success
    || !VALID_FINANCIAL_SUBMISSION_TYPES.has(parsed.data.fileType)
    || !validSubmissionFilename(parsed.data.filename)
    || !parsed.data.objectPath.startsWith(`/objects/financial-submissions/${participant.id}/${seasonId}/`)
    || parsed.data.sizeBytes > MAX_FINANCIAL_SUBMISSION_BYTES) {
    return void res.status(400).json({ error: "Kies een geldig .xlsx-bestand van maximaal 10 MB." });
  }
  const object = await submissionStorage.inspect(parsed.data.objectPath);
  if (!object || !object.hasZipSignature || object.size !== parsed.data.sizeBytes || (object.contentType && object.contentType !== XLSX_CONTENT_TYPE)) {
    return void res.status(422).json({ error: "De veilige upload is niet volledig of is geen geldig Excelbestand." });
  }
  const [created] = await db.update(financialFileSubmissionsTable)
    .set({ status: "open", updatedAt: new Date() })
    .where(and(
      eq(financialFileSubmissionsTable.participantId, participant.id),
      eq(financialFileSubmissionsTable.seasonId, seasonId),
      eq(financialFileSubmissionsTable.fileType, parsed.data.fileType),
      eq(financialFileSubmissionsTable.originalFilename, parsed.data.filename),
      eq(financialFileSubmissionsTable.objectPath, parsed.data.objectPath),
      eq(financialFileSubmissionsTable.sizeBytes, parsed.data.sizeBytes),
      eq(financialFileSubmissionsTable.status, "uploading"),
    ))
    .returning();
  if (!created) return void res.status(409).json({ error: "Dit uploadbestand is al aangeleverd of niet meer beschikbaar." });
  res.status(201).json(submissionView(created, season.name));
});
router.get("/financial/file-submissions/:submissionId/download", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req);
  if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  const submissionId = pathSubmissionId(req.params.submissionId);
  if (submissionId == null) return void res.status(400).json({ error: "Ongeldige aanlevering." });
  const [row] = await db.select().from(financialFileSubmissionsTable)
    .where(and(eq(financialFileSubmissionsTable.id, submissionId), eq(financialFileSubmissionsTable.participantId, participant.id)))
    .limit(1);
  if (!row) return void res.status(404).json({ error: "Aanlevering niet gevonden." });
  res.setHeader("content-type", XLSX_CONTENT_TYPE);
  res.setHeader("content-disposition", `attachment; filename="${safeDownloadFilename(row.originalFilename)}"`);
  res.setHeader("cache-control", "private, no-store");
  submissionStorage.createReadStream(row.objectPath).pipe(res);
});
router.get("/admin/financial/file-submissions", signedInMiddleware, adminMiddleware, async (_req, res) => {
  const rows = await db.select({
    submission: financialFileSubmissionsTable,
    seasonName: financialSeasonsTable.name,
    schoolName: participantsTable.schoolName,
  }).from(financialFileSubmissionsTable)
    .innerJoin(financialSeasonsTable, eq(financialFileSubmissionsTable.seasonId, financialSeasonsTable.id))
    .innerJoin(participantsTable, eq(financialFileSubmissionsTable.participantId, participantsTable.id))
    .where(and(
      ne(financialFileSubmissionsTable.status, "uploading"),
      ne(financialFileSubmissionsTable.status, "deleting"),
    ))
    .orderBy(desc(financialFileSubmissionsTable.createdAt));
  res.json(rows.map(row => ({
    ...submissionView(row.submission, row.seasonName, true),
    participantId: row.submission.participantId,
    schoolName: row.schoolName,
  })));
});
router.patch("/admin/financial/file-submissions/:submissionId", signedInMiddleware, adminMiddleware, async (req: AuthedRequest, res) => {
  const submissionId = pathSubmissionId(req.params.submissionId);
  if (submissionId == null) return void res.status(400).json({ error: "Ongeldige aanlevering." });
  const parsed = UpdateAdminFinancialFileSubmissionBody.safeParse(req.body);
  if (!parsed.success || !VALID_FINANCIAL_SUBMISSION_STATUSES.has(parsed.data.status)) {
    return void res.status(400).json({ error: "Ongeldige verwerkingsstatus." });
  }
  const changedAt = new Date();
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select id from ${financialFileSubmissionsTable} where id = ${submissionId} for update`);
    const [existing] = await tx.select().from(financialFileSubmissionsTable)
      .where(eq(financialFileSubmissionsTable.id, submissionId))
      .limit(1);
    if (!existing) return null;
    const shouldNotify = parsed.data.status === "processed"
      && existing.status !== "processed"
      && existing.notificationAttemptedAt == null;
    const [updated] = await tx.update(financialFileSubmissionsTable)
      .set({
        status: parsed.data.status,
        statusChangedAt: changedAt,
        statusChangedBy: adminDisplayNameForRequest(req),
        ...(shouldNotify ? {
          notificationAttemptedAt: changedAt,
          notificationSentAt: null,
          notificationError: null,
        } : {}),
        updatedAt: changedAt,
      })
      .where(eq(financialFileSubmissionsTable.id, submissionId))
      .returning();
    return { updated, shouldNotify };
  });
  const updated = result?.updated;
  if (!updated) return void res.status(404).json({ error: "Aanlevering niet gevonden." });
  const [context] = await db.select({
    seasonName: financialSeasonsTable.name,
    schoolName: participantsTable.schoolName,
    contactName: participantsTable.contactName,
    email: participantsTable.email,
  }).from(financialSeasonsTable)
    .innerJoin(participantsTable, eq(financialSeasonsTable.participantId, participantsTable.id))
    .where(eq(financialSeasonsTable.id, updated.seasonId))
    .limit(1);
  let finalSubmission = updated;
  if (result.shouldNotify) {
    try {
      await sendSubmissionProcessedEmail({
        email: context.email,
        contactName: context.contactName,
        schoolName: context.schoolName,
        seasonName: context.seasonName,
        filename: updated.originalFilename,
      });
      [finalSubmission] = await db.update(financialFileSubmissionsTable)
        .set({ notificationSentAt: new Date(), notificationError: null, updatedAt: new Date() })
        .where(eq(financialFileSubmissionsTable.id, updated.id))
        .returning();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Onbekende fout bij het versturen van de melding.";
      [finalSubmission] = await db.update(financialFileSubmissionsTable)
        .set({ notificationError: detail.slice(0, 500), updatedAt: new Date() })
        .where(eq(financialFileSubmissionsTable.id, updated.id))
        .returning();
    }
  }
  res.json({
    ...submissionView(finalSubmission, context.seasonName, true),
    participantId: finalSubmission.participantId,
    schoolName: context.schoolName,
  });
});
router.get("/admin/financial/file-submissions/:submissionId/download", signedInMiddleware, adminMiddleware, async (req, res) => {
  const submissionId = pathSubmissionId(req.params.submissionId);
  if (submissionId == null) return void res.status(400).json({ error: "Ongeldige aanlevering." });
  const [row] = await db.select().from(financialFileSubmissionsTable).where(eq(financialFileSubmissionsTable.id, submissionId)).limit(1);
  if (!row) return void res.status(404).json({ error: "Aanlevering niet gevonden." });
  res.setHeader("content-type", XLSX_CONTENT_TYPE);
  res.setHeader("content-disposition", `attachment; filename="${safeDownloadFilename(row.originalFilename)}"`);
  res.setHeader("cache-control", "private, no-store");
  submissionStorage.createReadStream(row.objectPath).pipe(res);
});
router.post("/financial/seasons", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req); if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  try {
    const input = CreateFinancialSeasonBody.parse(req.body);
    const season = await db.transaction(async (tx) => {
      const [created] = await tx.insert(financialSeasonsTable).values({ participantId: participant.id, name: input.name, startDate: dateValue(input.startDate), endDate: dateValue(input.endDate), country: input.country, hasStarterDeduction: input.hasStarterDeduction, defaultSalaryCents: toCents(input.defaultSalary) }).returning();
      await saveMaster(tx, created.id, input); return created;
    });
    res.status(201).json(seasonView(season));
  } catch (error) { res.status(400).json({ error: "Ongeldige seizoen-stamgegevens of verwijzing." }); }
});
router.get("/financial/seasons/:seasonId", signedInMiddleware, async (req: AuthedRequest, res) => {
  const seasonId = pathSeasonId(req.params.seasonId);
  if (seasonId == null) return void res.status(400).json({ error: "Ongeldig seizoen." });
  const participant = await currentParticipantForRequest(req); const season = participant && await ownedSeason(participant.id, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." }); res.json(await detail(season));
});
router.put("/financial/seasons/:seasonId", signedInMiddleware, async (req: AuthedRequest, res) => {
  const seasonId = pathSeasonId(req.params.seasonId);
  if (seasonId == null) return void res.status(400).json({ error: "Ongeldig seizoen." });
  const participant = await currentParticipantForRequest(req);
  const season = participant && await ownedSeason(participant.id, seasonId); if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  try {
    const input = UpdateFinancialSeasonBody.parse(req.body);
    const updated = await db.transaction(async (tx) => {
      // Season updates and month snapshots are serialized per season. Whichever
      // transaction gets this lock first defines the complete version observed.
      await lockFinancialSeasonMasterData(tx, season.id);
      await beforeFinancialSeasonMasterSave?.();
      const [currentSeason] = await tx.select().from(financialSeasonsTable).where(eq(financialSeasonsTable.id, season.id)).limit(1);
      if (!currentSeason) throw new Error("FINANCIAL_SEASON_NOT_FOUND");
      if (input.expectedUpdatedAt.toISOString() !== currentSeason.updatedAt.toISOString()) throw new FinancialSeasonConflictError();
      const updatedAt = new Date(Math.max(Date.now(), currentSeason.updatedAt.getTime() + 1));
      const [saved] = await tx.update(financialSeasonsTable).set({ name: input.name, startDate: dateValue(input.startDate), endDate: dateValue(input.endDate), country: input.country, hasStarterDeduction: input.hasStarterDeduction, defaultSalaryCents: toCents(input.defaultSalary), updatedAt }).where(eq(financialSeasonsTable.id, season.id)).returning();
      await saveMaster(tx, saved.id, input); return saved;
    });
    res.json(await detail(updated));
  } catch (error) {
    if (error instanceof FinancialSeasonConflictError) return void res.status(409).json({ error: "Dit seizoen is intussen door iemand anders gewijzigd. Vernieuw het seizoen en controleer de nieuwste gegevens voordat je opnieuw opslaat." });
    res.status(400).json({ error: "Ongeldige seizoen-stamgegevens of verwijzing." });
  }
});
router.get("/financial/seasons/:seasonId/months/:month", signedInMiddleware, async (req: AuthedRequest, res) => {
  const seasonId = pathSeasonId(req.params.seasonId);
  if (seasonId == null) return void res.status(400).json({ error: "Ongeldig seizoen." });
  const participant = await currentParticipantForRequest(req); const season = participant && await ownedSeason(participant.id, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  const requestedMonth = String(req.params.month);
  if (!validMonth(requestedMonth) || requestedMonth < season.startDate.slice(0, 7) + "-01" || requestedMonth > season.endDate.slice(0, 7) + "-01") return void res.status(400).json({ error: "Ongeldige maand buiten dit seizoen." });
  const months = await calculatedMonths(season, requestedMonth);
  const result = months.find(x => x.month === requestedMonth);
  return res.json(result && publicMonth(result));
});
router.put("/financial/seasons/:seasonId/months/:month", signedInMiddleware, async (req: AuthedRequest, res) => {
  const seasonId = pathSeasonId(req.params.seasonId);
  if (seasonId == null) return void res.status(400).json({ error: "Ongeldig seizoen." });
  const participant = await currentParticipantForRequest(req); const season = participant && await ownedSeason(participant.id, seasonId); const requestedMonth = String(req.params.month);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." }); const input = UpsertFinancialMonthBody.parse(req.body) as ReturnType<typeof UpsertFinancialMonthBody.parse> & { expectedUpdatedAt: Date | null };
  if (!validMonth(requestedMonth)) return void res.status(400).json({ error: "Ongeldige maand buiten dit seizoen." });
  try {
  const saved = await db.transaction(async (tx) => {
    // Acquire the season lock before the narrower month lock to keep a fixed
    // lock order and snapshot one fully committed master-data version.
    await lockFinancialSeasonMasterData(tx, season.id);
    await tx.execute(sql`select pg_advisory_xact_lock(${season.id}, hashtext(${requestedMonth}))`);
    const [currentSeason] = await tx.select().from(financialSeasonsTable).where(eq(financialSeasonsTable.id, season.id)).limit(1);
    if (!currentSeason) throw new Error("FINANCIAL_SEASON_NOT_FOUND");
    if (requestedMonth < currentSeason.startDate.slice(0, 7) + "-01" || requestedMonth > currentSeason.endDate.slice(0, 7) + "-01") throw new InvalidFinancialMonthError();
    const [existing] = await tx.select().from(financialMonthsTable).where(and(eq(financialMonthsTable.seasonId, season.id), eq(financialMonthsTable.month, requestedMonth))).limit(1);
    const lessonInputs = input.lessonInputs.map(item => ({
      lessonId: item.lessonId,
      attendance: item.attendance ?? null,
      lessonCountOverride: item.lessonCountOverride ?? null,
    }));
    const existingSnapshot = existing?.masterDataSnapshot != null
      ? normalizeFinancialMonthSnapshot(existing.masterDataSnapshot as {
        formatVersion?: number;
        teachers?: Array<typeof financialTeachersTable.$inferSelect>;
        locations?: Array<typeof financialLocationsTable.$inferSelect>;
        subscriptions?: Array<typeof financialSubscriptionsTable.$inferSelect>;
        lessons?: Array<typeof financialLessonsTable.$inferSelect>;
        closures?: Array<typeof financialClosuresTable.$inferSelect>;
        seasonStartDate?: string;
        seasonEndDate?: string;
        country?: "Nederland" | "België";
        hasStarterDeduction?: boolean;
        defaultSalaryCents?: number;
        lessonInputs?: Array<{ lessonId: number; attendance: number | null; lessonCountOverride: number | null }>;
      })
      : null;
    const snapshot = existingSnapshot
      ? { ...existingSnapshot, lessonInputs }
      : await buildFinancialMonthSnapshot(tx, currentSeason, lessonInputs);
    const snapshotLessons = snapshot.lessons;
    if (!snapshotLessons) throw new Error("INVALID_FINANCIAL_SNAPSHOT");
    const lessonIds = new Set(snapshotLessons.map(lesson => lesson.id));
    if (input.lessonInputs.some(item => !lessonIds.has(item.lessonId))) throw new Error("INVALID_MONTH_LESSON");
    const actualUpdatedAt = existing?.updatedAt.toISOString() ?? null;
    if ((input.expectedUpdatedAt?.toISOString() ?? null) !== actualUpdatedAt) throw new FinancialMonthConflictError();
    const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
    const values = { contributionRevenueCents: toCents(input.contributionRevenue), taxArrearsCents: toCents(input.taxArrears), salaryOverrideCents: input.salaryOverride == null ? null : toCents(input.salaryOverride), masterDataSnapshot: snapshot, updatedAt };
    const [month] = await tx.insert(financialMonthsTable)
      .values({ seasonId: season.id, month: requestedMonth, ...values })
      .onConflictDoUpdate({
        target: [financialMonthsTable.seasonId, financialMonthsTable.month],
        set: values,
      })
      .returning();
    await tx.delete(financialFixedCostsTable).where(eq(financialFixedCostsTable.financialMonthId, month.id)); await tx.delete(financialActivitiesTable).where(eq(financialActivitiesTable.financialMonthId, month.id)); await tx.delete(financialLessonMonthInputsTable).where(eq(financialLessonMonthInputsTable.financialMonthId, month.id));
    if (input.fixedCosts.length) await tx.insert(financialFixedCostsTable).values(input.fixedCosts.map((x, sortOrder) => ({ financialMonthId: month.id, costGroup: x.group, category: x.description, frequency: x.frequency, amountCents: toCents(x.amount), sortOrder })));
    if (input.activities.length) await tx.insert(financialActivitiesTable).values(input.activities.map(x => ({ financialMonthId: month.id, name: x.name, amountCents: toCents(x.amount) })));
    if (input.lessonInputs.length) await tx.insert(financialLessonMonthInputsTable).values(input.lessonInputs.map(x => ({ financialMonthId: month.id, lessonId: x.lessonId, attendance: x.attendance ?? null, lessonCountOverride: x.lessonCountOverride ?? null })));
    return { updatedAt: month.updatedAt.toISOString(), season: currentSeason };
  });
  await beforeFinancialMonthResponse?.(saved.updatedAt);
  const result = (await calculatedMonths(saved.season)).find(x => x.month === requestedMonth);
  return res.json(result && { ...publicMonth(result), updatedAt: saved.updatedAt });
  } catch (error) {
    if (error instanceof FinancialMonthConflictError) return void res.status(409).json({ error: "Deze maand is intussen door iemand anders gewijzigd. Vernieuw de maand en controleer de nieuwste gegevens voordat je opnieuw opslaat." });
    if (error instanceof InvalidFinancialMonthError) return void res.status(400).json({ error: "Ongeldige maand buiten dit seizoen." });
    if (error instanceof Error && error.message === "INVALID_MONTH_LESSON") return void res.status(400).json({ error: "Een lesinvoer hoort niet bij dit seizoen." });
    throw error;
  }
});
router.get("/financial/tax-years/:calendarYear", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req);
  if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  const calendarYear = Number(req.params.calendarYear);
  if (!Number.isInteger(calendarYear) || calendarYear < 2020 || calendarYear > 2100) return void res.status(400).json({ error: "Ongeldig belastingjaar." });
  try {
    res.json(await taxYearSummary(participant.id, calendarYear));
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CALENDAR_MONTH") return void res.status(409).json({ error: "Dezelfde kalendermaand staat in meerdere seizoenen. Los de overlap op voordat de jaarbelasting wordt geschat." });
    throw error;
  }
});
router.put("/financial/tax-years/:calendarYear", signedInMiddleware, async (req: AuthedRequest, res) => {
  const participant = await currentParticipantForRequest(req);
  if (!participant) return void res.status(401).json({ error: "Geen deelnemersprofiel gevonden." });
  const calendarYear = Number(req.params.calendarYear);
  if (!Number.isInteger(calendarYear) || calendarYear < 2020 || calendarYear > 2100) return void res.status(400).json({ error: "Ongeldig belastingjaar." });
  try {
    const input = UpdateFinancialTaxYearBody.parse(req.body) as ReturnType<typeof UpdateFinancialTaxYearBody.parse> & { expectedUpdatedAt: Date | null };
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${participant.id}, ${calendarYear})`);
      const [existing] = await tx.select().from(financialTaxYearsTable)
        .where(and(eq(financialTaxYearsTable.participantId, participant.id), eq(financialTaxYearsTable.calendarYear, calendarYear)))
        .limit(1);
      if ((input.expectedUpdatedAt?.toISOString() ?? null) !== (existing?.updatedAt.toISOString() ?? null)) throw new FinancialTaxYearConflictError();
      const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
      await tx.insert(financialTaxYearsTable).values({
        participantId: participant.id,
        calendarYear,
        preliminaryPaymentsCents: toCents(input.preliminaryPayments),
        updatedAt,
      }).onConflictDoUpdate({
        target: [financialTaxYearsTable.participantId, financialTaxYearsTable.calendarYear],
        set: { preliminaryPaymentsCents: toCents(input.preliminaryPayments), updatedAt },
      });
    });
    res.json(await taxYearSummary(participant.id, calendarYear));
  } catch (error) {
    if (error instanceof FinancialTaxYearConflictError) return void res.status(409).json({ error: "De vooruitbetalingen voor dit belastingjaar zijn intussen gewijzigd. Vernieuw en controleer het nieuwste bedrag." });
    throw error;
  }
});

async function importSeasonForRequest(participantId: number, seasonId: number) {
  if (!await participantById(participantId)) return { status: 404, error: "Deelnemer niet gevonden." } as const;
  const season = await ownedSeason(participantId, seasonId);
  if (!season) return { status: 404, error: "Seizoen niet gevonden." } as const;
  return { season } as const;
}

async function importPreview(
  req: AuthedRequest,
  res: Response,
  participantId: number,
  seasonId: number,
  kind: "teachers" | "subscriptions",
) {
  const selected = await importSeasonForRequest(participantId, seasonId);
  if ("status" in selected) return void res.status(selected.status as number).json({ error: selected.error });
  const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
  const season = selected.season;
  const expectedUpdatedAt = season.updatedAt.toISOString();
  const existing = kind === "teachers"
    ? await db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, season.id))
    : await db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, season.id));
  if (!file) {
    return void res.status(422).json({
      valid: false,
      expectedUpdatedAt,
      existingCount: existing.length,
      newCount: 0,
      rows: [],
      errors: ["Kies een .xlsx-bestand."],
    });
  }
  const parsed = await parseFinancialImport(file.buffer, file.originalname, kind);
  const errors = formatImportIssues(parsed.issues);
  return void res.status(errors.length ? 422 : 200).json({
    valid: errors.length === 0,
    expectedUpdatedAt,
    existingCount: existing.length,
    newCount: parsed.rows.length,
    rows: parsed.rows,
    errors,
  });
}

async function scheduleImportContext(participantId: number, season: typeof financialSeasonsTable.$inferSelect): Promise<ScheduleImportContext> {
  const teachers = await db.select({ id: financialTeachersTable.id, name: financialTeachersTable.name })
    .from(financialTeachersTable)
    .where(eq(financialTeachersTable.seasonId, season.id))
    .orderBy(asc(financialTeachersTable.id));
  const locations = await db.select({ id: financialLocationsTable.id, name: financialLocationsTable.name })
    .from(financialLocationsTable)
    .where(eq(financialLocationsTable.seasonId, season.id))
    .orderBy(asc(financialLocationsTable.id));
  return {
    participantId,
    seasonId: season.id,
    seasonName: season.name,
    templateVersion: SCHEDULE_TEMPLATE_VERSION,
    masterDataVersion: season.updatedAt.toISOString(),
    startDate: season.startDate,
    endDate: season.endDate,
    teachers,
    locations,
  };
}

function schedulePreviewResponse(context: ScheduleImportContext, existingCount: number, rows: ScheduleImportRow[], errors: string[]) {
  return {
    valid: errors.length === 0,
    expectedUpdatedAt: context.masterDataVersion,
    metadata: {
      participantId: context.participantId,
      seasonId: context.seasonId,
      seasonName: context.seasonName,
      templateVersion: context.templateVersion,
      masterDataVersion: context.masterDataVersion,
    },
    existingCount,
    newCount: rows.length,
    rows,
    errors,
  };
}

router.get(
  "/admin/financial/participants/:participantId/seasons/:seasonId/imports/schedule/template",
  signedInMiddleware,
  adminMiddleware,
  async (req, res) => {
    const participantId = pathParticipantId(req.params.participantId);
    const seasonId = pathSeasonId(req.params.seasonId);
    if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
    const selected = await importSeasonForRequest(participantId, seasonId);
    if ("status" in selected) return void res.status(selected.status as number).json({ error: selected.error });
    const context = await scheduleImportContext(participantId, selected.season);
    if (context.locations.length === 0) return void res.status(422).json({ error: "Voeg eerst minimaal één locatie toe aan dit seizoen voordat je een roostersjabloon downloadt." });
    const buffer = await buildScheduleImportTemplate(context);
    const filename = `ByB-Rooster-${selected.season.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}.xlsx`;
    res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("content-disposition", `attachment; filename="${safeDownloadFilename(filename)}"`);
    res.setHeader("cache-control", "private, no-store");
    res.send(buffer);
  },
);

router.post(
  "/admin/financial/participants/:participantId/seasons/:seasonId/imports/schedule/preview",
  signedInMiddleware,
  adminMiddleware,
  financialImportUpload.single("file"),
  async (req, res) => {
    const participantId = pathParticipantId(req.params.participantId);
    const seasonId = pathSeasonId(req.params.seasonId);
    if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
    const selected = await importSeasonForRequest(participantId, seasonId);
    if ("status" in selected) return void res.status(selected.status as number).json({ error: selected.error });
    const context = await scheduleImportContext(participantId, selected.season);
    const existing = await db.select({ id: financialLessonsTable.id })
      .from(financialLessonsTable)
      .where(eq(financialLessonsTable.seasonId, seasonId));
    const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
    if (context.locations.length === 0) {
      return void res.status(422).json(schedulePreviewResponse(
        context,
        existing.length,
        [],
        ["Dit seizoen heeft nog geen locatie. Voeg eerst minimaal één locatie toe."],
      ));
    }
    if (!file) {
      return void res.status(422).json(schedulePreviewResponse(context, existing.length, [], ["Kies een .xlsx-bestand."]));
    }
    const parsed = await parseScheduleImport(file.buffer, file.originalname, context);
    const errors = formatImportIssues(parsed.issues);
    return void res.status(errors.length ? 422 : 200).json(schedulePreviewResponse(context, existing.length, parsed.rows, errors));
  },
);

router.post(
  "/admin/financial/participants/:participantId/seasons/:seasonId/imports/teachers/preview",
  signedInMiddleware,
  adminMiddleware,
  financialImportUpload.single("file"),
  async (req, res) => {
    const participantId = pathParticipantId(req.params.participantId);
    const seasonId = pathSeasonId(req.params.seasonId);
    if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
    return importPreview(req, res, participantId, seasonId, "teachers");
  },
);

router.post(
  "/admin/financial/participants/:participantId/seasons/:seasonId/imports/subscriptions/preview",
  signedInMiddleware,
  adminMiddleware,
  financialImportUpload.single("file"),
  async (req, res) => {
    const participantId = pathParticipantId(req.params.participantId);
    const seasonId = pathSeasonId(req.params.seasonId);
    if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
    return importPreview(req, res, participantId, seasonId, "subscriptions");
  },
);

async function confirmImport(
  req: AuthedRequest,
  res: Response,
  participantId: number,
  seasonId: number,
  kind: "teachers" | "subscriptions",
) {
  const selected = await importSeasonForRequest(participantId, seasonId);
  if ("status" in selected) return void res.status(selected.status as number).json({ error: selected.error });
  const expected = validExpectedUpdatedAt(req.body?.expectedUpdatedAt);
  const rows = req.body?.rows;
  if (!expected || !(kind === "teachers" ? validTeacherImportRows(rows) : validSubscriptionImportRows(rows))) {
    return void res.status(400).json({ error: "Ongeldige importgegevens. Bevestig een geldige preview opnieuw." });
  }
  try {
    const result = await db.transaction(async tx => {
      await lockFinancialSeasonMasterData(tx, seasonId);
      const [currentSeason] = await tx.select().from(financialSeasonsTable)
        .where(and(eq(financialSeasonsTable.id, seasonId), eq(financialSeasonsTable.participantId, participantId)))
        .limit(1);
      if (!currentSeason) throw new Error("FINANCIAL_SEASON_NOT_FOUND");
      if (expected.toISOString() !== currentSeason.updatedAt.toISOString()) throw new FinancialSeasonConflictError();
      const updatedAt = new Date(Math.max(Date.now(), currentSeason.updatedAt.getTime() + 1));
      if (kind === "teachers") {
        const existing = await tx.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId));
        const retainedIds = new Set<number>();
        for (const row of rows as TeacherImportRow[]) {
          const candidates = existing.filter(item => !retainedIds.has(item.id) && normalizedTeacherName(item.name) === normalizedTeacherName(row.name));
          if (candidates.length === 1) {
            retainedIds.add(candidates[0].id);
            await tx.update(financialTeachersTable).set({
              name: row.name,
              hourlyRateCents: toCents(row.hourlyRate),
              weeklyTravelCents: toCents(row.weeklyTravel),
              updatedAt: new Date(),
            }).where(and(eq(financialTeachersTable.id, candidates[0].id), eq(financialTeachersTable.seasonId, seasonId)));
          } else {
            const [created] = await tx.insert(financialTeachersTable).values({
              seasonId,
              name: row.name,
              hourlyRateCents: toCents(row.hourlyRate),
              weeklyTravelCents: toCents(row.weeklyTravel),
            }).returning({ id: financialTeachersTable.id });
            retainedIds.add(created.id);
          }
          await afterFinancialTeacherImportMutation?.();
        }
        const removedIds = existing.filter(item => !retainedIds.has(item.id)).map(item => item.id);
        if (removedIds.length) {
          // The FK's SET NULL behavior deliberately clears only links to teachers
          // that disappeared; retained name matches keep their lesson relationships.
          await tx.delete(financialTeachersTable).where(and(
            eq(financialTeachersTable.seasonId, seasonId),
            inArray(financialTeachersTable.id, removedIds),
          ));
          await afterFinancialTeacherImportDelete?.();
        }
      } else {
        await tx.delete(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId));
        await afterFinancialSubscriptionImportDelete?.();
        if ((rows as SubscriptionImportRow[]).length) {
          await tx.insert(financialSubscriptionsTable).values((rows as SubscriptionImportRow[]).map(row => ({
            seasonId,
            name: row.name,
            audience: row.audience,
            productType: row.productType,
            paymentFrequency: row.paymentFrequency,
            priceCents: toCents(row.price),
            installmentCount: row.installmentCount,
            durationMonths: row.durationMonths,
            rideCount: row.rideCount,
            validityMonths: row.validityMonths,
            vatRateBasisPoints: Math.round(row.vatRate * 100),
          })));
        }
      }
      await tx.update(financialSeasonsTable).set({ updatedAt }).where(eq(financialSeasonsTable.id, seasonId));
      return { importedCount: rows.length, updatedAt: updatedAt.toISOString() };
    });
    return void res.json(result);
  } catch (error) {
    if (error instanceof FinancialSeasonConflictError) {
      return void res.status(409).json({ error: "Dit seizoen is intussen door iemand anders gewijzigd. Maak een nieuwe preview voordat je opnieuw bevestigt." });
    }
    throw error;
  }
}

async function confirmScheduleImport(req: AuthedRequest, res: Response, participantId: number, seasonId: number) {
  const selected = await importSeasonForRequest(participantId, seasonId);
  if ("status" in selected) return void res.status(selected.status as number).json({ error: selected.error });
  const expected = validExpectedUpdatedAt(req.body?.expectedUpdatedAt);
  const rows = req.body?.rows;
  const bodyParticipantId = req.body?.participantId;
  const bodySeasonId = req.body?.seasonId;
  const templateVersion = req.body?.templateVersion;
  const masterDataVersion = req.body?.masterDataVersion;
  if (
    !expected
    || bodyParticipantId !== participantId
    || bodySeasonId !== seasonId
    || templateVersion !== SCHEDULE_TEMPLATE_VERSION
    || typeof masterDataVersion !== "string"
    || masterDataVersion !== expected.toISOString()
    || !validScheduleImportRows(rows)
    || rows.length === 0
  ) {
    return void res.status(400).json({ error: "Ongeldige roosterimport. Bevestig een geldige preview opnieuw." });
  }
  try {
    const result = await db.transaction(async tx => {
      await lockFinancialSeasonMasterData(tx, seasonId);
      const [currentSeason] = await tx.select().from(financialSeasonsTable)
        .where(and(eq(financialSeasonsTable.id, seasonId), eq(financialSeasonsTable.participantId, participantId)))
        .limit(1);
      if (!currentSeason) throw new Error("FINANCIAL_SEASON_NOT_FOUND");
      if (expected.toISOString() !== currentSeason.updatedAt.toISOString() || masterDataVersion !== currentSeason.updatedAt.toISOString()) {
        throw new FinancialSeasonConflictError();
      }
      const teachers = await tx.select({ id: financialTeachersTable.id, name: financialTeachersTable.name })
        .from(financialTeachersTable)
        .where(eq(financialTeachersTable.seasonId, seasonId));
      const locations = await tx.select({ id: financialLocationsTable.id, name: financialLocationsTable.name })
        .from(financialLocationsTable)
        .where(eq(financialLocationsTable.seasonId, seasonId));
      if (locations.length === 0) throw new InvalidFinancialScheduleImportError("NO_LOCATION");
      const teacherById = new Map(teachers.map(teacher => [teacher.id, teacher]));
      const locationById = new Map(locations.map(location => [location.id, location]));
      const validDate = (value: string) => {
        const date = new Date(`${value}T00:00:00Z`);
        return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      };
      for (const row of rows) {
        const teacher = row.teacherId == null ? null : teacherById.get(row.teacherId);
        const location = locationById.get(row.locationId);
        if (
          (row.teacherId == null ? row.teacherLabel !== "Geen (Zelf)" : !teacher || row.teacherLabel !== `${teacher.name} (docent ${teacher.id})`)
          || !location
          || row.locationLabel !== `${location.name} (locatie ${location.id})`
          || WEEKDAY_LABELS[row.weekday] !== row.weekdayLabel
          || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)
          || !validDate(row.activeFrom)
          || !validDate(row.activeUntil)
          || row.activeFrom > row.activeUntil
        ) throw new InvalidFinancialScheduleImportError("INVALID_REFERENCE");
      }
      await tx.delete(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
      await beforeFinancialScheduleInsert?.();
      await tx.insert(financialLessonsTable).values(rows.map(row => ({
        seasonId,
        teacherId: row.teacherId,
        locationId: row.locationId,
        name: row.name,
        weekday: row.weekday,
        startTime: row.startTime,
        durationMinutes: row.durationMinutes,
        activeFrom: row.activeFrom,
        activeUntil: row.activeUntil,
      })));
      const updatedAt = new Date(Math.max(Date.now(), currentSeason.updatedAt.getTime() + 1));
      await tx.update(financialSeasonsTable).set({ updatedAt }).where(eq(financialSeasonsTable.id, seasonId));
      return { importedCount: rows.length, updatedAt: updatedAt.toISOString() };
    });
    return void res.json(result);
  } catch (error) {
    if (error instanceof FinancialSeasonConflictError) {
      return void res.status(409).json({ error: "Dit seizoen of de stamgegevens zijn intussen gewijzigd. Download een nieuw roosterbestand en maak een nieuwe preview." });
    }
    if (error instanceof InvalidFinancialScheduleImportError) {
      return void res.status(400).json({ error: "De roosterkeuzes zijn intussen ongeldig. Maak een nieuwe preview met het actuele sjabloon." });
    }
    throw error;
  }
}

router.post(
  "/admin/financial/participants/:participantId/seasons/:seasonId/imports/teachers/confirm",
  signedInMiddleware,
  adminMiddleware,
  async (req, res) => {
    const participantId = pathParticipantId(req.params.participantId);
    const seasonId = pathSeasonId(req.params.seasonId);
    if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
    return confirmImport(req, res, participantId, seasonId, "teachers");
  },
);

router.post(
  "/admin/financial/participants/:participantId/seasons/:seasonId/imports/subscriptions/confirm",
  signedInMiddleware,
  adminMiddleware,
  async (req, res) => {
    const participantId = pathParticipantId(req.params.participantId);
    const seasonId = pathSeasonId(req.params.seasonId);
    if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
    return confirmImport(req, res, participantId, seasonId, "subscriptions");
  },
);

router.post(
  "/admin/financial/participants/:participantId/seasons/:seasonId/imports/schedule/confirm",
  signedInMiddleware,
  adminMiddleware,
  async (req, res) => {
    const participantId = pathParticipantId(req.params.participantId);
    const seasonId = pathSeasonId(req.params.seasonId);
    if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
    return confirmScheduleImport(req, res, participantId, seasonId);
  },
);

router.get("/admin/financial/participants/:participantId/seasons", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  if (participantId == null) return void res.status(400).json({ error: "Ongeldige deelnemer." });
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  const seasons = await db.select().from(financialSeasonsTable)
    .where(eq(financialSeasonsTable.participantId, participantId))
    .orderBy(asc(financialSeasonsTable.startDate));
  res.json(seasons.map(seasonView));
});
router.post("/admin/financial/participants/:participantId/seasons", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  if (participantId == null) return void res.status(400).json({ error: "Ongeldige deelnemer." });
  const parsedInput = CreateFinancialSeasonBody.safeParse(req.body);
  if (!parsedInput.success) return void res.status(400).json({ error: "Ongeldige seizoen-stamgegevens of verwijzing." });
  const input = parsedInput.data;
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  try {
    const season = await db.transaction(async (tx) => {
      const [created] = await tx.insert(financialSeasonsTable).values({
        participantId,
        name: input.name,
        startDate: dateValue(input.startDate),
        endDate: dateValue(input.endDate),
        country: input.country,
        hasStarterDeduction: input.hasStarterDeduction,
        defaultSalaryCents: toCents(input.defaultSalary),
      }).returning();
      await saveMaster(tx, created.id, input);
      return created;
    });
    res.status(201).json(seasonView(season));
  } catch {
    res.status(400).json({ error: "Ongeldige seizoen-stamgegevens of verwijzing." });
  }
});
router.get("/admin/financial/participants/:participantId/seasons/:seasonId", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  const seasonId = pathSeasonId(req.params.seasonId);
  if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  const season = await ownedSeason(participantId, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  res.json(await detail(season));
});
router.put("/admin/financial/participants/:participantId/seasons/:seasonId", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  const seasonId = pathSeasonId(req.params.seasonId);
  if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
  const parsedInput = UpdateFinancialSeasonBody.safeParse(req.body);
  if (!parsedInput.success) return void res.status(400).json({ error: "Ongeldige seizoen-stamgegevens of verwijzing." });
  const input = parsedInput.data;
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  const season = await ownedSeason(participantId, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  try {
    const updated = await db.transaction(async (tx) => {
      await lockFinancialSeasonMasterData(tx, season.id);
      await beforeFinancialSeasonMasterSave?.();
      const [currentSeason] = await tx.select().from(financialSeasonsTable)
        .where(and(
          eq(financialSeasonsTable.id, season.id),
          eq(financialSeasonsTable.participantId, participantId),
        ))
        .limit(1);
      if (!currentSeason) throw new Error("FINANCIAL_SEASON_NOT_FOUND");
      if (input.expectedUpdatedAt.toISOString() !== currentSeason.updatedAt.toISOString()) throw new FinancialSeasonConflictError();
      const updatedAt = new Date(Math.max(Date.now(), currentSeason.updatedAt.getTime() + 1));
      const [saved] = await tx.update(financialSeasonsTable).set({
        name: input.name,
        startDate: dateValue(input.startDate),
        endDate: dateValue(input.endDate),
        country: input.country,
        hasStarterDeduction: input.hasStarterDeduction,
        defaultSalaryCents: toCents(input.defaultSalary),
        updatedAt,
      }).where(and(
        eq(financialSeasonsTable.id, season.id),
        eq(financialSeasonsTable.participantId, participantId),
      )).returning();
      await saveMaster(tx, saved.id, input);
      return saved;
    });
    res.json(await detail(updated));
  } catch (error) {
    if (error instanceof FinancialSeasonConflictError) return void res.status(409).json({ error: "Dit seizoen is intussen door iemand anders gewijzigd. Vernieuw het seizoen en controleer de nieuwste gegevens voordat je opnieuw opslaat." });
    res.status(400).json({ error: "Ongeldige seizoen-stamgegevens of verwijzing." });
  }
});
router.get("/admin/financial/participants/:participantId/seasons/:seasonId/months/:month", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  const seasonId = pathSeasonId(req.params.seasonId);
  if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  const season = await ownedSeason(participantId, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  const requestedMonth = String(req.params.month);
  if (!validMonth(requestedMonth) || requestedMonth < season.startDate.slice(0, 7) + "-01" || requestedMonth > season.endDate.slice(0, 7) + "-01") return void res.status(400).json({ error: "Ongeldige maand buiten dit seizoen." });
  const result = (await calculatedMonths(season, requestedMonth)).find(x => x.month === requestedMonth);
  res.json(result && publicMonth(result));
});
router.put("/admin/financial/participants/:participantId/seasons/:seasonId/months/:month", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  const seasonId = pathSeasonId(req.params.seasonId);
  if (participantId == null || seasonId == null) return void res.status(400).json({ error: "Ongeldige deelnemer of seizoen." });
  const parsedInput = UpsertFinancialMonthBody.safeParse(req.body);
  if (!parsedInput.success) return void res.status(400).json({ error: parsedInput.error.message });
  const input = parsedInput.data as typeof parsedInput.data & { expectedUpdatedAt: Date | null };
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  const season = await ownedSeason(participantId, seasonId);
  if (!season) return void res.status(404).json({ error: "Seizoen niet gevonden." });
  const requestedMonth = String(req.params.month);
  if (!validMonth(requestedMonth)) return void res.status(400).json({ error: "Ongeldige maand buiten dit seizoen." });
  try {
    const saved = await db.transaction(async (tx) => {
      await lockFinancialSeasonMasterData(tx, season.id);
      await tx.execute(sql`select pg_advisory_xact_lock(${season.id}, hashtext(${requestedMonth}))`);
      const [currentSeason] = await tx.select().from(financialSeasonsTable)
        .where(and(
          eq(financialSeasonsTable.id, season.id),
          eq(financialSeasonsTable.participantId, participantId),
        ))
        .limit(1);
      if (!currentSeason) throw new Error("FINANCIAL_SEASON_NOT_FOUND");
      if (requestedMonth < currentSeason.startDate.slice(0, 7) + "-01" || requestedMonth > currentSeason.endDate.slice(0, 7) + "-01") throw new InvalidFinancialMonthError();
      const [existing] = await tx.select().from(financialMonthsTable)
        .where(and(
          eq(financialMonthsTable.seasonId, season.id),
          eq(financialMonthsTable.month, requestedMonth),
        ))
        .limit(1);
      const lessonInputs = input.lessonInputs.map(item => ({
        lessonId: item.lessonId,
        attendance: item.attendance ?? null,
        lessonCountOverride: item.lessonCountOverride ?? null,
      }));
      const existingSnapshot = existing?.masterDataSnapshot != null
        ? normalizeFinancialMonthSnapshot(existing.masterDataSnapshot as {
          formatVersion?: number;
          teachers?: Array<typeof financialTeachersTable.$inferSelect>;
          locations?: Array<typeof financialLocationsTable.$inferSelect>;
          subscriptions?: Array<typeof financialSubscriptionsTable.$inferSelect>;
          lessons?: Array<typeof financialLessonsTable.$inferSelect>;
          closures?: Array<typeof financialClosuresTable.$inferSelect>;
          seasonStartDate?: string;
          seasonEndDate?: string;
          country?: "Nederland" | "België";
          hasStarterDeduction?: boolean;
          defaultSalaryCents?: number;
          lessonInputs?: Array<{ lessonId: number; attendance: number | null; lessonCountOverride: number | null }>;
        })
        : null;
      const snapshot = existingSnapshot
        ? { ...existingSnapshot, lessonInputs }
        : await buildFinancialMonthSnapshot(tx, currentSeason, lessonInputs);
      const snapshotLessons = snapshot.lessons;
      if (!snapshotLessons) throw new Error("INVALID_FINANCIAL_SNAPSHOT");
      const lessonIds = new Set(snapshotLessons.map(lesson => lesson.id));
      if (input.lessonInputs.some(item => !lessonIds.has(item.lessonId))) throw new Error("INVALID_MONTH_LESSON");
      const actualUpdatedAt = existing?.updatedAt.toISOString() ?? null;
      if ((input.expectedUpdatedAt?.toISOString() ?? null) !== actualUpdatedAt) throw new FinancialMonthConflictError();
      const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
      const values = {
        contributionRevenueCents: toCents(input.contributionRevenue),
        taxArrearsCents: toCents(input.taxArrears),
        salaryOverrideCents: input.salaryOverride == null ? null : toCents(input.salaryOverride),
        masterDataSnapshot: snapshot,
        updatedAt,
      };
      const [month] = await tx.insert(financialMonthsTable)
        .values({ seasonId: season.id, month: requestedMonth, ...values })
        .onConflictDoUpdate({
          target: [financialMonthsTable.seasonId, financialMonthsTable.month],
          set: values,
        })
        .returning();
      await tx.delete(financialFixedCostsTable).where(eq(financialFixedCostsTable.financialMonthId, month.id));
      await tx.delete(financialActivitiesTable).where(eq(financialActivitiesTable.financialMonthId, month.id));
      await tx.delete(financialLessonMonthInputsTable).where(eq(financialLessonMonthInputsTable.financialMonthId, month.id));
      if (input.fixedCosts.length) await tx.insert(financialFixedCostsTable).values(input.fixedCosts.map((x, sortOrder) => ({ financialMonthId: month.id, costGroup: x.group, category: x.description, frequency: x.frequency, amountCents: toCents(x.amount), sortOrder })));
      if (input.activities.length) await tx.insert(financialActivitiesTable).values(input.activities.map(x => ({ financialMonthId: month.id, name: x.name, amountCents: toCents(x.amount) })));
      if (input.lessonInputs.length) await tx.insert(financialLessonMonthInputsTable).values(input.lessonInputs.map(x => ({ financialMonthId: month.id, lessonId: x.lessonId, attendance: x.attendance ?? null, lessonCountOverride: x.lessonCountOverride ?? null })));
      return { updatedAt: month.updatedAt.toISOString(), season: currentSeason };
    });
    await beforeFinancialMonthResponse?.(saved.updatedAt);
    const result = (await calculatedMonths(saved.season)).find(x => x.month === requestedMonth);
    res.json(result && { ...publicMonth(result), updatedAt: saved.updatedAt });
  } catch (error) {
    if (error instanceof FinancialMonthConflictError) return void res.status(409).json({ error: "Deze maand is intussen door iemand anders gewijzigd. Vernieuw de maand en controleer de nieuwste gegevens voordat je opnieuw opslaat." });
    if (error instanceof InvalidFinancialMonthError) return void res.status(400).json({ error: "Ongeldige maand buiten dit seizoen." });
    if (error instanceof Error && error.message === "INVALID_MONTH_LESSON") return void res.status(400).json({ error: "Een lesinvoer hoort niet bij dit seizoen." });
    throw error;
  }
});
router.get("/admin/financial/participants/:participantId/tax-years/:calendarYear", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  const calendarYear = pathCalendarYear(req.params.calendarYear);
  if (participantId == null) return void res.status(400).json({ error: "Ongeldige deelnemer." });
  if (calendarYear == null) return void res.status(400).json({ error: "Ongeldig belastingjaar." });
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  try {
    res.json(await taxYearSummary(participantId, calendarYear));
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CALENDAR_MONTH") return void res.status(409).json({ error: "Dezelfde kalendermaand staat in meerdere seizoenen. Los de overlap op voordat de jaarbelasting wordt geschat." });
    throw error;
  }
});
router.put("/admin/financial/participants/:participantId/tax-years/:calendarYear", signedInMiddleware, adminMiddleware, async (req, res) => {
  const participantId = pathParticipantId(req.params.participantId);
  const calendarYear = pathCalendarYear(req.params.calendarYear);
  if (participantId == null) return void res.status(400).json({ error: "Ongeldige deelnemer." });
  if (calendarYear == null) return void res.status(400).json({ error: "Ongeldig belastingjaar." });
  const parsedInput = UpdateFinancialTaxYearBody.safeParse(req.body);
  if (!parsedInput.success) return void res.status(400).json({ error: parsedInput.error.message });
  const input = parsedInput.data as typeof parsedInput.data & { expectedUpdatedAt: Date | null };
  if (!await participantById(participantId)) return void res.status(404).json({ error: "Deelnemer niet gevonden." });
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${participantId}, ${calendarYear})`);
      const [existing] = await tx.select().from(financialTaxYearsTable)
        .where(and(
          eq(financialTaxYearsTable.participantId, participantId),
          eq(financialTaxYearsTable.calendarYear, calendarYear),
        ))
        .limit(1);
      if ((input.expectedUpdatedAt?.toISOString() ?? null) !== (existing?.updatedAt.toISOString() ?? null)) throw new FinancialTaxYearConflictError();
      const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
      await tx.insert(financialTaxYearsTable).values({
        participantId,
        calendarYear,
        preliminaryPaymentsCents: toCents(input.preliminaryPayments),
        updatedAt,
      }).onConflictDoUpdate({
        target: [financialTaxYearsTable.participantId, financialTaxYearsTable.calendarYear],
        set: { preliminaryPaymentsCents: toCents(input.preliminaryPayments), updatedAt },
      });
    });
    res.json(await taxYearSummary(participantId, calendarYear));
  } catch (error) {
    if (error instanceof FinancialTaxYearConflictError) return void res.status(409).json({ error: "De vooruitbetalingen voor dit belastingjaar zijn intussen gewijzigd. Vernieuw en controleer het nieuwste bedrag." });
    throw error;
  }
});
router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    return void res.status(422).json({ valid: false, errors: [error.code === "LIMIT_FILE_SIZE" ? "Het bestand is te groot (maximaal 10 MB)." : "Het uploadbestand kan niet worden verwerkt."] });
  }
  if (error instanceof UnsupportedFinancialSnapshotFormatError) {
    return void res.status(422).json({
      code: UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT_ERROR_CODE,
      error: "Deze financiële maand gebruikt een niet-ondersteunde gegevensversie.",
    });
  }
  if (
    error instanceof Error
    && (
      error.message.startsWith("INVALID_SAVED_MONTH:")
      || error.message.startsWith("INVALID_SAVED_LESSON_PROFITABILITY:")
    )
  ) {
    return void res.status(422).json({
      code: INVALID_FINANCIAL_HISTORY_ERROR_CODE,
      error: "De opgeslagen financiële historie van dit seizoen is beschadigd. Herstel de opgeslagen maandgegevens voordat je verdergaat.",
    });
  }
  next(error);
});
return router;
}

export default createFinancialRouter();
