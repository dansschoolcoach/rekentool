import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLessonSeasonForecast,
  lessonProfitabilityForMonth,
  type LessonProfitabilityRow,
} from "./financialLessonForecast.ts";

function assertLessonProfitabilityRowRentContract() {
  const rowWithoutRentDetails = {
    lessonId: 1,
    lessonName: "Zonder huurdetails",
    locationId: null,
    locationName: null,
    autoCount: 4,
    effectiveCount: 4,
    attendance: 10,
    lessonCost: 0,
    estimatedRevenue: 100,
    estimatedProfit: 100,
    breakEvenAttendance: 0,
    promotionGap: null,
    status: "healthy" as const,
    lessonCostCents: 0,
    locationRentCost: 0,
  };
  // @ts-expect-error locationRentCalculation must remain required on forecast rows.
  const missingRentDetails: LessonProfitabilityRow = rowWithoutRentDetails;

  const noRent: LessonProfitabilityRow = {
    ...rowWithoutRentDetails,
    lessonName: "Geen huur",
    locationRentCalculation: null,
  };
  const monthlyRent: LessonProfitabilityRow = {
    ...rowWithoutRentDetails,
    lessonName: "Maandhuur",
    locationId: 1,
    locationName: "Studio",
    locationRentCost: 120,
    locationRentCalculation: null,
  };

  void missingRentDetails;
  void noRent;
  void monthlyRent;
}

void assertLessonProfitabilityRowRentContract;

const teachers = [{ id: 1, hourlyRateCents: 3000, weeklyTravelCents: 0 }];
const locations = [{ id: 1, name: "Studio", rentFrequency: "session", rentCents: 2000, rentTermCount: null }];
const lessons = [
  { id: 1, name: "Beginners", teacherId: 1, locationId: 1, weekday: 1, durationMinutes: 60, activeFrom: "2026-09-01", activeUntil: "2026-11-30" },
  { id: 2, name: "Gevorderd", teacherId: 1, locationId: 1, weekday: 2, durationMinutes: 60, activeFrom: "2026-09-01", activeUntil: "2026-11-30" },
];

const validSavedLessonRow = {
  lessonId: 1,
  lessonName: "Beginners",
  locationId: null,
  locationName: null,
  autoCount: 4,
  effectiveCount: 4,
  attendance: 10,
  lessonCost: 0,
  locationRentCost: 0,
  locationRentCalculation: null,
  estimatedRevenue: 100,
  estimatedProfit: 100,
  breakEvenAttendance: 0,
  promotionGap: null,
  status: "healthy",
};

function forecastWithSavedMonths(savedMonths: unknown) {
  return buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    teachers: [],
    locations: [],
    lessons: [{ ...lessons[0], teacherId: null, locationId: null }],
    closures: [],
    savedMonths: savedMonths as Parameters<typeof buildLessonSeasonForecast>[0]["savedMonths"],
  });
}

test("validates persisted month envelope fields at runtime", () => {
  const validMonth = {
    month: "2026-09-01",
    contributionRevenue: 100,
    lessonProfitability: [validSavedLessonRow],
  };
  const invalidMonths = [
    {
      value: { contributionRevenue: 100, lessonProfitability: [validSavedLessonRow] },
      message: /savedMonths\[0\]\.month is required/,
    },
    {
      value: { ...validMonth, month: "2026-13-01" },
      message: /savedMonths\[0\]\.month is invalid/,
    },
    {
      value: { ...validMonth, contributionRevenue: Number.POSITIVE_INFINITY },
      message: /savedMonths\[0\]\.contributionRevenue is invalid/,
    },
    {
      value: { month: "2026-09-01", lessonProfitability: [validSavedLessonRow] },
      message: /savedMonths\[0\]\.contributionRevenue is required/,
    },
    {
      value: { ...validMonth, lessonProfitability: {} },
      message: /savedMonths\[0\]\.lessonProfitability is invalid/,
    },
  ];

  for (const invalid of invalidMonths) {
    assert.throws(() => forecastWithSavedMonths([invalid.value]), invalid.message);
  }
  assert.doesNotThrow(() => forecastWithSavedMonths([validMonth]));
});

