import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db as defaultDb,
  financialClosuresTable,
  financialLessonMonthInputsTable,
  financialLessonsTable,
  financialLocationsTable,
  financialMonthsTable,
  financialSeasonsTable,
  financialSubscriptionsTable,
  financialTeachersTable,
} from "@workspace/db";

type Database = typeof defaultDb;
type Queryable = Pick<Database, "select" | "update">;

export const lockFinancialSeasonMasterData = (database: Pick<Database, "execute">, seasonId: number) =>
  database.execute(sql`select pg_advisory_xact_lock(${seasonId}, hashtext('financial-season-master-data'))`);

export const CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION = 1 as const;
export const LEGACY_FINANCIAL_SNAPSHOT_FORMAT_VERSION = 0 as const;
export const UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT_ERROR_CODE =
  "UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT" as const;
export const FINANCIAL_SNAPSHOT_NON_MIGRATABLE_REASONS = [
  "MONTH_NOT_FOUND",
  "SEASON_NOT_FOUND",
] as const;

export type FinancialSnapshotNonMigratableReason =
  typeof FINANCIAL_SNAPSHOT_NON_MIGRATABLE_REASONS[number];

type FinancialSnapshotFormatVersion =
  | typeof LEGACY_FINANCIAL_SNAPSHOT_FORMAT_VERSION
  | typeof CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION;

export class UnsupportedFinancialSnapshotFormatError extends Error {
  readonly code = UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT_ERROR_CODE;

  constructor() {
    super(UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT_ERROR_CODE);
    this.name = "UnsupportedFinancialSnapshotFormatError";
  }
}

/**
 * Converts persisted JSON to the versioned read model. Version-less snapshots
 * are the legacy format; unknown explicit versions fail instead of being
 * interpreted with today's calculation rules.
 */
export function normalizeFinancialMonthSnapshot<T extends object>(
  snapshot: T | null | undefined,
): (T & { formatVersion: FinancialSnapshotFormatVersion }) | null {
  if (snapshot == null) return null;
  const formatVersion = "formatVersion" in snapshot
    ? (snapshot as { formatVersion?: unknown }).formatVersion
    : LEGACY_FINANCIAL_SNAPSHOT_FORMAT_VERSION;
  if (
    formatVersion !== LEGACY_FINANCIAL_SNAPSHOT_FORMAT_VERSION
    && formatVersion !== CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION
  ) {
    throw new UnsupportedFinancialSnapshotFormatError();
  }
  return { ...snapshot, formatVersion };
}

async function orderedMasterData(database: Queryable, seasonId: number) {
  // Keep these sequential: a transaction uses one pg client and cannot safely
  // execute multiple queries concurrently.
  const teachers = await database.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId)).orderBy(asc(financialTeachersTable.id));
  const locations = await database.select().from(financialLocationsTable).where(eq(financialLocationsTable.seasonId, seasonId)).orderBy(asc(financialLocationsTable.id));
  const subscriptions = await database.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId)).orderBy(asc(financialSubscriptionsTable.id));
  const lessons = await database.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId)).orderBy(asc(financialLessonsTable.id));
  const closures = await database.select().from(financialClosuresTable).where(eq(financialClosuresTable.seasonId, seasonId)).orderBy(asc(financialClosuresTable.id));
  return { teachers, locations, subscriptions, lessons, closures };
}

export async function buildFinancialMonthSnapshot(
  database: Queryable,
  season: typeof financialSeasonsTable.$inferSelect,
  lessonInputs: Array<{ lessonId: number; attendance: number | null; lessonCountOverride: number | null }>,
) {
  return {
    formatVersion: CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION,
    ...await orderedMasterData(database, season.id),
    seasonStartDate: season.startDate,
    seasonEndDate: season.endDate,
    country: season.country,
    hasStarterDeduction: season.hasStarterDeduction,
    defaultSalaryCents: season.defaultSalaryCents,
    lessonInputs: [...lessonInputs].sort((a, b) => a.lessonId - b.lessonId),
  };
}

export type FinancialSnapshotBackfillReport = {
  found: number;
  legacyMonths: Array<{ monthId: number; seasonId: number; month: string }>;
  migrated: number;
  skippedBecauseAlreadySnapshotted: number;
  nonMigratable: Array<{
    monthId: number;
    reason: FinancialSnapshotNonMigratableReason;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafePositiveInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:${path} must be a safe positive integer`,
    );
  }
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:${path} must be a safe non-negative integer`,
    );
  }
}

/**
 * Runtime boundary for persisted, transported, or externally supplied backfill
 * reports. Keep the reason enum tied to FINANCIAL_SNAPSHOT_NON_MIGRATABLE_REASONS.
 */
