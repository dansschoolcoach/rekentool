import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialTaxYearSummary, TAX_CALCULATION_VERSION } from "./financialTaxYear.ts";

const month = (value: string, grossProfitCents = 100_000, country: "Nederland" | "België" = "Nederland") => ({
  month: value,
  grossProfitCents,
  country,
  hasStarterDeduction: false,
});

test("calendar-year summary combines months independently from dance seasons", () => {
  const months = Array.from({ length: 12 }, (_, index) => month(`2026-${String(index + 1).padStart(2, "0")}-01`));
  const summary = buildFinancialTaxYearSummary({
    calendarYear: 2026,
    months,
    preliminaryPaymentsCents: 50_000,
    updatedAt: null,
  });
  assert.equal(summary.calculationVersion, TAX_CALCULATION_VERSION);
  assert.equal(summary.isComplete, true);
  assert.equal(summary.coveredMonths.length, 12);
  assert.equal(summary.grossProfit, 12_000);
  assert.equal(summary.extraToSave, Math.max(0, summary.estimatedTax - 500));
});

test("incomplete calendar years name every missing month and never annualize silently", () => {
  const summary = buildFinancialTaxYearSummary({
    calendarYear: 2026,
    months: [month("2026-09-01", 300_000), month("2026-10-01", 200_000)],
    preliminaryPaymentsCents: 0,
    updatedAt: null,
  });
  assert.equal(summary.grossProfit, 5_000);
  assert.equal(summary.isComplete, false);
  assert.equal(summary.missingMonths.length, 10);
  assert.ok(summary.missingMonths.includes("2026-01-01"));
});

test("preliminary payments reduce only the remaining savings advice", () => {
  const base = buildFinancialTaxYearSummary({
    calendarYear: 2026,
    months: [month("2026-01-01", 5_000_000)],
    preliminaryPaymentsCents: 0,
    updatedAt: null,
  });
  const paid = buildFinancialTaxYearSummary({
    calendarYear: 2026,
    months: [month("2026-01-01", 5_000_000)],
    preliminaryPaymentsCents: Math.round(base.estimatedTax * 100),
    updatedAt: null,
  });
  assert.equal(paid.estimatedTax, base.estimatedTax);
  assert.equal(paid.extraToSave, 0);
});

test("mixed countries are reported and duplicate calendar months are rejected", () => {
  const mixed = buildFinancialTaxYearSummary({
    calendarYear: 2026,
    months: [month("2026-01-01"), month("2026-02-01", 100_000, "België")],
    preliminaryPaymentsCents: 0,
    updatedAt: null,
  });
  assert.equal(mixed.hasCountryConflict, true);
  assert.equal(mixed.country, null);
  assert.throws(() => buildFinancialTaxYearSummary({
    calendarYear: 2026,
    months: [month("2026-01-01"), month("2026-01-01")],
    preliminaryPaymentsCents: 0,
    updatedAt: null,
  }), /DUPLICATE_CALENDAR_MONTH/);
});