test("validates persisted rent allocations with their exact index and field", () => {
  const validMonth = {
    month: "2026-09-01",
    contributionRevenue: 100,
    lessonProfitability: [validSavedLessonRow],
    _locationRentAllocationsCents: [{ locationId: 1, amountCents: 12000 }],
  };
  const invalidAllocations = [
    {
      allocations: "invalid",
      message: /savedMonths\[0\]\._locationRentAllocationsCents is invalid/,
    },
    {
      allocations: [{ locationId: 1, amountCents: 12000 }, { locationId: 2 }],
      message: /savedMonths\[0\]\._locationRentAllocationsCents\[1\]\.amountCents is required/,
    },
    {
      allocations: [{ locationId: 1, amountCents: Number.NaN }],
      message: /savedMonths\[0\]\._locationRentAllocationsCents\[0\]\.amountCents is invalid/,
    },
    {
      allocations: [{ locationId: "1", amountCents: 12000 }],
      message: /savedMonths\[0\]\._locationRentAllocationsCents\[0\]\.locationId is invalid/,
    },
  ];

  for (const invalid of invalidAllocations) {
    assert.throws(
      () => forecastWithSavedMonths([{ ...validMonth, _locationRentAllocationsCents: invalid.allocations }]),
      invalid.message,
    );
  }
  assert.doesNotThrow(() => forecastWithSavedMonths([validMonth]));
});

test("rejects a persisted lesson row without rent calculation details", () => {
  const [savedRow] = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers,
    locations,
    lessons: [lessons[0]],
    closures: [],
    lessonInputs: [{ lessonId: 1, attendance: 10, lessonCountOverride: null }],
    contributionRevenueCents: 100_00,
  });
  const rowWithoutRentCalculation = { ...savedRow } as Record<string, unknown>;
  delete rowWithoutRentCalculation.locationRentCalculation;

  assert.throws(
    () => buildLessonSeasonForecast({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teachers,
      locations,
      lessons: [lessons[0]],
      closures: [],
      savedMonths: [{
        month: "2026-09-01",
        contributionRevenue: 100,
        lessonProfitability: [rowWithoutRentCalculation],
      }] as unknown as Parameters<typeof buildLessonSeasonForecast>[0]["savedMonths"],
    }),
    /locationRentCalculation is required/,
  );
});

test("accepts explicit null rent details for no rent and monthly rent", () => {
  const baseRow = {
    lessonId: 1,
    lessonName: "Beginners",
    locationId: null,
    locationName: null,
    autoCount: 4,
    effectiveCount: 4,
    attendance: 10,
    lessonCost: 0,
    locationRentCost: 0,
    locationRentCalculation: null,
    estimatedRevenue: 100,
    estimatedProfit: 100,
    breakEvenAttendance: 0,
    promotionGap: null,
    status: "healthy" as const,
  };

  for (const row of [
    baseRow,
    { ...baseRow, locationId: 1, locationName: "Studio", locationRentCost: 120, lessonCost: 120 },
  ]) {
    assert.doesNotThrow(() => buildLessonSeasonForecast({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teachers: [],
      locations: row.locationId == null
        ? []
        : [{ id: 1, name: "Studio", rentFrequency: "month", rentCents: 120_00, rentTermCount: 1 }],
      lessons: [{ ...lessons[0], teacherId: null, locationId: row.locationId }],
      closures: [],
      savedMonths: [{ month: "2026-09-01", contributionRevenue: 100, lessonProfitability: [row] }],
    }));
  }
});

