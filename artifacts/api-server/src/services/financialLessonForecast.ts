import { scheduledLessonCount, type CalendarClosure, type CalendarLesson } from "./financialCalculations.ts";

type Teacher = { id: number; hourlyRateCents: number; weeklyTravelCents: number };
type Location = { id: number; name?: string; rentFrequency: string; rentCents: number; rentTermCount?: number | null };
type Lesson = CalendarLesson & {
  name: string;
  teacherId: number | null;
  locationId: number | null;
  durationMinutes: number;
};
type LessonInput = {
  lessonId: number;
  attendance: number | null;
  lessonCountOverride: number | null;
};

export type LessonProfitabilityRow = {
  lessonId: number;
  lessonName: string;
  locationId: number | null;
  locationName: string | null;
  autoCount: number;
  effectiveCount: number;
  attendance: number | null;
  lessonCost: number;
  estimatedRevenue: number;
  estimatedProfit: number | null;
  breakEvenAttendance: number | null;
  promotionGap: number | null;
  status: "unknown" | "loss" | "healthy";
  lessonCostCents: number;
  locationRentCost: number;
  locationRentCalculation: {
    frequency: "hour" | "session";
    rate: number;
    durationMinutes: number | null;
    lessonCount: number;
    totalCost: number;
  } | null;
};

type SavedMonth = {
  month: string;
  contributionRevenue: number;
  lessonProfitability: Array<Omit<LessonProfitabilityRow, "lessonCostCents">>;
  _locationRentAllocationsCents?: Array<{ locationId: number; amountCents: number }>;
};

const euros = (amount: number) => amount / 100;

const savedLessonRowFields = {
  lessonId: (value: unknown) => Number.isInteger(value),
  lessonName: (value: unknown) => typeof value === "string",
  locationId: (value: unknown) => value === null || Number.isInteger(value),
  locationName: (value: unknown) => value === null || typeof value === "string",
  autoCount: (value: unknown) => Number.isInteger(value),
  effectiveCount: (value: unknown) => Number.isInteger(value),
  attendance: (value: unknown) => value === null || Number.isFinite(value),
  lessonCost: (value: unknown) => Number.isFinite(value),
  estimatedRevenue: (value: unknown) => Number.isFinite(value),
  estimatedProfit: (value: unknown) => value === null || Number.isFinite(value),
  breakEvenAttendance: (value: unknown) => value === null || Number.isFinite(value),
  promotionGap: (value: unknown) => value === null || Number.isFinite(value),
  status: (value: unknown) => value === "unknown" || value === "loss" || value === "healthy",
  locationRentCost: (value: unknown) => Number.isFinite(value),
} satisfies Record<Exclude<keyof Omit<LessonProfitabilityRow, "lessonCostCents">, "locationRentCalculation">, (value: unknown) => boolean>;

