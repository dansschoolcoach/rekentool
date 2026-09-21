export type TaxCountry = "Nederland" | "België";

export type SnapshotCalculationFields<TLessonInput> = {
  country?: TaxCountry;
  hasStarterDeduction?: boolean;
  defaultSalaryCents?: number;
  lessonInputs?: TLessonInput[];
};

/** Selects immutable saved inputs while preserving compatibility with legacy snapshots. */
export function selectSnapshotCalculationContext<TLessonInput>(
  snapshot: SnapshotCalculationFields<TLessonInput> | null | undefined,
  current: Required<Omit<SnapshotCalculationFields<TLessonInput>, "lessonInputs">>,
  liveLessonInputs: TLessonInput[],
) {
  return {
    country: snapshot?.country ?? current.country,
    hasStarterDeduction: snapshot?.hasStarterDeduction ?? current.hasStarterDeduction,
    defaultSalaryCents: snapshot?.defaultSalaryCents ?? current.defaultSalaryCents,
    lessonInputs: snapshot && Array.isArray(snapshot.lessonInputs) ? snapshot.lessonInputs : liveLessonInputs,
  };
}

export type CalendarLesson = {
  id: number;
  weekday: number;
  activeFrom: string;
  activeUntil: string;
};

export type CalendarClosure = { startDate: string; endDate: string };

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const cents = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/** Counts dates in a calendar month, inclusive of lesson period and exclusive of closures. */
export function scheduledLessonCount(month: string, lesson: CalendarLesson, closures: CalendarClosure[]) {
  const start = day(`${month.slice(0, 7)}-01`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  let result = 0;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const value = dateString(cursor);
    if (cursor.getUTCDay() !== lesson.weekday || value < lesson.activeFrom || value > lesson.activeUntil) continue;
    if (closures.some((closure) => value >= closure.startDate && value <= closure.endDate)) continue;
    result++;
  }
  return result;
}