test("rejects missing and invalid persisted lesson row core fields with their month and index", () => {
  const validRow = {
    lessonId: 1,
    lessonName: "Beginners",
    locationId: null,
    locationName: null,
    autoCount: 4,
    effectiveCount: 4,
    attendance: 10,
    lessonCost: 0,
    locationRentCost: 0,
    locationRentCalculation: null,
    estimatedRevenue: 100,
    estimatedProfit: 100,
    breakEvenAttendance: 0,
    promotionGap: null,
    status: "healthy",
  };
  const invalidRows = [
    { field: "lessonName", row: Object.fromEntries(Object.entries(validRow).filter(([field]) => field !== "lessonName")), message: "lessonName is required" },
    { field: "effectiveCount", row: { ...validRow, effectiveCount: "4" }, message: "effectiveCount is invalid" },
    { field: "estimatedProfit", row: { ...validRow, estimatedProfit: Number.NaN }, message: "estimatedProfit is invalid" },
    { field: "status", row: { ...validRow, status: "profitable" }, message: "status is invalid" },
  ];

  for (const { field, row, message } of invalidRows) {
    assert.throws(
      () => buildLessonSeasonForecast({
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        teachers: [],
        locations: [],
        lessons: [{ ...lessons[0], teacherId: null, locationId: null }],
        closures: [],
        savedMonths: [{
          month: "2026-09-01",
          contributionRevenue: 100,
          lessonProfitability: [validRow, row],
        }] as unknown as Parameters<typeof buildLessonSeasonForecast>[0]["savedMonths"],
      }),
      new RegExp(`2026-09-01\\.lessonProfitability\\[1\\]\\.${field} ${message.slice(field.length + 1)}`),
    );
  }
});

test("validates nested persisted rent calculation fields", () => {
  const row = {
    lessonId: 1,
    lessonName: "Beginners",
    locationId: 1,
    locationName: "Studio",
    autoCount: 4,
    effectiveCount: 4,
    attendance: 10,
    lessonCost: 80,
    locationRentCost: 80,
    locationRentCalculation: {
      frequency: "hour",
      rate: "20",
      durationMinutes: 60,
      lessonCount: 4,
      totalCost: 80,
    },
    estimatedRevenue: 100,
    estimatedProfit: 20,
    breakEvenAttendance: 8,
    promotionGap: null,
    status: "healthy",
  };

  assert.throws(
    () => buildLessonSeasonForecast({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teachers: [],
      locations,
      lessons: [{ ...lessons[0], teacherId: null }],
      closures: [],
      savedMonths: [{ month: "2026-09-01", contributionRevenue: 100, lessonProfitability: [row as never] }],
    }),
    /2026-09-01\.lessonProfitability\[0\]\.locationRentCalculation\.rate is invalid/,
  );
});

test("allocates the real contribution pool once across lesson attendance", () => {
  const rows = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers,
    locations,
    lessons,
    closures: [],
    lessonInputs: [
      { lessonId: 1, attendance: 10, lessonCountOverride: null },
      { lessonId: 2, attendance: 20, lessonCountOverride: null },
    ],
    contributionRevenueCents: 300_00,
  });

  assert.equal(rows.reduce((sum, row) => sum + row.estimatedRevenue, 0), 300);
  assert.equal(rows[0].estimatedRevenue, 100);
  assert.equal(rows[1].estimatedRevenue, 200);
});

test("does not invent lesson revenue while an active lesson has no attendance", () => {
  const rows = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers,
    locations,
    lessons,
    closures: [],
    lessonInputs: [
      { lessonId: 1, attendance: 10, lessonCountOverride: null },
      { lessonId: 2, attendance: null, lessonCountOverride: null },
    ],
    contributionRevenueCents: 300_00,
  });

  assert.deepEqual(rows.map(row => row.status), ["unknown", "unknown"]);
  assert.deepEqual(rows.map(row => row.estimatedProfit), [null, null]);
});

test("treats a month without lesson occurrences as a known zero result", () => {
  const [row] = lessonProfitabilityForMonth({
    month: "2027-07-01",
    teachers,
    locations,
    lessons: [{
      id: 1,
      name: "Maandagles",
      teacherId: 1,
      locationId: 1,
      weekday: 1,
      durationMinutes: 60,
      activeFrom: "2026-09-01",
      activeUntil: "2027-07-04",
    }],
    closures: [],
    lessonInputs: [{ lessonId: 1, attendance: 12, lessonCountOverride: null }],
    contributionRevenueCents: null,
  });

  assert.equal(row.effectiveCount, 0);
  assert.equal(row.lessonCost, 0);
  assert.equal(row.estimatedRevenue, 0);
  assert.equal(row.estimatedProfit, 0);
  assert.equal(row.status, "healthy");
});

