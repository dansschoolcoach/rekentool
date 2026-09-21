import test from "node:test";
import assert from "node:assert/strict";
import { annualTaxReserveCents, scheduledLessonCount, selectSnapshotCalculationContext } from "./financialCalculations.ts";

test("calendar excludes closure dates and dates outside a lesson period", () => {
  assert.equal(scheduledLessonCount("2025-09-01", { id: 1, weekday: 1, activeFrom: "2025-09-01", activeUntil: "2025-09-30" }, [{ startDate: "2025-09-08", endDate: "2025-09-14" }]), 4);
});

test("Dutch and Belgian tax reserves remain non-negative around bracket boundaries", () => {
  for (const country of ["Nederland", "België"] as const) {
    for (const euros of [0, 10160, 11491, 16861.46, 24821, 39958, 72810.95, 76817, 107300.3]) {
      const result = annualTaxReserveCents(country, Math.round(euros * 100), true);
      assert.ok(Number.isFinite(result) && result >= 0, `${country}: ${euros}`);
    }
  }
});

test("saved calculation context wins over edited season settings and missing live inputs", () => {
  const result = selectSnapshotCalculationContext(
    { country: "België", hasStarterDeduction: false, defaultSalaryCents: 123400, lessonInputs: [{ lessonId: 7, attendance: 12, lessonCountOverride: 3 }] },
    { country: "Nederland", hasStarterDeduction: true, defaultSalaryCents: 999900 },
    [],
  );
  assert.equal(result.country, "België");
  assert.equal(result.hasStarterDeduction, false);
  assert.equal(result.defaultSalaryCents, 123400);
  assert.deepEqual(result.lessonInputs, [{ lessonId: 7, attendance: 12, lessonCountOverride: 3 }]);
});

test("legacy snapshots fall back to current season settings and live lesson inputs", () => {
  const live = [{ lessonId: 2, attendance: 5, lessonCountOverride: null }];
  const result = selectSnapshotCalculationContext({}, { country: "Nederland", hasStarterDeduction: true, defaultSalaryCents: 250000 }, live);
  assert.deepEqual(result, { country: "Nederland", hasStarterDeduction: true, defaultSalaryCents: 250000, lessonInputs: live });
});