function validateSavedLessonProfitabilityRow(value: unknown, month: string, index: number): void {
  const path = `${month}.lessonProfitability[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`INVALID_SAVED_LESSON_PROFITABILITY:${path} is invalid`);
  }
  const row = value as Record<string, unknown>;
  for (const [field, isValid] of Object.entries(savedLessonRowFields)) {
    if (!Object.hasOwn(row, field) || row[field] === undefined) {
      throw new Error(`INVALID_SAVED_LESSON_PROFITABILITY:${path}.${field} is required`);
    }
    if (!isValid(row[field])) {
      throw new Error(`INVALID_SAVED_LESSON_PROFITABILITY:${path}.${field} is invalid`);
    }
  }
  if (!Object.hasOwn(row, "locationRentCalculation") || row.locationRentCalculation === undefined) {
    throw new Error(`INVALID_SAVED_LESSON_PROFITABILITY:${path}.locationRentCalculation is required`);
  }
  if (row.locationRentCalculation === null) return;
  if (typeof row.locationRentCalculation !== "object" || Array.isArray(row.locationRentCalculation)) {
    throw new Error(`INVALID_SAVED_LESSON_PROFITABILITY:${path}.locationRentCalculation is invalid`);
  }
  const calculation = row.locationRentCalculation as Record<string, unknown>;
  const fields: Record<string, (fieldValue: unknown) => boolean> = {
    frequency: fieldValue => fieldValue === "hour" || fieldValue === "session",
    rate: fieldValue => Number.isFinite(fieldValue),
    durationMinutes: fieldValue => fieldValue === null || Number.isFinite(fieldValue),
    lessonCount: fieldValue => Number.isInteger(fieldValue),
    totalCost: fieldValue => Number.isFinite(fieldValue),
  };
  for (const [field, isValid] of Object.entries(fields)) {
    const fieldPath = `${path}.locationRentCalculation.${field}`;
    if (!Object.hasOwn(calculation, field) || calculation[field] === undefined) {
      throw new Error(`INVALID_SAVED_LESSON_PROFITABILITY:${fieldPath} is required`);
    }
    if (!isValid(calculation[field])) {
      throw new Error(`INVALID_SAVED_LESSON_PROFITABILITY:${fieldPath} is invalid`);
    }
  }
}

function validateSavedMonth(value: unknown, index: number): asserts value is SavedMonth {
  const path = `savedMonths[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`INVALID_SAVED_MONTH:${path} is invalid`);
  }
  const saved = value as Record<string, unknown>;
  if (!Object.hasOwn(saved, "month") || saved.month === undefined) {
    throw new Error(`INVALID_SAVED_MONTH:${path}.month is required`);
  }
  if (typeof saved.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(saved.month)) {
    throw new Error(`INVALID_SAVED_MONTH:${path}.month is invalid`);
  }
  if (!Object.hasOwn(saved, "contributionRevenue") || saved.contributionRevenue === undefined) {
    throw new Error(`INVALID_SAVED_MONTH:${path}.contributionRevenue is required`);
  }
  if (!Number.isFinite(saved.contributionRevenue)) {
    throw new Error(`INVALID_SAVED_MONTH:${path}.contributionRevenue is invalid`);
  }
  if (!Object.hasOwn(saved, "lessonProfitability") || saved.lessonProfitability === undefined) {
    throw new Error(`INVALID_SAVED_MONTH:${path}.lessonProfitability is required`);
  }
  if (!Array.isArray(saved.lessonProfitability)) {
    throw new Error(`INVALID_SAVED_MONTH:${path}.lessonProfitability is invalid`);
  }
  if (saved._locationRentAllocationsCents === undefined) return;
  if (!Array.isArray(saved._locationRentAllocationsCents)) {
    throw new Error(`INVALID_SAVED_MONTH:${path}._locationRentAllocationsCents is invalid`);
  }
  saved._locationRentAllocationsCents.forEach((value, allocationIndex) => {
    const allocationPath = `${path}._locationRentAllocationsCents[${allocationIndex}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`INVALID_SAVED_MONTH:${allocationPath} is invalid`);
    }
    const allocation = value as Record<string, unknown>;
    for (const field of ["locationId", "amountCents"] as const) {
      if (!Object.hasOwn(allocation, field) || allocation[field] === undefined) {
        throw new Error(`INVALID_SAVED_MONTH:${allocationPath}.${field} is required`);
      }
      if (!Number.isSafeInteger(allocation[field])) {
        throw new Error(`INVALID_SAVED_MONTH:${allocationPath}.${field} is invalid`);
      }
    }
  });
}

type SeasonRentContext = {
  startDate: string;
  endDate: string;
  lessons: Lesson[];
  excludedMonths?: Set<string>;
  alreadyAllocatedByLocation?: Map<number, number>;
};

export function monthlyRentAllocation(
  context: SeasonRentContext,
  locations: Location[],
  closures: CalendarClosure[],
) {
  const months = calendarMonths(context.startDate, context.endDate);
  const allocation = new Map<string, number>();
  const allocationByMonthAndLocation = new Map<string, number>();
  const unallocatedLocations: Array<{ locationId: number; locationName: string; totalCost: number }> = [];
  const overallocatedLocations: Array<{
    locationId: number;
    locationName: string;
    previouslyAllocatedCost: number;
    contractTotal: number;
  }> = [];
  const locationRentBreakdowns: Array<{
    locationId: number;
    locationName: string;
    rentPerTerm: number;
    rentTermCount: number;
    contractTotal: number;
    remainingScheduledLessonCount: number;
    previouslyAllocatedCost: number;
    remainingAllocatedCost: number;
    unallocatedCost: number;
    lessons: Array<{ lessonId: number; lessonName: string; scheduledLessonCount: number; allocatedCost: number }>;
  }> = [];

  for (const location of locations.filter(item => item.rentFrequency === "month")) {
    const buckets = months.filter(month => !context.excludedMonths?.has(month)).flatMap(month => context.lessons
      .filter(lesson => lesson.locationId === location.id && lessonOverlapsMonth(lesson, month))
      .sort((a, b) => a.id - b.id)
      .map(lesson => ({ month, lessonId: lesson.id, count: scheduledLessonCount(month, lesson, closures) }))
      .filter(bucket => bucket.count > 0));
    const totalOccurrences = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    const contractRentCents = location.rentCents * (location.rentTermCount ?? 12);
    const previouslyAllocatedCents = context.alreadyAllocatedByLocation?.get(location.id) ?? 0;
    const totalRentCents = Math.max(0, contractRentCents - previouslyAllocatedCents);
    if (previouslyAllocatedCents > contractRentCents) {
      overallocatedLocations.push({
        locationId: location.id,
        locationName: location.name ?? `Locatie ${location.id}`,
        previouslyAllocatedCost: euros(previouslyAllocatedCents),
        contractTotal: euros(contractRentCents),
      });
    }
    const lessonAllocations = new Map<number, { lessonId: number; lessonName: string; scheduledLessonCount: number; allocatedCostCents: number }>();
    locationRentBreakdowns.push({
      locationId: location.id,
      locationName: location.name ?? `Locatie ${location.id}`,
      rentPerTerm: euros(location.rentCents),
      rentTermCount: location.rentTermCount ?? 12,
      contractTotal: euros(contractRentCents),
      remainingScheduledLessonCount: totalOccurrences,
      previouslyAllocatedCost: euros(previouslyAllocatedCents),
      remainingAllocatedCost: totalOccurrences > 0 ? euros(totalRentCents) : 0,
      unallocatedCost: totalOccurrences > 0 ? 0 : euros(totalRentCents),
      lessons: [],
    });
    if (totalOccurrences === 0) {
      if (totalRentCents > 0) {
        unallocatedLocations.push({
          locationId: location.id,
          locationName: location.name ?? `Locatie ${location.id}`,
          totalCost: euros(totalRentCents),
        });
      }
      continue;
    }

    let allocatedCents = 0;
    let allocatedOccurrences = 0;
    for (const bucket of buckets) {
      allocatedOccurrences += bucket.count;
      const throughThisBucket = Math.round(totalRentCents * allocatedOccurrences / totalOccurrences);
      const bucketCents = throughThisBucket - allocatedCents;
      allocation.set(`${bucket.month}:${bucket.lessonId}`, bucketCents);
      const locationKey = `${bucket.month}:${location.id}`;
      allocationByMonthAndLocation.set(locationKey, (allocationByMonthAndLocation.get(locationKey) ?? 0) + bucketCents);
      const lesson = context.lessons.find(item => item.id === bucket.lessonId);
      const lessonAllocation = lessonAllocations.get(bucket.lessonId) ?? {
        lessonId: bucket.lessonId,
        lessonName: lesson?.name ?? `Les ${bucket.lessonId}`,
        scheduledLessonCount: 0,
        allocatedCostCents: 0,
      };
      lessonAllocation.scheduledLessonCount += bucket.count;
      lessonAllocation.allocatedCostCents += bucketCents;
      lessonAllocations.set(bucket.lessonId, lessonAllocation);
      allocatedCents = throughThisBucket;
    }
    locationRentBreakdowns.at(-1)!.lessons = [...lessonAllocations.values()].map(item => ({
      lessonId: item.lessonId,
      lessonName: item.lessonName,
      scheduledLessonCount: item.scheduledLessonCount,
      allocatedCost: euros(item.allocatedCostCents),
    }));
  }

  return { allocation, allocationByMonthAndLocation, unallocatedLocations, overallocatedLocations, locationRentBreakdowns };
}

export function lessonProfitabilityForMonth({
  month,
  teachers,
  locations,
  lessons,
  closures,
  lessonInputs,
  contributionRevenueCents,
  seasonRentContext,
}: {
  month: string;
  teachers: Teacher[];
  locations: Location[];
  lessons: Lesson[];
  closures: CalendarClosure[];
  lessonInputs: LessonInput[];
  contributionRevenueCents: number | null;
  seasonRentContext?: SeasonRentContext;
}): LessonProfitabilityRow[] {
  const inputForLesson = new Map(lessonInputs.map(input => [input.lessonId, input]));
  const teacherById = new Map(teachers.map(teacher => [teacher.id, teacher]));
  const locationById = new Map(locations.map(location => [location.id, location]));
  const occurrences = lessons.map(lesson => ({
    lesson,
    autoCount: scheduledLessonCount(month, lesson, closures),
    count: inputForLesson.get(lesson.id)?.lessonCountOverride ?? scheduledLessonCount(month, lesson, closures),
  }));
  const locationTotals = new Map<number, number>();
  const seasonRent = seasonRentContext
    ? monthlyRentAllocation(seasonRentContext, locations, closures).allocation
    : null;
  const teacherTotals = new Map<number, number>();
  const teacherWeeks = new Map<number, number>();

  for (const { lesson, count } of occurrences) {
    if (lesson.locationId) locationTotals.set(lesson.locationId, (locationTotals.get(lesson.locationId) ?? 0) + count);
    if (lesson.teacherId) {
      teacherTotals.set(lesson.teacherId, (teacherTotals.get(lesson.teacherId) ?? 0) + count);
      teacherWeeks.set(lesson.teacherId, Math.max(teacherWeeks.get(lesson.teacherId) ?? 0, count));
    }
  }

  const activeOccurrences = occurrences.filter(({ count }) => count > 0);
  const completeAttendance = activeOccurrences.every(({ lesson }) => inputForLesson.get(lesson.id)?.attendance != null);
  const totalAttendance = completeAttendance
    ? activeOccurrences.reduce((sum, { lesson }) => sum + (inputForLesson.get(lesson.id)?.attendance ?? 0), 0)
    : 0;
  const canAllocateRevenue = contributionRevenueCents != null && completeAttendance && totalAttendance > 0;
  let allocatedRevenueCents = 0;
  const lastRevenueLessonId = activeOccurrences.at(-1)?.lesson.id;

  return occurrences.map(({ lesson, autoCount, count }) => {
    const teacher = lesson.teacherId ? teacherById.get(lesson.teacherId) : undefined;
    const location = lesson.locationId ? locationById.get(lesson.locationId) : undefined;
    const teacherHourly = teacher ? teacher.hourlyRateCents * lesson.durationMinutes / 60 * count : 0;
    const travel = teacher ? teacher.weeklyTravelCents * (teacherWeeks.get(teacher.id) ?? 0) * count / Math.max(1, teacherTotals.get(teacher.id) ?? 1) : 0;
    const locationCost = !location ? 0
      : location.rentFrequency === "hour" ? location.rentCents * lesson.durationMinutes / 60 * count
        : location.rentFrequency === "session" ? location.rentCents * count
          : seasonRent?.get(`${month}:${lesson.id}`)
            ?? location.rentCents * count / Math.max(1, locationTotals.get(location.id) ?? 1);
    const lessonCostCents = Math.round(teacherHourly + travel) + Math.round(locationCost);
    const locationRentCostCents = Math.round(locationCost);
    const rentLocation = location && (location.rentFrequency === "hour" || location.rentFrequency === "session")
      ? location as Location & { rentFrequency: "hour" | "session" }
      : null;
    const locationRentCalculation: LessonProfitabilityRow["locationRentCalculation"] = rentLocation
      ? {
          frequency: rentLocation.rentFrequency,
          rate: euros(rentLocation.rentCents),
          durationMinutes: rentLocation.rentFrequency === "hour" ? lesson.durationMinutes : null,
          lessonCount: count,
          totalCost: euros(locationRentCostCents),
        }
      : null;
    const attendance = inputForLesson.get(lesson.id)?.attendance ?? null;
    let estimatedRevenueCents = 0;
    if (canAllocateRevenue && count > 0 && attendance != null && contributionRevenueCents != null) {
      estimatedRevenueCents = lesson.id === lastRevenueLessonId
        ? contributionRevenueCents - allocatedRevenueCents
        : Math.round(contributionRevenueCents * attendance / totalAttendance);
      allocatedRevenueCents += estimatedRevenueCents;
    }
    const revenuePerAttendanceCents = canAllocateRevenue && contributionRevenueCents != null
      ? contributionRevenueCents / totalAttendance
      : 0;
    const breakEvenAttendance = revenuePerAttendanceCents > 0 ? Math.ceil(lessonCostCents / revenuePerAttendanceCents) : null;
    const promotionGap = attendance == null || breakEvenAttendance == null ? null : Math.max(0, breakEvenAttendance - attendance);
    const hasReliableResult = count === 0 || (canAllocateRevenue && attendance != null);

    return {
      lessonId: lesson.id,
      lessonName: lesson.name,
      locationId: lesson.locationId,
      locationName: location?.name ?? null,
      autoCount,
      effectiveCount: count,
      attendance,
      lessonCost: euros(lessonCostCents),
      estimatedRevenue: euros(estimatedRevenueCents),
      estimatedProfit: hasReliableResult ? euros(estimatedRevenueCents - lessonCostCents) : null,
      breakEvenAttendance,
      promotionGap,
      status: !hasReliableResult ? "unknown" : estimatedRevenueCents < lessonCostCents ? "loss" : "healthy",
      lessonCostCents,
      locationRentCost: euros(locationRentCostCents),
      locationRentCalculation,
    };
  });
}

function calendarMonths(startDate: string, endDate: string) {
  const result: string[] = [];
  const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const end = `${endDate.slice(0, 7)}-01`;
  while (cursor.toISOString().slice(0, 10) <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function lessonOverlapsMonth(lesson: Lesson, month: string) {
  const monthStart = `${month.slice(0, 7)}-01`;
  const start = new Date(`${monthStart}T00:00:00.000Z`);
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return lesson.activeFrom <= monthEnd && lesson.activeUntil >= monthStart;
}

export function buildLessonSeasonForecast({
  startDate,
  endDate,
  teachers,
  locations,
  lessons,
  closures,
  savedMonths,
}: {
  startDate: string;
  endDate: string;
  teachers: Teacher[];
  locations: Location[];
  lessons: Lesson[];
  closures: CalendarClosure[];
  savedMonths: SavedMonth[];
}) {
  savedMonths.forEach((saved, index) => validateSavedMonth(saved, index));
  for (const saved of savedMonths) {
    saved.lessonProfitability.forEach((row, index) => validateSavedLessonProfitabilityRow(row, saved.month, index));
  }
  const months = calendarMonths(startDate, endDate);
  const savedByMonth = new Map(savedMonths.map(month => [month.month, month]));
  const alreadyAllocatedByLocation = new Map<number, number>();
  for (const saved of savedMonths) {
    for (const item of saved._locationRentAllocationsCents ?? []) {
      alreadyAllocatedByLocation.set(item.locationId, (alreadyAllocatedByLocation.get(item.locationId) ?? 0) + item.amountCents);
    }
  }
  const seasonRentContext = {
    startDate,
    endDate,
    lessons,
    excludedMonths: new Set(savedMonths.map(saved => saved.month)),
    alreadyAllocatedByLocation,
  };
  const latestAttendance = new Map<number, number>();
  let latestContributionRevenueCents: number | null = null;
  const rowsByLesson = new Map<number, {
    lessonId: number;
    lessonName: string;
    months: Array<{
      month: string;
      status: "actual" | "forecast" | "unknown" | "no_lessons";
      missingInputs: Array<"contribution" | "attendance">;
      saved: boolean;
      lessonCount: number;
      attendance: number | null;
      revenue: number | null;
      cost: number;
      profit: number | null;
      breakEvenAttendance: number | null;
      promotionGap: number | null;
      locationRentCost: number;
      locationId: number | null;
      locationName: string | null;
      locationRentCalculation: LessonProfitabilityRow["locationRentCalculation"];
    }>;
  }>();

  const append = (
    row: LessonProfitabilityRow | Omit<LessonProfitabilityRow, "lessonCostCents">,
    month: string,
    saved: boolean,
    missingInputs: Array<"contribution" | "attendance"> = [],
  ) => {
    const attendance = row.attendance;
    const hasReliableResult = row.estimatedProfit != null;
    const status = row.effectiveCount === 0
      ? "no_lessons"
      : !hasReliableResult
        ? "unknown"
        : saved
          ? "actual"
          : "forecast";
    const target = rowsByLesson.get(row.lessonId) ?? { lessonId: row.lessonId, lessonName: row.lessonName, months: [] };
    target.lessonName = row.lessonName;
    target.months.push({
      month,
      status,
      missingInputs: status === "unknown" ? missingInputs : [],
      saved,
      lessonCount: row.effectiveCount,
      attendance,
      revenue: hasReliableResult ? row.estimatedRevenue : null,
      cost: row.lessonCost,
      profit: row.estimatedProfit,
      breakEvenAttendance: row.breakEvenAttendance,
      promotionGap: row.promotionGap,
      locationRentCost: row.locationRentCost,
      locationId: row.locationId,
      locationName: row.locationName,
      locationRentCalculation: row.locationRentCalculation,
    });
    rowsByLesson.set(row.lessonId, target);
  };

  for (const month of months) {
    const saved = savedByMonth.get(month);
    if (saved) {
      const hasActiveLessons = saved.lessonProfitability.some(row => row.effectiveCount > 0);
      const missingInputs: Array<"contribution" | "attendance"> = [];
      if (hasActiveLessons && saved.lessonProfitability.some(row => row.effectiveCount > 0 && row.attendance == null)) {
        missingInputs.push("attendance");
      }
      for (const row of saved.lessonProfitability) {
        append(row, month, true, missingInputs);
        if (row.attendance != null) latestAttendance.set(row.lessonId, row.attendance);
      }
      latestContributionRevenueCents = Math.round(saved.contributionRevenue * 100);
      continue;
    }

    const activeLessons = lessons.filter(lesson => lessonOverlapsMonth(lesson, month));
    const rows = lessonProfitabilityForMonth({
      month,
      teachers,
      locations,
      lessons: activeLessons,
      closures,
      lessonInputs: activeLessons.map(lesson => ({
        lessonId: lesson.id,
        attendance: latestAttendance.get(lesson.id) ?? null,
        lessonCountOverride: null,
      })),
      contributionRevenueCents: latestContributionRevenueCents,
      seasonRentContext,
    });
    const hasActiveLessons = rows.some(row => row.effectiveCount > 0);
    const missingInputs: Array<"contribution" | "attendance"> = [];
    if (hasActiveLessons && latestContributionRevenueCents == null) missingInputs.push("contribution");
    if (hasActiveLessons && rows.some(row => row.effectiveCount > 0 && row.attendance == null)) missingInputs.push("attendance");
    for (const row of rows) append(row, month, false, missingInputs);
  }

  const forecastLessons = [...rowsByLesson.values()].map(lesson => {
    const known = lesson.months.filter(month => month.profit != null);
    const hasUnknownMonths = lesson.months.some(month => month.status === "unknown");
    const totalProfit = known.length && !hasUnknownMonths
      ? known.reduce((sum, month) => sum + (month.profit ?? 0), 0)
      : null;
    const promotionGap = known.reduce<number | null>((largest, month) => {
      if (month.promotionGap == null) return largest;
      return Math.max(largest ?? 0, month.promotionGap);
    }, null);
    const rentBearingMonths = lesson.months.filter(month => Math.round(month.locationRentCost * 100) !== 0);
    const rentCalculations = rentBearingMonths
      .map(month => month.locationRentCalculation)
      .filter((calculation): calculation is NonNullable<typeof calculation> => calculation != null);
    const firstRentCalculation = rentCalculations[0];
    const totalLocationRentCost = lesson.months.reduce((sum, month) => sum + month.locationRentCost, 0);
    const combinedLessonCount = rentCalculations.reduce((sum, calculation) => sum + calculation.lessonCount, 0);
    const calculatedTotalCents = firstRentCalculation?.frequency === "hour"
      ? Math.round(firstRentCalculation.rate * 100 * (firstRentCalculation.durationMinutes ?? 0) / 60 * combinedLessonCount)
      : firstRentCalculation
        ? Math.round(firstRentCalculation.rate * 100 * combinedLessonCount)
        : 0;
    const locationRentCalculation = firstRentCalculation
      && rentCalculations.length === rentBearingMonths.length
      && rentCalculations.every(calculation =>
        calculation.frequency === firstRentCalculation.frequency
        && calculation.rate === firstRentCalculation.rate
        && calculation.durationMinutes === firstRentCalculation.durationMinutes)
      && calculatedTotalCents === Math.round(totalLocationRentCost * 100)
      ? {
          ...firstRentCalculation,
          lessonCount: combinedLessonCount,
          totalCost: totalLocationRentCost,
        }
      : null;
    return {
      ...lesson,
      totalLessonCount: lesson.months.reduce((sum, month) => sum + month.lessonCount, 0),
      totalRevenue: known.length && !hasUnknownMonths
        ? known.reduce((sum, month) => sum + (month.revenue ?? 0), 0)
        : null,
      totalCost: lesson.months.reduce((sum, month) => sum + month.cost, 0),
      totalLocationRentCost,
      locationRentCalculation,
      totalProfit,
      actualMonthCount: lesson.months.filter(month => month.status === "actual").length,
      forecastMonthCount: lesson.months.filter(month => month.status === "forecast" || month.status === "no_lessons").length,
      unknownMonthCount: lesson.months.filter(month => month.status === "unknown").length,
      promotionGap,
      status: totalProfit == null ? "unknown" as const : totalProfit < 0 ? "loss" as const : "healthy" as const,
    };
  }).sort((a, b) => (a.totalProfit ?? Number.NEGATIVE_INFINITY) - (b.totalProfit ?? Number.NEGATIVE_INFINITY));

  const { unallocatedLocations, overallocatedLocations, locationRentBreakdowns: remainingBreakdowns } = monthlyRentAllocation(seasonRentContext, locations, closures);
  const locationRentBreakdowns = remainingBreakdowns.map(location => {
    const lessonAllocations = new Map(location.lessons.map(lesson => [lesson.lessonId, { ...lesson }]));
    for (const saved of savedMonths) {
      for (const row of saved.lessonProfitability.filter(item => item.locationId === location.locationId)) {
        const lesson = lessonAllocations.get(row.lessonId) ?? {
          lessonId: row.lessonId,
          lessonName: row.lessonName,
          scheduledLessonCount: 0,
          allocatedCost: 0,
        };
        lesson.scheduledLessonCount += row.autoCount;
        lesson.allocatedCost += row.locationRentCost;
        lessonAllocations.set(row.lessonId, lesson);
      }
    }
    const lessons = [...lessonAllocations.values()].sort((a, b) => a.lessonName.localeCompare(b.lessonName, "nl"));
    const previouslyAllocatedCost = lessons.reduce((sum, lesson) => {
      const remainingLesson = location.lessons.find(item => item.lessonId === lesson.lessonId);
      return sum + lesson.allocatedCost - (remainingLesson?.allocatedCost ?? 0);
    }, 0);
    const allocatedCost = lessons.reduce((sum, lesson) => sum + lesson.allocatedCost, 0);
    return {
      ...location,
      scheduledLessonCount: lessons.reduce((sum, lesson) => sum + lesson.scheduledLessonCount, 0),
      previouslyAllocatedCost,
      allocatedCost,
      unallocatedCost: Math.max(0, location.contractTotal - allocatedCost),
      lessons,
    };
  });
  return { months, lessons: forecastLessons, unallocatedLocations, overallocatedLocations, locationRentBreakdowns };
}