test("keeps season totals calculable when the final calendar month has no occurrences", () => {
  const mondayLesson = {
    id: 1,
    name: "Maandagles",
    teacherId: 1,
    locationId: 1,
    weekday: 1,
    durationMinutes: 60,
    activeFrom: "2027-06-01",
    activeUntil: "2027-07-04",
  };
  const juneRows = lessonProfitabilityForMonth({
    month: "2027-06-01",
    teachers,
    locations,
    lessons: [mondayLesson],
    closures: [],
    lessonInputs: [{ lessonId: 1, attendance: 12, lessonCountOverride: null }],
    contributionRevenueCents: 600_00,
  }).map(({ lessonCostCents: _ignored, ...row }) => row);

  const forecast = buildLessonSeasonForecast({
    startDate: "2027-06-01",
    endDate: "2027-07-04",
    teachers,
    locations,
    lessons: [mondayLesson],
    closures: [],
    savedMonths: [{ month: "2027-06-01", contributionRevenue: 600, lessonProfitability: juneRows }],
  });

  const lesson = forecast.lessons[0];
  const july = lesson.months.find(month => month.month === "2027-07-01");
  assert.ok(july);
  assert.equal(july.status, "no_lessons");
  assert.deepEqual(july.missingInputs, []);
  assert.equal(july.lessonCount, 0);
  assert.equal(july.revenue, 0);
  assert.equal(july.profit, 0);
  assert.equal(lesson.unknownMonthCount, 0);
  assert.equal(lesson.forecastMonthCount, 1);
  assert.equal(lesson.totalRevenue, 600);
  assert.equal(lesson.totalProfit, juneRows[0].estimatedProfit);
});

test("explains which inputs block unknown season months without flagging zero-lesson months", () => {
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    teachers,
    locations,
    lessons: [lessons[0]],
    closures: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
    savedMonths: [],
  });

  const lesson = forecast.lessons[0];
  assert.deepEqual(lesson.months[0].missingInputs, ["contribution", "attendance"]);
  assert.equal(lesson.months[1].status, "no_lessons");
  assert.deepEqual(lesson.months[1].missingInputs, []);
});

test("explains missing attendance in an incomplete saved month", () => {
  const incompleteRows = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers,
    locations,
    lessons,
    closures: [],
    lessonInputs: [
      { lessonId: 1, attendance: 10, lessonCountOverride: null },
      { lessonId: 2, attendance: null, lessonCountOverride: null },
    ],
    contributionRevenueCents: 300_00,
  }).map(({ lessonCostCents: _ignored, ...row }) => row);

  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    teachers,
    locations,
    lessons,
    closures: [],
    savedMonths: [{ month: "2026-09-01", contributionRevenue: 300, lessonProfitability: incompleteRows }],
  });

  for (const lesson of forecast.lessons) {
    assert.equal(lesson.months[0].status, "unknown");
    assert.deepEqual(lesson.months[0].missingInputs, ["attendance"]);
  }
});

test("treats a fully closed month as a known zero result", () => {
  const [row] = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers,
    locations,
    lessons: [lessons[0]],
    closures: [{ startDate: "2026-09-01", endDate: "2026-09-30" }],
    lessonInputs: [{ lessonId: 1, attendance: null, lessonCountOverride: null }],
    contributionRevenueCents: null,
  });

  assert.equal(row.effectiveCount, 0);
  assert.equal(row.estimatedProfit, 0);
  assert.equal(row.status, "healthy");
});

