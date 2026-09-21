import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION,
  FinancialSnapshotBackfillReportSchema,
  LEGACY_FINANCIAL_SNAPSHOT_FORMAT_VERSION,
  normalizeFinancialMonthSnapshot,
  UnsupportedFinancialSnapshotFormatError,
} from "./financialSnapshot.ts";
import { selectSnapshotCalculationContext } from "./financialCalculations.ts";

const savedFields = {
  country: "België" as const,
  hasStarterDeduction: false,
  defaultSalaryCents: 123400,
  lessonInputs: [{ lessonId: 7, attendance: 12, lessonCountOverride: 3 as number | null }],
};

test("legacy and current snapshots produce the same saved calculation context", () => {
  const legacy = normalizeFinancialMonthSnapshot(savedFields);
  const current = normalizeFinancialMonthSnapshot({
    formatVersion: CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION,
    ...savedFields,
  });
  const live = {
    settings: { country: "Nederland" as const, hasStarterDeduction: true, defaultSalaryCents: 999900 },
    lessonInputs: [{ lessonId: 99, attendance: 1, lessonCountOverride: null as number | null }],
  };

  assert.equal(legacy?.formatVersion, LEGACY_FINANCIAL_SNAPSHOT_FORMAT_VERSION);
  assert.equal(current?.formatVersion, CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION);
  assert.deepEqual(
    selectSnapshotCalculationContext(legacy, live.settings, live.lessonInputs),
    selectSnapshotCalculationContext(current, live.settings, live.lessonInputs),
  );
});

test("unknown explicit snapshot versions are not silently interpreted", () => {
  assert.throws(
    () => normalizeFinancialMonthSnapshot({ formatVersion: 2 }),
    UnsupportedFinancialSnapshotFormatError,
  );
});

test("backfill report schema accepts valid reports", () => {
  const report = {
    found: 1,
    legacyMonths: [{ monthId: 12, seasonId: 3, month: "2026-08" }],
    migrated: 0,
    skippedBecauseAlreadySnapshotted: 0,
    nonMigratable: [{ monthId: 12, reason: "SEASON_NOT_FOUND" }],
  };

  assert.equal(FinancialSnapshotBackfillReportSchema.parse(report), report);
});

test("backfill report schema rejects negative, fractional, and unsafe counts", () => {
  const validReport = {
    found: 0,
    legacyMonths: [],
    migrated: 0,
    skippedBecauseAlreadySnapshotted: 0,
    nonMigratable: [],
  };

  for (const field of [
    "found",
    "migrated",
    "skippedBecauseAlreadySnapshotted",
  ] as const) {
    for (const invalidValue of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => FinancialSnapshotBackfillReportSchema.parse({
          ...validReport,
          [field]: invalidValue,
        }),
        new RegExp(
          `INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:${field} must be a safe non-negative integer`,
        ),
      );
    }
  }
});

test("backfill report schema rejects non-positive, fractional, and unsafe database IDs", () => {
  const cases = [
    {
      path: "legacyMonths[0].monthId",
      report: {
        found: 1,
        legacyMonths: [{ monthId: 12, seasonId: 3, month: "2026-08" }],
        migrated: 1,
        skippedBecauseAlreadySnapshotted: 0,
        nonMigratable: [],
      },
      change: (report: Record<string, unknown>, invalidValue: number) => {
        (report.legacyMonths as Array<Record<string, unknown>>)[0].monthId = invalidValue;
      },
    },
    {
      path: "legacyMonths[0].seasonId",
      report: {
        found: 1,
        legacyMonths: [{ monthId: 12, seasonId: 3, month: "2026-08" }],
        migrated: 1,
        skippedBecauseAlreadySnapshotted: 0,
        nonMigratable: [],
      },
      change: (report: Record<string, unknown>, invalidValue: number) => {
        (report.legacyMonths as Array<Record<string, unknown>>)[0].seasonId = invalidValue;
      },
    },
    {
      path: "nonMigratable[0].monthId",
      report: {
        found: 1,
        legacyMonths: [{ monthId: 12, seasonId: 3, month: "2026-08" }],
        migrated: 0,
        skippedBecauseAlreadySnapshotted: 0,
        nonMigratable: [{ monthId: 12, reason: "SEASON_NOT_FOUND" }],
      },
      change: (report: Record<string, unknown>, invalidValue: number) => {
        (report.nonMigratable as Array<Record<string, unknown>>)[0].monthId = invalidValue;
      },
    },
  ];

  for (const { path, report, change } of cases) {
    for (const invalidValue of [-1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalidReport = structuredClone(report) as Record<string, unknown>;
      change(invalidReport, invalidValue);

      assert.throws(
        () => FinancialSnapshotBackfillReportSchema.parse(invalidReport),
        new RegExp(
          `INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:${path.replaceAll("[", "\\[").replaceAll("]", "\\]")} must be a safe positive integer`,
        ),
      );
    }
  }
});

test("backfill report schema rejects unknown non-migratable reasons", () => {
  assert.throws(
    () => FinancialSnapshotBackfillReportSchema.parse({
      found: 1,
      legacyMonths: [{ monthId: 12, seasonId: 3, month: "2026-08" }],
      migrated: 0,
      skippedBecauseAlreadySnapshotted: 0,
      nonMigratable: [{ monthId: 12, reason: "CORRUPTED_REASON" }],
    }),
    /INVALID_FINANCIAL_SNAPSHOT_BACKFILL_REPORT:unknown nonMigratable reason CORRUPTED_REASON/,
  );
});

test("backfill report schema rejects contradictory totals", () => {
  assert.throws(
    () => FinancialSnapshotBackfillReportSchema.parse({
      found: 4,
      legacyMonths: [
        { monthId: 12, seasonId: 3, month: "2026-08" },
        { monthId: 13, seasonId: 3, month: "2026-09" },
        { monthId: 14, seasonId: 3, month: "2026-10" },
        { monthId: 15, seasonId: 3, month: "2026-11" },
      ],
      migrated: 1,
      skippedBecauseAlreadySnapshotted: 1,
      nonMigratable: [{ monthId: 12, reason: "SEASON_NOT_FOUND" }],
    }),
    /found \(4\) must equal migrated \(1\) \+ skippedBecauseAlreadySnapshotted \(1\) \+ nonMigratable\.length \(1\) = 3/,
  );
});

test("backfill report schema rejects a detail overview whose length differs from found", () => {
  const legacyMonths = [
    { monthId: 12, seasonId: 3, month: "2026-08" },
    { monthId: 13, seasonId: 3, month: "2026-09" },
  ];

  for (const detailOverview of [legacyMonths.slice(0, 1), [...legacyMonths, {
    monthId: 14,
    seasonId: 3,
    month: "2026-10",
  }]]) {
    assert.throws(
      () => FinancialSnapshotBackfillReportSchema.parse({
        found: 2,
        legacyMonths: detailOverview,
        migrated: 2,
        skippedBecauseAlreadySnapshotted: 0,
        nonMigratable: [],
      }),
      new RegExp(`found \\(2\\) must equal legacyMonths\\.length \\(${detailOverview.length}\\)`),
    );
  }
});