/** Year-specific estimate for entrepreneurs below AOW age; personal circumstances are intentionally excluded. */
export function annualTaxReserveCents(country: TaxCountry, annualProfitCents: number, starterDeduction: boolean, taxYear = 2026) {
  const profit = Math.max(0, annualProfitCents) / 100;
  if (!profit) return 0;
  let reserve: number;
  if (taxYear <= 2025) {
    if (country === "Nederland") {
      const zelfstandig = -2470;
      const starter = starterDeduction ? -2123 : 0;
      const mkb = Math.min(0, -(profit + zelfstandig + starter) * 0.127);
      const taxable = Math.max(0, profit + zelfstandig + starter + mkb);
      const box1 = Math.min(76817, taxable) * 0.3664 + Math.max(0, taxable - 76817) * 0.495;
      const generalCredit = taxable <= 24813 ? 3362 : taxable <= 75518 ? Math.max(0, 3362 - 0.0663 * (taxable - 24812)) : 0;
      const labourCredit = profit < 11491 ? 0.08425 * profit : profit < 24821 ? 968 + 0.31433 * (profit - 11490) : profit < 39958 ? 5158 + 0.02471 * (profit - 24820) : profit < 124935 ? Math.max(0, 5532 - 0.0651 * (profit - 39958)) : 0;
      reserve = Math.max(0, box1 - generalCredit - labourCredit) + Math.min(71628, taxable) * 0.0532;
    } else {
      const social = profit < 16861.46 ? 898.28 * 4 : profit < 72810.95 ? profit * 0.205 : profit < 107300.3 ? profit * 0.1416 : 5148.1 * 4;
      const taxable = Math.max(0, profit - social);
      const tax = Math.min(taxable, 15200) * 0.25 + Math.max(0, Math.min(taxable, 26830) - 15200) * 0.4 + Math.max(0, Math.min(taxable, 46440) - 26830) * 0.45 + Math.max(0, taxable - 46440) * 0.5;
      reserve = Math.max(0, tax - Math.min(10160, taxable) * 0.25) + social;
    }
    return cents(reserve * 100);
  }
  if (country === "Nederland") {
    const zelfstandigen = -1200;
    const starter = starterDeduction ? -2123 : 0;
    const mkb = Math.min(0, -(profit + zelfstandigen + starter) * 0.127);
    const taxable = Math.max(0, profit + zelfstandigen + starter + mkb);
    const box1 = Math.min(38883, taxable) * 0.3575
      + Math.max(0, Math.min(78426, taxable) - 38883) * 0.3756
      + Math.max(0, taxable - 78426) * 0.495;
    const generalCredit = taxable <= 29736 ? 3115 : taxable <= 78426 ? Math.max(0, 3115 - 0.06398 * (taxable - 29736)) : 0;
    const labourCredit = profit <= 11965 ? 0.08324 * profit
      : profit <= 25845 ? 996 + 0.31009 * (profit - 11965)
        : profit <= 45592 ? 5300 + 0.0195 * (profit - 25845)
          : profit <= 132920 ? Math.max(0, 5685 - 0.0651 * (profit - 45592)) : 0;
    reserve = Math.max(0, box1 - generalCredit - labourCredit) + Math.min(79409, taxable) * 0.0485;
  } else {
    const social = profit < 17374.08 ? 890.42 * 4
      : profit < 75024.54 ? profit * 0.205
        : profit < 110562.42 ? 75024.54 * 0.205 + (profit - 75024.54) * 0.1416
          : 75024.54 * 0.205 + (110562.42 - 75024.54) * 0.1416;
    const taxable = Math.max(0, profit - social);
    const tax = Math.min(taxable, 16720) * 0.25
      + Math.max(0, Math.min(taxable, 29510) - 16720) * 0.4
      + Math.max(0, Math.min(taxable, 51070) - 29510) * 0.45
      + Math.max(0, taxable - 51070) * 0.5;
    reserve = Math.max(0, tax - Math.min(11180, taxable) * 0.25) + social;
  }
  return cents(reserve * 100);
}

export function monthlyTaxReserveCents(country: TaxCountry, cumulativeProfitCents: number, monthlyProfitCents: number, starterDeduction: boolean, taxYear = 2026) {
  if (monthlyProfitCents <= 0 || cumulativeProfitCents <= 0) return 0;
  const annualReserve = annualTaxReserveCents(country, cumulativeProfitCents, starterDeduction, taxYear);
  return cents((annualReserve / cumulativeProfitCents) * monthlyProfitCents);
}

export type MonthlyTotalsInput = {
  contributionRevenueCents: number;
  activityRevenueCents: number;
  fixedCostsCents: number;
  lessonCostsCents: number;
  taxArrearsCents: number;
  salaryCents: number;
  previousBalanceCents: number;
  cumulativeGrossBeforeCents: number;
  country: TaxCountry;
  hasStarterDeduction: boolean;
  taxYear?: number;
};

export function calculateMonth(input: MonthlyTotalsInput) {
  const revenueCents = input.contributionRevenueCents + input.activityRevenueCents;
  const costsCents = input.fixedCostsCents + input.lessonCostsCents;
  const grossProfitCents = revenueCents - costsCents;
  const cumulativeGrossCents = input.cumulativeGrossBeforeCents + grossProfitCents;
  const taxReserveCents = monthlyTaxReserveCents(input.country, cumulativeGrossCents, grossProfitCents, input.hasStarterDeduction, input.taxYear);
  const netProfitCents = grossProfitCents - taxReserveCents;
  return {
    revenueCents, costsCents, grossProfitCents, taxReserveCents, netProfitCents,
    salaryCents: input.salaryCents,
    bankBalanceCents: input.previousBalanceCents + netProfitCents - input.salaryCents - input.taxArrearsCents,
    cumulativeGrossCents,
  };
}