test("projects future months from the latest attendance and contribution while honoring closures", () => {
  const septemberRows = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers,
    locations,
    lessons,
    closures: [],
    lessonInputs: [
      { lessonId: 1, attendance: 10, lessonCountOverride: null },
      { lessonId: 2, attendance: 20, lessonCountOverride: null },
    ],
    contributionRevenueCents: 300_00,
  }).map(({ lessonCostCents: _ignored, ...row }) => row);

  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-11-30",
    teachers,
    locations,
    lessons,
    closures: [{ startDate: "2026-10-12", endDate: "2026-10-18" }],
    savedMonths: [{ month: "2026-09-01", contributionRevenue: 300, lessonProfitability: septemberRows }],
  });

  const beginners = forecast.lessons.find(lesson => lesson.lessonId === 1);
  assert.ok(beginners);
  assert.equal(beginners.months[0].status, "actual");
  assert.equal(beginners.months[1].status, "forecast");
  assert.equal(beginners.months[1].attendance, 10);
  assert.equal(beginners.months[1].lessonCount, 3);
  assert.equal(beginners.months[2].lessonCount, 5);
});

test("allocates every monthly rent term across all scheduled season lessons", () => {
  const monthlyLocations = [{ id: 1, name: "Zaal 2", rentFrequency: "month", rentCents: 600_01, rentTermCount: 12 }];
  const seasonLessons = [
    { ...lessons[0], teacherId: null, activeFrom: "2026-09-01", activeUntil: "2026-11-30" },
    { ...lessons[1], teacherId: null, activeFrom: "2026-09-01", activeUntil: "2026-11-30" },
  ];
  const closures = [{ startDate: "2026-10-01", endDate: "2026-10-31" }];
  const seasonRentContext = { startDate: "2026-09-01", endDate: "2026-11-30", lessons: seasonLessons };
  const monthlyCosts = ["2026-09-01", "2026-10-01", "2026-11-01"].map(month =>
    lessonProfitabilityForMonth({
      month,
      teachers: [],
      locations: monthlyLocations,
      lessons: seasonLessons.filter(lesson => lesson.activeFrom <= `${month.slice(0, 7)}-30` && lesson.activeUntil >= month),
      closures,
      lessonInputs: seasonLessons.map(lesson => ({ lessonId: lesson.id, attendance: 10, lessonCountOverride: null })),
      contributionRevenueCents: 1_000_00,
      seasonRentContext,
    }).reduce((sum, row) => sum + row.lessonCostCents, 0)
  );

  assert.equal(monthlyCosts[1], 0);
  assert.equal(monthlyCosts.reduce((sum, value) => sum + value, 0), 7_200_12);
});

test("explains monthly venue rent with cent-exact contract and lesson totals", () => {
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-11-30",
    teachers: [],
    locations: [{ id: 1, name: "Zaal 2", rentFrequency: "month", rentCents: 600_01, rentTermCount: 3 }],
    lessons: lessons.map(lesson => ({ ...lesson, teacherId: null })),
    closures: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
    savedMonths: [],
  });

  assert.deepEqual(forecast.locationRentBreakdowns, [{
    locationId: 1,
    locationName: "Zaal 2",
    rentPerTerm: 600.01,
    rentTermCount: 3,
    contractTotal: 1800.03,
    scheduledLessonCount: 18,
    allocatedCost: 1800.03,
    previouslyAllocatedCost: 0,
    remainingAllocatedCost: 1800.03,
    unallocatedCost: 0,
    remainingScheduledLessonCount: 18,
    lessons: [
      { lessonId: 1, lessonName: "Beginners", scheduledLessonCount: 9, allocatedCost: 900.01 },
      { lessonId: 2, lessonName: "Gevorderd", scheduledLessonCount: 9, allocatedCost: 900.02 },
    ],
  }]);
  assert.equal(forecast.lessons.reduce((sum, lesson) => sum + lesson.totalLocationRentCost, 0), 1800.03);
  for (const lesson of forecast.lessons) {
    assert.equal(
      lesson.totalLocationRentCost,
      lesson.months.reduce((sum, month) => sum + month.locationRentCost, 0),
    );
  }
});