export const FinancialSnapshotBackfillReportSchema = {
  parse(value: unknown): FinancialSnapshotBackfillReport {
    if (!isRecord(value)) {
      throw new Error("INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:report must be an object");
    }
    assertNonNegativeInteger(value.found, "found");
    assertNonNegativeInteger(value.migrated, "migrated");
    assertNonNegativeInteger(
      value.skippedBecauseAlreadySnapshotted,
      "skippedBecauseAlreadySnapshotted",
    );
    if (!Array.isArray(value.legacyMonths)) {
      throw new Error("INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:legacyMonths must be an array");
    }
    value.legacyMonths.forEach((month, index) => {
      if (!isRecord(month)) {
        throw new Error(`INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:legacyMonths[${index}] must be an object`);
      }
      assertSafePositiveInteger(month.monthId, `legacyMonths[${index}].monthId`);
      assertSafePositiveInteger(month.seasonId, `legacyMonths[${index}].seasonId`);
      if (typeof month.month !== "string") {
        throw new Error(`INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:legacyMonths[${index}].month must be a string`);
      }
    });
    if (value.found !== value.legacyMonths.length) {
      throw new Error(
        "INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:"
        + `found (${value.found}) must equal legacyMonths.length (${value.legacyMonths.length})`,
      );
    }
    if (!Array.isArray(value.nonMigratable)) {
      throw new Error("INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:nonMigratable must be an array");
    }
    value.nonMigratable.forEach((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:nonMigratable[${index}] must be an object`);
      }
      assertSafePositiveInteger(item.monthId, `nonMigratable[${index}].monthId`);
      if (
        typeof item.reason !== "string"
        || !FINANCIAL_SNAPSHOT_NON_MIGRATABLE_REASONS.includes(
          item.reason as FinancialSnapshotNonMigratableReason,
        )
      ) {
        throw new Error(
          `INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:unknown nonMigratable reason ${String(item.reason)}`,
        );
      }
    });
    const accountedFor =
      value.migrated
      + value.skippedBecauseAlreadySnapshotted
      + value.nonMigratable.length;
    if (value.found !== accountedFor) {
      throw new Error(
        "INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:"
        + `found (${value.found}) must equal migrated (${value.migrated})`
        + ` + skippedBecauseAlreadySnapshotted (${value.skippedBecauseAlreadySnapshotted})`
        + ` + nonMigratable.length (${value.nonMigratable.length}) = ${accountedFor}`,
      );
    }
    return value as FinancialSnapshotBackfillReport;
  },
};

/** Re-runnable data migration: populated snapshots are never overwritten. */
export async function backfillLegacyFinancialMonthSnapshots(
  database: Database = defaultDb,
): Promise<FinancialSnapshotBackfillReport> {
  const legacyMonths = await database.select()
    .from(financialMonthsTable)
    .where(isNull(financialMonthsTable.masterDataSnapshot))
    .orderBy(asc(financialMonthsTable.id));
  const report: FinancialSnapshotBackfillReport = {
    found: legacyMonths.length,
    legacyMonths: legacyMonths.map(item => ({
      monthId: item.id,
      seasonId: item.seasonId,
      month: item.month,
    })),
    migrated: 0,
    skippedBecauseAlreadySnapshotted: 0,
    nonMigratable: [],
  };

  for (const legacyMonth of legacyMonths) {
    await database.transaction(async (tx) => {
      // Match season edits and ordinary month saves: the season lock always
      // comes first, so every snapshot observes one committed master-data version.
      await lockFinancialSeasonMasterData(tx, legacyMonth.seasonId);
      const [currentMonth] = await tx.select().from(financialMonthsTable)
        .where(eq(financialMonthsTable.id, legacyMonth.id))
        .limit(1);
      if (!currentMonth) {
        report.nonMigratable.push({ monthId: legacyMonth.id, reason: "MONTH_NOT_FOUND" });
        return;
      }
      if (currentMonth.masterDataSnapshot != null) {
        report.skippedBecauseAlreadySnapshotted += 1;
        return;
      }
      const [season] = await tx.select().from(financialSeasonsTable)
        .where(eq(financialSeasonsTable.id, currentMonth.seasonId))
        .limit(1);
      if (!season) {
        report.nonMigratable.push({ monthId: currentMonth.id, reason: "SEASON_NOT_FOUND" });
        return;
      }
      const inputs = await tx.select({
        lessonId: financialLessonMonthInputsTable.lessonId,
        attendance: financialLessonMonthInputsTable.attendance,
        lessonCountOverride: financialLessonMonthInputsTable.lessonCountOverride,
      }).from(financialLessonMonthInputsTable)
        .where(eq(financialLessonMonthInputsTable.financialMonthId, currentMonth.id))
        .orderBy(asc(financialLessonMonthInputsTable.lessonId));
      const snapshot = await buildFinancialMonthSnapshot(tx as unknown as Queryable, season, inputs);
      const updated = await tx.update(financialMonthsTable)
        .set({ masterDataSnapshot: snapshot, updatedAt: new Date() })
        .where(and(
          eq(financialMonthsTable.id, currentMonth.id),
          isNull(financialMonthsTable.masterDataSnapshot),
        ))
        .returning({ id: financialMonthsTable.id });
      if (updated.length === 1) {
        report.migrated += 1;
        return;
      }
      const [monthAfterFailedUpdate] = await tx.select({
        masterDataSnapshot: financialMonthsTable.masterDataSnapshot,
      }).from(financialMonthsTable)
        .where(eq(financialMonthsTable.id, currentMonth.id))
        .limit(1);
      if (!monthAfterFailedUpdate) {
        report.nonMigratable.push({ monthId: currentMonth.id, reason: "MONTH_NOT_FOUND" });
      } else {
        report.skippedBecauseAlreadySnapshotted += 1;
      }
    });
  }
  return FinancialSnapshotBackfillReportSchema.parse(report);
}