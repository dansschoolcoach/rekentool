import { annualTaxReserveCents, type TaxCountry } from "./financialCalculations.ts";

export const TAX_CALCULATION_VERSION = "2026";

export function buildFinancialTaxYearSummary(input: {
  calendarYear: number;
  months: Array<{ month: string; grossProfitCents: number; country: TaxCountry; hasStarterDeduction: boolean }>;
  preliminaryPaymentsCents: number;
  updatedAt: Date | null;
}) {
  const byMonth = new Map<string, typeof input.months[number]>();
  for (const month of input.months) {
    if (byMonth.has(month.month)) throw new Error("DUPLICATE_CALENDAR_MONTH");
    byMonth.set(month.month, month);
  }
  const coveredMonths = [...byMonth.keys()].sort();
  const expectedMonths = Array.from({ length: 12 }, (_, index) => `${input.calendarYear}-${String(index + 1).padStart(2, "0")}-01`);
  const missingMonths = expectedMonths.filter(month => !byMonth.has(month));
  const countries = new Set([...byMonth.values()].map(month => month.country));
  const hasCountryConflict = countries.size > 1;
  const country = hasCountryConflict ? null : countries.values().next().value ?? null;
  const grossProfitCents = [...byMonth.values()].reduce((sum, month) => sum + month.grossProfitCents, 0);
  const hasStarterDeduction = [...byMonth.values()].some(month => month.hasStarterDeduction);
  const calculationVersion = input.calendarYear <= 2025 ? "2025" : TAX_CALCULATION_VERSION;
  const estimatedTaxCents = country ? annualTaxReserveCents(country, grossProfitCents, hasStarterDeduction, input.calendarYear) : 0;
  return {
    calendarYear: input.calendarYear,
    calculationVersion,
    country,
    hasCountryConflict,
    grossProfit: grossProfitCents / 100,
    estimatedTax: estimatedTaxCents / 100,
    effectiveReservePercentage: grossProfitCents > 0 ? estimatedTaxCents / grossProfitCents * 100 : 0,
    preliminaryPayments: input.preliminaryPaymentsCents / 100,
    extraToSave: Math.max(0, estimatedTaxCents - input.preliminaryPaymentsCents) / 100,
    coveredMonths,
    missingMonths,
    isComplete: missingMonths.length === 0,
    updatedAt: input.updatedAt?.toISOString() ?? null,
  };
}