test("explains hourly rent from rate, lesson duration and occurrences with the exact charged total", () => {
  const [row] = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers: [],
    locations: [{ id: 1, name: "Uurzaal", rentFrequency: "hour", rentCents: 1999, rentTermCount: null }],
    lessons: [{ ...lessons[0], teacherId: null, durationMinutes: 45 }],
    closures: [],
    lessonInputs: [{ lessonId: 1, attendance: 10, lessonCountOverride: null }],
    contributionRevenueCents: 300_00,
  });

  assert.deepEqual(row.locationRentCalculation, {
    frequency: "hour",
    rate: 19.99,
    durationMinutes: 45,
    lessonCount: 4,
    totalCost: 59.97,
  });
  assert.equal(row.locationRentCalculation.totalCost, row.locationRentCost);
});

test("explains session rent from rate and occurrences with the exact charged total", () => {
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    teachers: [],
    locations: [{ id: 1, name: "Sessiezaal", rentFrequency: "session", rentCents: 2345, rentTermCount: null }],
    lessons: [{ ...lessons[0], teacherId: null }],
    closures: [],
    savedMonths: [],
  });

  assert.deepEqual(forecast.lessons[0].locationRentCalculation, {
    frequency: "session",
    rate: 23.45,
    durationMinutes: null,
    lessonCount: 4,
    totalCost: 93.8,
  });
  assert.equal(forecast.lessons[0].locationRentCalculation.totalCost, forecast.lessons[0].totalLocationRentCost);
});

test("does not claim one season formula after hourly rent changes to monthly rent", () => {
  const seasonLesson = { ...lessons[0], teacherId: null, activeUntil: "2026-10-31" };
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    teachers: [],
    locations: [{ id: 1, name: "Studio", rentFrequency: "month", rentCents: 120_00, rentTermCount: 1 }],
    lessons: [seasonLesson],
    closures: [],
    savedMonths: [{
      month: "2026-09-01",
      contributionRevenue: 100,
      lessonProfitability: [{
        lessonId: 1, lessonName: "Beginners", locationId: 1, locationName: "Studio",
        autoCount: 4, effectiveCount: 4, attendance: 10, lessonCost: 80, locationRentCost: 80,
        locationRentCalculation: { frequency: "hour", rate: 20, durationMinutes: 60, lessonCount: 4, totalCost: 80 },
        estimatedRevenue: 100, estimatedProfit: 20, breakEvenAttendance: 8, promotionGap: null, status: "healthy",
      }],
    }],
  });

  assert.equal(forecast.lessons[0].months[0].locationRentCalculation?.frequency, "hour");
  assert.equal(forecast.lessons[0].months[1].locationRentCalculation, null);
  assert.equal(forecast.lessons[0].locationRentCalculation, null);
});

test("preserves explicit historical monthly rent when the current contract is hourly", () => {
  const seasonLesson = { ...lessons[0], teacherId: null, activeUntil: "2026-10-31" };
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    teachers: [],
    locations: [{ id: 1, name: "Studio", rentFrequency: "hour", rentCents: 20_00, rentTermCount: null }],
    lessons: [seasonLesson],
    closures: [],
    savedMonths: [{
      month: "2026-09-01",
      contributionRevenue: 100,
      lessonProfitability: [{
        lessonId: 1, lessonName: "Beginners", locationId: 1, locationName: "Studio",
        autoCount: 4, effectiveCount: 4, attendance: 10, lessonCost: 120, locationRentCost: 120,
        locationRentCalculation: null,
        estimatedRevenue: 100, estimatedProfit: -20, breakEvenAttendance: 12, promotionGap: 2, status: "loss",
      }],
    }],
  });

  assert.equal(forecast.lessons[0].months[0].locationRentCalculation, null);
  assert.equal(forecast.lessons[0].months[1].locationRentCalculation?.frequency, "hour");
  assert.equal(forecast.lessons[0].locationRentCalculation, null);
});

test("reports monthly rent that cannot be assigned to any season lesson", () => {
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-11-30",
    teachers: [],
    locations: [{ id: 9, name: "Ongebruikte zaal", rentFrequency: "month", rentCents: 250_00, rentTermCount: 3 }],
    lessons: [],
    closures: [],
    savedMonths: [],
  });

  assert.deepEqual(forecast.unallocatedLocations, [{
    locationId: 9,
    locationName: "Ongebruikte zaal",
    totalCost: 750,
  }]);
  assert.deepEqual(forecast.locationRentBreakdowns[0], {
    locationId: 9,
    locationName: "Ongebruikte zaal",
    rentPerTerm: 250,
    rentTermCount: 3,
    contractTotal: 750,
    scheduledLessonCount: 0,
    allocatedCost: 0,
    previouslyAllocatedCost: 0,
    remainingAllocatedCost: 0,
    unallocatedCost: 750,
    remainingScheduledLessonCount: 0,
    lessons: [],
  });
});

test("allocates only the remaining contract rent after an immutable saved month", () => {
  const monthlyLocations = [{ id: 1, name: "Studio", rentFrequency: "month", rentCents: 120_00, rentTermCount: 1 }];
  const changedLessons = [{
    id: 1,
    name: "Maandagles",
    teacherId: null,
    locationId: 1,
    weekday: 1,
    durationMinutes: 60,
    activeFrom: "2026-09-01",
    activeUntil: "2026-11-30",
  }];
  const savedRow = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers: [],
    locations: monthlyLocations,
    lessons: changedLessons,
    closures: [],
    lessonInputs: [{ lessonId: 1, attendance: 10, lessonCountOverride: null }],
    contributionRevenueCents: 100_00,
    seasonRentContext: { startDate: "2026-09-01", endDate: "2026-11-30", lessons: changedLessons },
  })[0];

  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-11-30",
    teachers: [],
    locations: monthlyLocations,
    lessons: changedLessons,
    closures: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
    savedMonths: [{
      month: "2026-09-01",
      contributionRevenue: 100,
      lessonProfitability: [{ ...savedRow, lessonCostCents: undefined } as Omit<typeof savedRow, "lessonCostCents">],
      _locationRentAllocationsCents: [{ locationId: 1, amountCents: savedRow.lessonCostCents }],
    }],
  });

  assert.equal(forecast.lessons[0].months.find(month => month.month === "2026-10-01")?.cost, 0);
  assert.equal(forecast.lessons[0].totalCost, 120);
  assert.deepEqual(forecast.locationRentBreakdowns[0], {
    locationId: 1,
    locationName: "Studio",
    rentPerTerm: 120,
    rentTermCount: 1,
    contractTotal: 120,
    scheduledLessonCount: 9,
    allocatedCost: 120,
    previouslyAllocatedCost: savedRow.locationRentCost,
    remainingAllocatedCost: 120 - savedRow.locationRentCost,
    unallocatedCost: 0,
    remainingScheduledLessonCount: 5,
    lessons: [{
      lessonId: 1,
      lessonName: "Maandagles",
      scheduledLessonCount: 9,
      allocatedCost: 120,
    }],
  });
});

test("warns when immutable saved rent exceeds a lowered contract without negative future costs", () => {
  const monthlyLocations = [{ id: 1, name: "Studio", rentFrequency: "month", rentCents: 20_00, rentTermCount: 1 }];
  const seasonLesson = {
    id: 1,
    name: "Maandagles",
    teacherId: null,
    locationId: 1,
    weekday: 1,
    durationMinutes: 60,
    activeFrom: "2026-09-01",
    activeUntil: "2026-10-31",
  };
  const savedLocationRentCost = 60;
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    teachers: [],
    locations: monthlyLocations,
    lessons: [seasonLesson],
    closures: [],
    savedMonths: [{
      month: "2026-09-01",
      contributionRevenue: 100,
      lessonProfitability: [{
        lessonId: 1,
        lessonName: "Maandagles",
        locationId: 1,
        locationName: "Studio",
        autoCount: 4,
        effectiveCount: 4,
        attendance: 10,
        lessonCost: savedLocationRentCost,
        locationRentCost: savedLocationRentCost,
        locationRentCalculation: null,
        estimatedRevenue: 100,
        estimatedProfit: 40,
        breakEvenAttendance: 6,
        promotionGap: null,
        status: "healthy",
      }],
      _locationRentAllocationsCents: [{ locationId: 1, amountCents: savedLocationRentCost * 100 }],
    }],
  });

  assert.deepEqual(forecast.overallocatedLocations, [{
    locationId: 1,
    locationName: "Studio",
    previouslyAllocatedCost: 60,
    contractTotal: 20,
  }]);
  assert.equal(forecast.lessons[0].months.find(month => month.month === "2026-09-01")?.locationRentCost, 60);
  assert.equal(forecast.lessons[0].months.find(month => month.month === "2026-10-01")?.locationRentCost, 0);
  assert.equal(forecast.locationRentBreakdowns[0].remainingAllocatedCost, 0);
});

test("does not call the unassignable remainder allocated after the only saved lesson month", () => {
  const monthlyLocations = [{ id: 1, name: "Studio", rentFrequency: "month", rentCents: 120_00, rentTermCount: 1 }];
  const oneLesson = [{
    id: 1,
    name: "Maandagles",
    teacherId: null,
    locationId: 1,
    weekday: 1,
    durationMinutes: 60,
    activeFrom: "2026-09-01",
    activeUntil: "2026-10-31",
  }];
  const savedRow = lessonProfitabilityForMonth({
    month: "2026-09-01",
    teachers: [],
    locations: monthlyLocations,
    lessons: oneLesson,
    closures: [],
    lessonInputs: [{ lessonId: 1, attendance: 10, lessonCountOverride: null }],
    contributionRevenueCents: 100_00,
    seasonRentContext: { startDate: "2026-09-01", endDate: "2026-10-31", lessons: oneLesson },
  })[0];
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    teachers: [],
    locations: monthlyLocations,
    lessons: oneLesson,
    closures: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
    savedMonths: [{
      month: "2026-09-01",
      contributionRevenue: 100,
      lessonProfitability: [{ ...savedRow, lessonCostCents: undefined } as Omit<typeof savedRow, "lessonCostCents">],
      _locationRentAllocationsCents: [{ locationId: 1, amountCents: savedRow.lessonCostCents }],
    }],
  });

  const breakdown = forecast.locationRentBreakdowns[0];
  assert.equal(breakdown.remainingScheduledLessonCount, 0);
  assert.equal(breakdown.remainingAllocatedCost, 0);
  assert.equal(breakdown.allocatedCost, savedRow.locationRentCost);
  assert.equal(breakdown.unallocatedCost, 120 - savedRow.locationRentCost);
  assert.equal(breakdown.allocatedCost, breakdown.lessons.reduce((sum, lesson) => sum + lesson.allocatedCost, 0));
});

test("keeps lesson allocations grouped under the correct monthly venue", () => {
  const forecast = buildLessonSeasonForecast({
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    teachers: [],
    locations: [
      { id: 1, name: "Studio Noord", rentFrequency: "month", rentCents: 100_00, rentTermCount: 1 },
      { id: 2, name: "Studio Zuid", rentFrequency: "month", rentCents: 200_00, rentTermCount: 1 },
    ],
    lessons: [
      { ...lessons[0], teacherId: null, locationId: 1, activeUntil: "2026-09-30" },
      { ...lessons[1], teacherId: null, locationId: 2, activeUntil: "2026-09-30" },
    ],
    closures: [],
    savedMonths: [],
  });

  assert.deepEqual(
    forecast.locationRentBreakdowns.map(location => ({
      locationName: location.locationName,
      lessons: location.lessons.map(lesson => lesson.lessonName),
      allocatedCost: location.allocatedCost,
    })),
    [
      { locationName: "Studio Noord", lessons: ["Beginners"], allocatedCost: 100 },
      { locationName: "Studio Zuid", lessons: ["Gevorderd"], allocatedCost: 200 },
    ],
  );
});