import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  financialActivitiesTable,
  financialFixedCostsTable,
  financialLessonMonthInputsTable,
  financialLessonsTable,
  financialMonthsTable,
  financialSeasonsTable,
  financialTeachersTable,
  participantsTable,
  pool,
  type Participant,
} from "@workspace/db";
import {
  GetFinancialMonthResponse,
  GetFinancialSeasonResponse,
  UpsertFinancialMonthResponse,
} from "@workspace/api-zod";
import {
  createFinancialRouter,
  INVALID_FINANCIAL_HISTORY_ERROR_CODE,
} from "./financial.ts";
import {
  backfillLegacyFinancialMonthSnapshots,
  CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION,
  FINANCIAL_SNAPSHOT_NON_MIGRATABLE_REASONS,
  type FinancialSnapshotNonMigratableReason,
  UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT_ERROR_CODE,
} from "../services/financialSnapshot.ts";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";

test("financial snapshot migration reports only support recognized reasons", () => {
  const acceptsReason = (reason: FinancialSnapshotNonMigratableReason) => reason;

  assert.deepEqual(FINANCIAL_SNAPSHOT_NON_MIGRATABLE_REASONS, [
    "MONTH_NOT_FOUND",
    "SEASON_NOT_FOUND",
  ]);
  for (const reason of FINANCIAL_SNAPSHOT_NON_MIGRATABLE_REASONS) {
    assert.equal(acceptsReason(reason), reason);
  }
  // @ts-expect-error Unknown migration reasons must fail the API server typecheck.
  acceptsReason("UNKNOWN_REASON");
});

const seasonBody = (name: string) => ({
  name,
  startDate: "2026-09-01",
  endDate: "2026-11-30",
  country: "Nederland",
  hasStarterDeduction: true,
  defaultSalary: 500,
  teachers: [{ clientId: "teacher", name: "Docent", hourlyRate: 30, weeklyTravel: 10 }],
  locations: [{ clientId: "location", name: "Studio", rentFrequency: "month", rent: 20, rentTermCount: 3, sessionMinutes: null }],
  subscriptions: [
    {
      name: "Volwassenen per vier weken",
      audience: "adult",
      productType: "subscription",
      paymentFrequency: "four_weekly",
      price: 50,
      installmentCount: null,
      durationMonths: null,
      rideCount: null,
      validityMonths: null as number | null,
      vatRate: 21,
    },
    {
      name: "Jaarabonnement in drie termijnen",
      audience: "youth",
      productType: "subscription",
      paymentFrequency: "installments",
      price: 360,
      installmentCount: 3,
      durationMonths: 12,
      rideCount: null,
      validityMonths: null as number | null,
      vatRate: 9,
    },
    {
      name: "Tienrittenkaart",
      audience: "adult",
      productType: "punch_card",
      paymentFrequency: "one_time",
      price: 95,
      installmentCount: null,
      durationMonths: null,
      rideCount: 10,
      validityMonths: 6,
      vatRate: 21,
    },
    {
      name: "Onbeperkt geldige vijfrittenkaart",
      audience: "adult",
      productType: "punch_card",
      paymentFrequency: "one_time",
      price: 55,
      installmentCount: null,
      durationMonths: null,
      rideCount: 5,
      validityMonths: null as number | null,
      vatRate: 21,
    },
  ],
  lessons: [{
    teacherClientId: "teacher",
    locationClientId: "location",
    name: "Dansles",
    weekday: 1,
    startTime: "19:00",
    durationMinutes: 60,
    activeFrom: "2026-09-01",
    activeUntil: "2026-11-30",
  }],
  closures: [{ name: "Herfststop", startDate: "2026-10-12", endDate: "2026-10-18" }],
});

const monthBody = (
  lessonId: number,
  contributionRevenue: number,
  attendance: number | null = 20,
  lessonCountOverride: number | null = null,
) => ({
  expectedUpdatedAt: null,
  contributionRevenue,
  taxArrears: 25,
  salaryOverride: null,
  fixedCosts: [
    { group: "Marketing", description: "Advertenties", frequency: "monthly", amount: 60 },
    { group: "Marketing", description: "Drukwerk", frequency: "one_time", amount: 40 },
  ],
  activities: [{ name: "Workshop", amount: 250 }],
  lessonInputs: [{ lessonId, attendance, lessonCountOverride }],
});

async function setUpIndependentCheck() {
  const isolatedDatabase = await createIsolatedTestDatabase("financial_test");
  const database = isolatedDatabase.db;
  let closeServer: (() => Promise<void>) | undefined;
  let beforeFinancialMonthResponse: ((updatedAt: string) => Promise<void>) | undefined;
  let beforeFinancialSeasonMasterSave: (() => Promise<void>) | undefined;

  try {
    const marker = `${Date.now()}-${process.pid}`;
    const [owner, outsider] = await database.insert(participantsTable).values([
      { schoolName: `Financieel eigenaar ${marker}`, contactName: "Eigenaar", email: `financial-owner-${marker}@example.test` },
      { schoolName: `Andere school ${marker}`, contactName: "Ander", email: `financial-other-${marker}@example.test` },
    ]).returning();

  let baseUrl = "";
  const request = async (
    path: string,
    participant: Participant,
    options: { method?: string; body?: unknown; admin?: boolean } = {},
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-participant-id": String(participant.id),
        ...(options.admin ? { "x-admin": "true" } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json() as any;
    return { status: response.status, body };
  };

  const app = express();
  app.use(express.json());
  app.use(createFinancialRouter({
    database,
    participantForRequest: async (req) => {
      const id = Number(req.headers["x-participant-id"]);
      return id === owner.id ? owner : id === outsider.id ? outsider : null;
    },
    signedInMiddleware: (_req, _res, next) => next(),
    adminMiddleware: (req, res, next) => {
      if (req.headers["x-admin"] !== "true") return void res.status(403).json({ error: "Alleen admins hebben toegang tot dit onderdeel." });
      next();
    },
    beforeFinancialMonthResponse: (updatedAt) => beforeFinancialMonthResponse?.(updatedAt) ?? Promise.resolve(),
    beforeFinancialSeasonMasterSave: () => beforeFinancialSeasonMasterSave?.() ?? Promise.resolve(),
  }));
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Test transaction failed." });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

  const ownerCreated = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Eigen seizoen") });
  const outsiderCreated = await request("/financial/seasons", outsider, { method: "POST", body: seasonBody("Ander seizoen") });
  assert.equal(ownerCreated.status, 201);
  assert.equal(outsiderCreated.status, 201);

  const ownerSeasonId = ownerCreated.body.id as number;
  const outsiderSeasonId = outsiderCreated.body.id as number;
  const ownerDetail = (await request(`/financial/seasons/${ownerSeasonId}`, owner)).body;
  const outsiderDetail = (await request(`/financial/seasons/${outsiderSeasonId}`, outsider)).body;
  const ownerLessonId = ownerDetail.lessons[0].id as number;
  const outsiderLessonId = outsiderDetail.lessons[0].id as number;

  return {
    database,
    owner,
    outsider,
    ownerSeasonId,
    outsiderSeasonId,
    ownerLessonId,
    outsiderLessonId,
    ownerDetail,
    outsiderDetail,
    request,
    set beforeFinancialMonthResponse(hook: ((updatedAt: string) => Promise<void>) | undefined) {
      beforeFinancialMonthResponse = hook;
    },
    set beforeFinancialSeasonMasterSave(hook: (() => Promise<void>) | undefined) {
      beforeFinancialSeasonMasterSave = hook;
    },
    async dispose() {
      try {
        await closeServer?.();
      } finally {
        await isolatedDatabase.dispose();
      }
    },
  };
  } catch (error) {
    try {
      await closeServer?.();
    } finally {
      await isolatedDatabase.dispose();
    }
    throw error;
  }
}

after(async () => {
  await pool.end();
});

type IndependentCheck = Awaited<ReturnType<typeof setUpIndependentCheck>>;
// Each active check owns one node-postgres pool (default maximum: 10
// connections), in addition to the shared setup pool. Four checks therefore
// cap the theoretical demand at 50 connections, below half of the test
// database's measured 112-connection budget, while preserving parallel speed.
const FINANCIAL_TEST_CONCURRENCY = 4;

const financialTest = (name: string, run: (check: IndependentCheck) => Promise<void>) => {
  test(name, { concurrency: true }, async () => {
    let check: IndependentCheck | undefined;
    try {
      check = await setUpIndependentCheck();
      await run(check);
    } finally {
      await check?.dispose();
    }
  });
};

describe(
  "financial routes preserve tenant privacy, snapshots, transactions, and response parity",
  { concurrency: FINANCIAL_TEST_CONCURRENCY },
  () => {

  financialTest("season master data preserves all financial product details", async ({ ownerDetail }) => {
    assert.equal(ownerDetail.locations[0].rentTermCount, 3);

    assert.deepEqual(ownerDetail.subscriptions.map((subscription: any) => ({
      name: subscription.name,
      productType: subscription.productType,
      paymentFrequency: subscription.paymentFrequency,
      installmentCount: subscription.installmentCount,
      durationMonths: subscription.durationMonths,
      rideCount: subscription.rideCount,
      validityMonths: subscription.validityMonths,
    })), [
    {
      name: "Volwassenen per vier weken",
      productType: "subscription",
      paymentFrequency: "four_weekly",
      installmentCount: null,
      durationMonths: null,
      rideCount: null,
      validityMonths: null,
    },
    {
      name: "Jaarabonnement in drie termijnen",
      productType: "subscription",
      paymentFrequency: "installments",
      installmentCount: 3,
      durationMonths: 12,
      rideCount: null,
      validityMonths: null,
    },
    {
      name: "Tienrittenkaart",
      productType: "punch_card",
      paymentFrequency: "one_time",
      installmentCount: null,
      durationMonths: null,
      rideCount: 10,
      validityMonths: 6,
    },
    {
      name: "Onbeperkt geldige vijfrittenkaart",
      productType: "punch_card",
      paymentFrequency: "one_time",
      installmentCount: null,
      durationMonths: null,
      rideCount: 5,
      validityMonths: null,
    },
    ]);
  });

  financialTest("season route preserves hourly and session rent calculations through the generated API contract", async ({ request, owner }) => {
    const body: any = seasonBody("Huurrekensommen via API");
    body.locations = [
      {
        clientId: "hourly-location",
        name: "Studio per uur",
        rentFrequency: "hour",
        rent: 13.37,
        rentTermCount: null,
        sessionMinutes: null,
      },
      {
        clientId: "session-location",
        name: "Studio per sessie",
        rentFrequency: "session",
        rent: 8.39,
        rentTermCount: null,
        sessionMinutes: 60,
      },
      {
        clientId: "monthly-location",
        name: "Studio per maand",
        rentFrequency: "month",
        rent: 20,
        rentTermCount: 3,
        sessionMinutes: null,
      },
    ];
    body.lessons = [
      {
        ...body.lessons[0],
        locationClientId: "hourly-location",
        name: "Les met uurhuur",
        weekday: 1,
        durationMinutes: 75,
      },
      {
        ...body.lessons[0],
        locationClientId: "session-location",
        name: "Les met sessiehuur",
        weekday: 2,
      },
      {
        ...body.lessons[0],
        locationClientId: "monthly-location",
        name: "Les met maandhuur",
        weekday: 3,
      },
    ];

    const created = await request("/financial/seasons", owner, { method: "POST", body });
    assert.equal(created.status, 201);
    const response = await request(`/financial/seasons/${created.body.id}`, owner);
    assert.equal(response.status, 200);

    const contractResult = GetFinancialSeasonResponse.safeParse(response.body);
    assert.equal(
      contractResult.success,
      true,
      contractResult.success ? undefined : contractResult.error.message,
    );

    const forecasts = response.body.lessonSeasonForecast.lessons as Array<{
      lessonName: string;
      locationRentCalculation: unknown;
      months: Array<{ locationRentCalculation: unknown }>;
    }>;
    const monthlyForecast = forecasts.find(forecast => forecast.lessonName === "Les met maandhuur");
    assert.equal(monthlyForecast?.locationRentCalculation, null);
    assert.ok(monthlyForecast?.months.every(month => month.locationRentCalculation === null));
    assert.deepEqual(
      forecasts.find(forecast => forecast.lessonName === "Les met uurhuur")?.locationRentCalculation,
      {
        frequency: "hour",
        rate: 13.37,
        durationMinutes: 75,
        lessonCount: 12,
        totalCost: 200.55,
      },
    );
    assert.deepEqual(
      forecasts.find(forecast => forecast.lessonName === "Les met sessiehuur")?.locationRentCalculation,
      {
        frequency: "session",
        rate: 8.39,
        durationMinutes: null,
        lessonCount: 12,
        totalCost: 100.68,
      },
    );

    const missingLessonCalculation = structuredClone(response.body);
    delete missingLessonCalculation.lessonSeasonForecast.lessons[0].locationRentCalculation;
    assert.equal(GetFinancialSeasonResponse.safeParse(missingLessonCalculation).success, false);

    const missingMonthCalculation = structuredClone(response.body);
    delete missingMonthCalculation.lessonSeasonForecast.lessons[0].months[0].locationRentCalculation;
    assert.equal(GetFinancialSeasonResponse.safeParse(missingMonthCalculation).success, false);
  });

  financialTest("month GET and PUT preserve hourly and session rent calculations through the generated API contract", async ({ request, owner }) => {
    const body: any = seasonBody("Maandhuurrekensommen via API");
    body.locations = [
      {
        clientId: "hourly-location",
        name: "Studio per uur",
        rentFrequency: "hour",
        rent: 13.37,
        rentTermCount: null,
        sessionMinutes: null,
      },
      {
        clientId: "session-location",
        name: "Studio per sessie",
        rentFrequency: "session",
        rent: 8.39,
        rentTermCount: null,
        sessionMinutes: 60,
      },
    ];
    body.lessons = [
      {
        ...body.lessons[0],
        locationClientId: "hourly-location",
        name: "Maandles met uurhuur",
        weekday: 1,
        durationMinutes: 75,
      },
      {
        ...body.lessons[0],
        locationClientId: "session-location",
        name: "Maandles met sessiehuur",
        weekday: 2,
      },
    ];

    const created = await request("/financial/seasons", owner, { method: "POST", body });
    assert.equal(created.status, 201);
    const season = await request(`/financial/seasons/${created.body.id}`, owner);
    assert.equal(season.status, 200);
    const lessons = season.body.lessons as Array<{ id: number; name: string }>;
    const hourlyLessonId = lessons.find(lesson => lesson.name === "Maandles met uurhuur")!.id;
    const sessionLessonId = lessons.find(lesson => lesson.name === "Maandles met sessiehuur")!.id;
    const path = `/financial/seasons/${created.body.id}/months/2026-09-01`;
    const input = {
      ...monthBody(hourlyLessonId, 2000),
      lessonInputs: [
        { lessonId: hourlyLessonId, attendance: 20, lessonCountOverride: 3 },
        { lessonId: sessionLessonId, attendance: 15, lessonCountOverride: 2 },
      ],
    };

    const putResponse = await request(path, owner, { method: "PUT", body: input });
    assert.equal(putResponse.status, 200);
    const putContract = UpsertFinancialMonthResponse.safeParse(putResponse.body);
    assert.equal(
      putContract.success,
      true,
      putContract.success ? undefined : putContract.error.message,
    );

    const getResponse = await request(path, owner);
    assert.equal(getResponse.status, 200);
    const getContract = GetFinancialMonthResponse.safeParse(getResponse.body);
    assert.equal(
      getContract.success,
      true,
      getContract.success ? undefined : getContract.error.message,
    );
    assert.deepEqual(getResponse.body, putResponse.body);

    const profitability = getResponse.body.lessonProfitability as Array<{
      lessonName: string;
      locationRentCalculation: unknown;
    }>;
    assert.deepEqual(
      profitability.find(row => row.lessonName === "Maandles met uurhuur")?.locationRentCalculation,
      {
        frequency: "hour",
        rate: 13.37,
        durationMinutes: 75,
        lessonCount: 3,
        totalCost: 50.14,
      },
    );
    assert.deepEqual(
      profitability.find(row => row.lessonName === "Maandles met sessiehuur")?.locationRentCalculation,
      {
        frequency: "session",
        rate: 8.39,
        durationMinutes: null,
        lessonCount: 2,
        totalCost: 16.78,
      },
    );
  });

  financialTest("different concurrent edits based on the same month version cannot silently overwrite each other", async ({ request, owner, database }) => {
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Gelijktijdig opslaan") });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const lessonId = (await request(`/financial/seasons/${seasonId}`, owner)).body.lessons[0].id as number;
    const path = `/financial/seasons/${seasonId}/months/2026-09-01`;
    const first = {
      ...monthBody(lessonId, 1111, 11, 1),
      taxArrears: 11,
      fixedCosts: [{ group: "Eerste", description: "Alleen eerste", frequency: "monthly", amount: 101 }],
      activities: [{ name: "Eerste activiteit", amount: 201 }],
    };
    const second = {
      ...monthBody(lessonId, 2222, 22, 2),
      taxArrears: 22,
      fixedCosts: [
        { group: "Tweede", description: "Tweede A", frequency: "one_time", amount: 302 },
        { group: "Tweede", description: "Tweede B", frequency: "monthly", amount: 402 },
      ],
      activities: [{ name: "Tweede activiteit", amount: 502 }],
    };

    const initialSave = await request(path, owner, { method: "PUT", body: first });
    assert.equal(initialSave.status, 200);
    const version = initialSave.body.updatedAt as string;
    const responses = await Promise.all([
      request(path, owner, { method: "PUT", body: { ...first, expectedUpdatedAt: version, contributionRevenue: 1333 } }),
      request(path, owner, { method: "PUT", body: { ...second, expectedUpdatedAt: version } }),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.match(responses.find(response => response.status === 409)?.body.error, /intussen door iemand anders gewijzigd/i);

    const months = await database.select().from(financialMonthsTable).where(and(
      eq(financialMonthsTable.seasonId, seasonId),
      eq(financialMonthsTable.month, "2026-09-01"),
    ));
    assert.equal(months.length, 1);
    const [month] = months;
    const [fixedCosts, activities, lessonInputs] = await Promise.all([
      database.select().from(financialFixedCostsTable).where(eq(financialFixedCostsTable.financialMonthId, month.id)),
      database.select().from(financialActivitiesTable).where(eq(financialActivitiesTable.financialMonthId, month.id)),
      database.select().from(financialLessonMonthInputsTable).where(eq(financialLessonMonthInputsTable.financialMonthId, month.id)),
    ]);
    const stored = {
      contributionRevenueCents: month.contributionRevenueCents,
      taxArrearsCents: month.taxArrearsCents,
      fixedCosts: fixedCosts.map(item => [item.costGroup, item.category, item.frequency, item.amountCents]),
      activities: activities.map(item => [item.name, item.amountCents]),
      lessonInputs: lessonInputs.map(item => [item.lessonId, item.attendance, item.lessonCountOverride]),
    };
    const expectedFirst = {
      contributionRevenueCents: 133300,
      taxArrearsCents: 1100,
      fixedCosts: [["Eerste", "Alleen eerste", "monthly", 10100]],
      activities: [["Eerste activiteit", 20100]],
      lessonInputs: [[lessonId, 11, 1]],
    };
    const expectedSecond = {
      contributionRevenueCents: 222200,
      taxArrearsCents: 2200,
      fixedCosts: [
        ["Tweede", "Tweede A", "one_time", 30200],
        ["Tweede", "Tweede B", "monthly", 40200],
      ],
      activities: [["Tweede activiteit", 50200]],
      lessonInputs: [[lessonId, 22, 2]],
    };
    assert.ok(
      [expectedFirst, expectedSecond].some(expected => {
        try { assert.deepEqual(stored, expected); return true; } catch { return false; }
      }),
      "the successful writer must replace the complete month payload without the stale writer overwriting it",
    );
  });

  financialTest("different concurrent season edits based on the same revision reject exactly one stale writer", async ({ request, owner, ownerSeasonId, ownerDetail }) => {
    const path = `/financial/seasons/${ownerSeasonId}`;
    const first = {
      ...ownerDetail,
      name: "Seizoen van eerste schrijver",
      teachers: ownerDetail.teachers.map((teacher: any) => ({
        ...teacher,
        name: "Docent van eerste schrijver",
        hourlyRate: 41,
        weeklyTravel: 12,
      })),
      subscriptions: ownerDetail.subscriptions.map((subscription: any, index: number) => index === 0
        ? { ...subscription, name: "Abonnement van eerste schrijver", price: 61 }
        : subscription),
      lessons: ownerDetail.lessons.map((lesson: any) => ({
        ...lesson,
        name: "Les van eerste schrijver",
        startTime: "18:00",
      })),
      expectedUpdatedAt: ownerDetail.updatedAt,
    };
    const second = {
      ...ownerDetail,
      name: "Seizoen van tweede schrijver",
      locations: ownerDetail.locations.map((location: any) => ({
        ...location,
        name: "Locatie van tweede schrijver",
        rent: 44,
      })),
      closures: ownerDetail.closures.map((closure: any) => ({
        ...closure,
        name: "Sluiting van tweede schrijver",
        endDate: "2026-10-19",
      })),
      expectedUpdatedAt: ownerDetail.updatedAt,
    };

    const responses = await Promise.all([
      request(path, owner, { method: "PUT", body: first }),
      request(path, owner, { method: "PUT", body: second }),
    ]);

    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.match(responses.find(response => response.status === 409)?.body.error, /intussen door iemand anders gewijzigd/i);
    const winner = responses.find(response => response.status === 200)?.body;
    assert.notEqual(winner.updatedAt, ownerDetail.updatedAt);

    const stored = (await request(path, owner)).body;
    assert.equal(stored.updatedAt, winner.updatedAt);
    assert.equal(stored.name, winner.name);
    assert.deepEqual(stored.teachers, winner.teachers);
    assert.deepEqual(stored.locations, winner.locations);
    assert.deepEqual(stored.subscriptions, winner.subscriptions);
    assert.deepEqual(stored.lessons, winner.lessons);
    assert.deepEqual(stored.closures, winner.closures);
  });

  financialTest("different concurrent admin season edits based on the same revision reject exactly one stale writer", async ({ request, owner, ownerSeasonId, ownerDetail }) => {
    const path = `/admin/financial/participants/${owner.id}/seasons/${ownerSeasonId}`;
    const first = {
      ...ownerDetail,
      name: "Beheerseizoen van eerste schrijver",
      teachers: ownerDetail.teachers.map((teacher: any) => ({
        ...teacher,
        name: "Beheerdocent van eerste schrijver",
        hourlyRate: 41,
        weeklyTravel: 12,
      })),
      subscriptions: ownerDetail.subscriptions.map((subscription: any, index: number) => index === 0
        ? { ...subscription, name: "Beheerabonnement van eerste schrijver", price: 61 }
        : subscription),
      lessons: ownerDetail.lessons.map((lesson: any) => ({
        ...lesson,
        name: "Beheerles van eerste schrijver",
        startTime: "18:00",
      })),
      expectedUpdatedAt: ownerDetail.updatedAt,
    };
    const second = {
      ...ownerDetail,
      name: "Beheerseizoen van tweede schrijver",
      locations: ownerDetail.locations.map((location: any) => ({
        ...location,
        name: "Beheerlocatie van tweede schrijver",
        rent: 44,
      })),
      closures: ownerDetail.closures.map((closure: any) => ({
        ...closure,
        name: "Beheersluiting van tweede schrijver",
        endDate: "2026-10-19",
      })),
      expectedUpdatedAt: ownerDetail.updatedAt,
    };

    const responses = await Promise.all([
      request(path, owner, { method: "PUT", body: first, admin: true }),
      request(path, owner, { method: "PUT", body: second, admin: true }),
    ]);

    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.match(responses.find(response => response.status === 409)?.body.error, /intussen door iemand anders gewijzigd/i);
    const winner = responses.find(response => response.status === 200)?.body;
    assert.ok(winner);
    assert.notEqual(winner.updatedAt, ownerDetail.updatedAt);

    const stored = (await request(path, owner, { admin: true })).body;
    assert.equal(stored.updatedAt, winner.updatedAt);
    assert.equal(stored.name, winner.name);
    assert.deepEqual(stored.teachers, winner.teachers);
    assert.deepEqual(stored.locations, winner.locations);
    assert.deepEqual(stored.subscriptions, winner.subscriptions);
    assert.deepEqual(stored.lessons, winner.lessons);
    assert.deepEqual(stored.closures, winner.closures);
  });

  financialTest("concurrent season replacements do not retain rejected additions or deletions", async ({ request, owner, ownerSeasonId, ownerDetail }) => {
    const path = `/financial/seasons/${ownerSeasonId}`;
    const first = {
      ...ownerDetail,
      name: "Seizoen met toevoegingen van eerste schrijver",
      teachers: [
        ...ownerDetail.teachers,
        { clientId: "first-teacher", name: "Nieuwe docent eerste schrijver", hourlyRate: 42, weeklyTravel: 14 },
      ],
      locations: [
        ...ownerDetail.locations,
        {
          clientId: "first-location",
          name: "Nieuwe locatie eerste schrijver",
          rentFrequency: "month",
          rent: 32,
          rentTermCount: 3,
          sessionMinutes: null,
        },
      ],
      subscriptions: [
        ...ownerDetail.subscriptions.slice(0, 3),
        {
          name: "Aanbod eerste schrijver",
          audience: "adult",
          productType: "subscription",
          paymentFrequency: "four_weekly",
          price: 73,
          installmentCount: null,
          durationMonths: null,
          rideCount: null,
          validityMonths: null,
          vatRate: 21,
        },
      ],
      lessons: [
        ...ownerDetail.lessons,
        {
          teacherClientId: "first-teacher",
          locationClientId: "first-location",
          name: "Les eerste schrijver",
          weekday: 3,
          startTime: "20:00",
          durationMinutes: 75,
          activeFrom: "2026-09-01",
          activeUntil: "2026-11-30",
        },
      ],
      closures: [
        ...ownerDetail.closures,
        { name: "Sluiting eerste schrijver", startDate: "2026-11-02", endDate: "2026-11-08" },
      ],
      expectedUpdatedAt: ownerDetail.updatedAt,
    };
    const second = {
      ...ownerDetail,
      name: "Seizoen met toevoegingen van tweede schrijver",
      teachers: [
        ...ownerDetail.teachers,
        { clientId: "second-teacher", name: "Nieuwe docent tweede schrijver", hourlyRate: 48, weeklyTravel: 16 },
      ],
      locations: [
        ...ownerDetail.locations,
        {
          clientId: "second-location",
          name: "Nieuwe locatie tweede schrijver",
          rentFrequency: "month",
          rent: 38,
          rentTermCount: 3,
          sessionMinutes: null,
        },
      ],
      subscriptions: [
        ...ownerDetail.subscriptions.slice(0, 2),
        ...ownerDetail.subscriptions.slice(3),
        {
          name: "Aanbod tweede schrijver",
          audience: "youth",
          productType: "subscription",
          paymentFrequency: "installments",
          price: 180,
          installmentCount: 2,
          durationMonths: 8,
          rideCount: null,
          validityMonths: null,
          vatRate: 9,
        },
      ],
      lessons: [
        ...ownerDetail.lessons,
        {
          teacherClientId: "second-teacher",
          locationClientId: "second-location",
          name: "Les tweede schrijver",
          weekday: 4,
          startTime: "21:00",
          durationMinutes: 90,
          activeFrom: "2026-09-01",
          activeUntil: "2026-11-30",
        },
      ],
      closures: [
        ...ownerDetail.closures,
        { name: "Sluiting tweede schrijver", startDate: "2026-11-09", endDate: "2026-11-15" },
      ],
      expectedUpdatedAt: ownerDetail.updatedAt,
    };

    const responses = await Promise.all([
      request(path, owner, { method: "PUT", body: first }),
      request(path, owner, { method: "PUT", body: second }),
    ]);

    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.match(responses.find(response => response.status === 409)?.body.error, /intussen door iemand anders gewijzigd/i);
    const winner = responses.find(response => response.status === 200)?.body;
    assert.ok(winner);
    assert.notEqual(winner.updatedAt, ownerDetail.updatedAt);

    const rejected = winner.name === first.name ? second : first;
    const stored = (await request(path, owner)).body;
    assert.deepEqual(stored.teachers, winner.teachers);
    assert.deepEqual(stored.locations, winner.locations);
    assert.deepEqual(stored.subscriptions, winner.subscriptions);
    assert.deepEqual(stored.lessons, winner.lessons);
    assert.deepEqual(stored.closures, winner.closures);
    assert.equal(stored.name, winner.name);
    const rejectedUniqueNames = [
      ["teachers", rejected.teachers.at(-1).name],
      ["locations", rejected.locations.at(-1).name],
      ["subscriptions", rejected.subscriptions.at(-1).name],
      ["lessons", rejected.lessons.at(-1).name],
      ["closures", rejected.closures.at(-1).name],
    ] as const;
    for (const [collection, rejectedName] of rejectedUniqueNames) {
      assert.equal(
        stored[collection].some((record: any) => record.name === rejectedName),
        false,
        `the rejected ${collection} record ${rejectedName} must not remain`,
      );
    }
  });

  financialTest("an admin can retry a rejected season edit with the latest full master data", async ({ request, owner, ownerSeasonId, ownerDetail }) => {
    const path = `/admin/financial/participants/${owner.id}/seasons/${ownerSeasonId}`;
    const competingUpdate = {
      ...ownerDetail,
      name: "Nieuwste beheerderversie",
      expectedUpdatedAt: ownerDetail.updatedAt,
    };
    const competingResponse = await request(path, owner, {
      method: "PUT",
      body: competingUpdate,
      admin: true,
    });
    assert.equal(competingResponse.status, 200);

    const rejectedSubmission = {
      ...ownerDetail,
      name: "Opnieuw bevestigde beheerderversie",
      teachers: [{
        clientId: "retry-teacher",
        name: "Opnieuw bevestigde docent",
        hourlyRate: 47,
        weeklyTravel: 15,
      }],
      locations: [{
        clientId: "retry-location",
        name: "Opnieuw bevestigde locatie",
        rentFrequency: "session",
        rent: 29,
        rentTermCount: null,
        sessionMinutes: 60,
      }],
      lessons: [{
        teacherClientId: "retry-teacher",
        locationClientId: "retry-location",
        name: "Opnieuw bevestigde les",
        weekday: 4,
        startTime: "20:30",
        durationMinutes: 75,
        activeFrom: "2026-09-01",
        activeUntil: "2026-11-30",
      }],
      closures: [],
      expectedUpdatedAt: ownerDetail.updatedAt,
    };
    const rejected = await request(path, owner, {
      method: "PUT",
      body: rejectedSubmission,
      admin: true,
    });
    assert.equal(rejected.status, 409);

    const latest = await request(path, owner, { admin: true });
    assert.equal(latest.status, 200);
    const retriedSubmission = {
      ...rejectedSubmission,
      expectedUpdatedAt: latest.body.updatedAt,
    };
    const retried = await request(path, owner, {
      method: "PUT",
      body: retriedSubmission,
      admin: true,
    });
    assert.equal(retried.status, 200);

    const stored = await request(path, owner, { admin: true });
    assert.equal(stored.status, 200);
    assert.equal(stored.body.updatedAt, retried.body.updatedAt);
    assert.equal(stored.body.name, retried.body.name);
    assert.deepEqual(stored.body.teachers, retried.body.teachers);
    assert.deepEqual(stored.body.locations, retried.body.locations);
    assert.deepEqual(stored.body.subscriptions, retried.body.subscriptions);
    assert.deepEqual(stored.body.lessons, retried.body.lessons);
    assert.deepEqual(stored.body.closures, retried.body.closures);
    assert.equal(stored.body.teachers.some((teacher: any) => teacher.name === ownerDetail.teachers[0].name), false);
    assert.equal(stored.body.locations.some((location: any) => location.name === ownerDetail.locations[0].name), false);
    assert.equal(stored.body.lessons.some((lesson: any) => lesson.name === ownerDetail.lessons[0].name), false);
    assert.deepEqual(stored.body.closures, []);
  });

  financialTest("a concurrent season update and month save persist one complete master-data version", async (check) => {
    const { request, owner, ownerSeasonId, ownerLessonId, ownerDetail, database } = check;
    const path = `/financial/seasons/${ownerSeasonId}/months/2026-09-01`;
    const changedSeason = {
      ...ownerDetail,
      name: "Gewijzigd tijdens maandopslag",
      defaultSalary: 875,
      expectedUpdatedAt: ownerDetail.updatedAt,
      teachers: ownerDetail.teachers.map((teacher: any) => ({
        ...teacher,
        name: "Nieuwe docentversie",
        hourlyRate: 77,
        weeklyTravel: 33,
      })),
      locations: ownerDetail.locations.map((location: any) => ({
        ...location,
        name: "Nieuwe locatieversie",
        rent: 99,
      })),
      lessons: ownerDetail.lessons.map((lesson: any) => ({
        ...lesson,
        name: "Nieuwe lesversie",
        durationMinutes: 90,
      })),
    };
    let releaseSeasonSave!: () => void;
    const seasonSaveMayContinue = new Promise<void>(resolve => { releaseSeasonSave = resolve; });
    let seasonLockAcquired!: () => void;
    const seasonHasLock = new Promise<void>(resolve => { seasonLockAcquired = resolve; });
    check.beforeFinancialSeasonMasterSave = async () => {
      seasonLockAcquired();
      await seasonSaveMayContinue;
    };
    const seasonRequest = request(`/financial/seasons/${ownerSeasonId}`, owner, {
      method: "PUT",
      body: changedSeason,
    });
    await seasonHasLock;
    const monthRequest = request(path, owner, {
      method: "PUT",
      body: monthBody(ownerLessonId, 2400, 24, 4),
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    releaseSeasonSave();

    const [seasonResponse, monthResponse] = await Promise.all([seasonRequest, monthRequest]);
    assert.equal(seasonResponse.status, 200);
    assert.equal(monthResponse.status, 200);

    const [storedMonth] = await database.select().from(financialMonthsTable).where(and(
      eq(financialMonthsTable.seasonId, ownerSeasonId),
      eq(financialMonthsTable.month, "2026-09-01"),
    ));
    const [storedInput] = await database.select().from(financialLessonMonthInputsTable)
      .where(eq(financialLessonMonthInputsTable.financialMonthId, storedMonth.id));
    const snapshot = storedMonth.masterDataSnapshot as any;
    const observedVersion = {
      defaultSalaryCents: snapshot.defaultSalaryCents,
      teacher: [snapshot.teachers[0].name, snapshot.teachers[0].hourlyRateCents, snapshot.teachers[0].weeklyTravelCents],
      location: [snapshot.locations[0].name, snapshot.locations[0].rentCents],
      lesson: [snapshot.lessons[0].name, snapshot.lessons[0].durationMinutes],
    };
    const newVersion = {
      defaultSalaryCents: 87500,
      teacher: ["Nieuwe docentversie", 7700, 3300],
      location: ["Nieuwe locatieversie", 9900],
      lesson: ["Nieuwe lesversie", 90],
    };
    assert.deepEqual(observedVersion, newVersion);
    assert.deepEqual(snapshot.lessonInputs, [{
      lessonId: snapshot.lessons[0].id,
      attendance: 24,
      lessonCountOverride: 4,
    }]);
    assert.deepEqual(
      [storedInput.lessonId, storedInput.attendance, storedInput.lessonCountOverride],
      [snapshot.lessons[0].id, 24, 4],
    );
  });

  financialTest("a concurrent admin season update and admin month save persist one complete master-data version", async (check) => {
    const { request, owner, ownerSeasonId, ownerLessonId, ownerDetail, database } = check;
    const seasonPath = `/admin/financial/participants/${owner.id}/seasons/${ownerSeasonId}`;
    const monthPath = `/admin/financial/participants/${owner.id}/seasons/${ownerSeasonId}/months/2026-09-01`;
    const changedSeason = {
      ...ownerDetail,
      name: "Beheerseizoen gewijzigd tijdens maandopslag",
      defaultSalary: 875,
      expectedUpdatedAt: ownerDetail.updatedAt,
      teachers: ownerDetail.teachers.map((teacher: any) => ({
        ...teacher,
        name: "Nieuwe beheerdocent",
        hourlyRate: 77,
        weeklyTravel: 33,
      })),
      locations: ownerDetail.locations.map((location: any) => ({
        ...location,
        name: "Nieuwe beheerlocatie",
        rent: 99,
      })),
      subscriptions: ownerDetail.subscriptions.map((subscription: any, index: number) => index === 0
        ? { ...subscription, name: "Nieuw beheerabonnement", price: 88 }
        : subscription),
      lessons: ownerDetail.lessons.map((lesson: any) => ({
        ...lesson,
        name: "Nieuwe beheerles",
        durationMinutes: 90,
      })),
      closures: ownerDetail.closures.map((closure: any) => ({
        ...closure,
        name: "Nieuwe beheersluiting",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      })),
    };
    let releaseSeasonSave!: () => void;
    const seasonSaveMayContinue = new Promise<void>(resolve => { releaseSeasonSave = resolve; });
    let seasonLockAcquired!: () => void;
    const seasonHasLock = new Promise<void>(resolve => { seasonLockAcquired = resolve; });
    check.beforeFinancialSeasonMasterSave = async () => {
      seasonLockAcquired();
      await seasonSaveMayContinue;
    };

    const seasonRequest = request(seasonPath, owner, {
      method: "PUT",
      admin: true,
      body: changedSeason,
    });
    await seasonHasLock;
    const monthRequest = request(monthPath, owner, {
      method: "PUT",
      admin: true,
      body: monthBody(ownerLessonId, 2400, 24, 4),
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    releaseSeasonSave();

    const [seasonResponse, monthResponse] = await Promise.all([seasonRequest, monthRequest]);
    assert.equal(seasonResponse.status, 200);
    assert.equal(monthResponse.status, 200);
    assert.equal(seasonResponse.body.name, changedSeason.name);
    assert.equal(seasonResponse.body.defaultSalary, changedSeason.defaultSalary);
    assert.equal(seasonResponse.body.teachers[0].name, "Nieuwe beheerdocent");
    assert.equal(seasonResponse.body.locations[0].name, "Nieuwe beheerlocatie");
    assert.equal(seasonResponse.body.subscriptions[0].name, "Nieuw beheerabonnement");
    assert.equal(seasonResponse.body.subscriptions[0].price, 88);
    assert.equal(seasonResponse.body.lessons[0].name, "Nieuwe beheerles");
    assert.equal(seasonResponse.body.lessons[0].durationMinutes, 90);
    assert.equal(seasonResponse.body.closures[0].name, "Nieuwe beheersluiting");
    assert.equal(seasonResponse.body.closures[0].startDate, "2026-10-01");
    assert.equal(seasonResponse.body.closures[0].endDate, "2026-10-31");

    const [storedMonth] = await database.select().from(financialMonthsTable).where(and(
      eq(financialMonthsTable.seasonId, ownerSeasonId),
      eq(financialMonthsTable.month, "2026-09-01"),
    ));
    const [storedInput] = await database.select().from(financialLessonMonthInputsTable)
      .where(eq(financialLessonMonthInputsTable.financialMonthId, storedMonth.id));
    const snapshot = storedMonth.masterDataSnapshot as any;
    assert.deepEqual({
      defaultSalaryCents: snapshot.defaultSalaryCents,
      teacher: [snapshot.teachers[0].name, snapshot.teachers[0].hourlyRateCents, snapshot.teachers[0].weeklyTravelCents],
      location: [snapshot.locations[0].name, snapshot.locations[0].rentCents],
      subscription: [snapshot.subscriptions[0].name, snapshot.subscriptions[0].priceCents],
      lesson: [snapshot.lessons[0].name, snapshot.lessons[0].durationMinutes],
      closure: [snapshot.closures[0].name, snapshot.closures[0].startDate, snapshot.closures[0].endDate],
    }, {
      defaultSalaryCents: 87500,
      teacher: ["Nieuwe beheerdocent", 7700, 3300],
      location: ["Nieuwe beheerlocatie", 9900],
      subscription: ["Nieuw beheerabonnement", 8800],
      lesson: ["Nieuwe beheerles", 90],
      closure: ["Nieuwe beheersluiting", "2026-10-01", "2026-10-31"],
    });
    assert.deepEqual(snapshot.lessonInputs, [{
      lessonId: snapshot.lessons[0].id,
      attendance: 24,
      lessonCountOverride: 4,
    }]);
    assert.deepEqual(
      [storedInput.lessonId, storedInput.attendance, storedInput.lessonCountOverride],
      [snapshot.lessons[0].id, 24, 4],
    );
  });

  financialTest("saved months retain subscription and closure snapshots across full admin season updates", async ({ request, owner, ownerSeasonId, ownerLessonId, ownerDetail, database }) => {
    const monthPath = `/financial/seasons/${ownerSeasonId}/months/2026-10-01`;
    const initialSave = await request(monthPath, owner, {
      method: "PUT",
      body: monthBody(ownerLessonId, 2400),
    });
    assert.equal(initialSave.status, 200);

    const [storedBeforeUpdate] = await database.select().from(financialMonthsTable).where(and(
      eq(financialMonthsTable.seasonId, ownerSeasonId),
      eq(financialMonthsTable.month, "2026-10-01"),
    ));
    const originalSnapshot = storedBeforeUpdate.masterDataSnapshot as any;
    const changedSubscription = {
      ...ownerDetail.subscriptions[0],
      name: "Nieuw abonnement na maandopslag",
      price: 88,
    };
    const changedClosure = {
      ...ownerDetail.closures[0],
      name: "Nieuwe sluiting na maandopslag",
      startDate: "2026-10-01",
      endDate: "2026-11-30",
    };
    const updatedSeason = await request(`/admin/financial/participants/${owner.id}/seasons/${ownerSeasonId}`, owner, {
      method: "PUT",
      admin: true,
      body: {
        ...ownerDetail,
        expectedUpdatedAt: ownerDetail.updatedAt,
        subscriptions: [changedSubscription, ...ownerDetail.subscriptions.slice(1)],
        closures: [changedClosure, ...ownerDetail.closures.slice(1)],
      },
    });
    assert.equal(updatedSeason.status, 200);
    assert.equal(updatedSeason.body.subscriptions[0].name, changedSubscription.name);
    assert.equal(updatedSeason.body.closures[0].name, changedClosure.name);

    const historical = await request(monthPath, owner);
    assert.equal(historical.status, 200);
    assert.deepEqual(historical.body.lessonProfitability, initialSave.body.lessonProfitability);
    assert.equal(historical.body.lessonProfitability[0].effectiveCount, 3);

    const resavedHistorical = await request(monthPath, owner, {
      method: "PUT",
      body: {
        ...monthBody(ownerLessonId, 2400),
        expectedUpdatedAt: initialSave.body.updatedAt,
      },
    });
    assert.equal(resavedHistorical.status, 200);
    assert.deepEqual(resavedHistorical.body.lessonProfitability, initialSave.body.lessonProfitability);

    const futurePath = `/financial/seasons/${ownerSeasonId}/months/2026-11-01`;
    const futureSave = await request(futurePath, owner, {
      method: "PUT",
      body: monthBody(ownerLessonId, 2400),
    });
    assert.equal(futureSave.status, 200);
    assert.equal(futureSave.body.lessonProfitability[0].effectiveCount, 0);

    const [historicalRecord, futureRecord] = await database.select().from(financialMonthsTable)
      .where(and(
        eq(financialMonthsTable.seasonId, ownerSeasonId),
        inArray(financialMonthsTable.month, ["2026-10-01", "2026-11-01"]),
      ))
      .orderBy(asc(financialMonthsTable.month));
    const historicalSnapshot = historicalRecord.masterDataSnapshot as any;
    const futureSnapshot = futureRecord.masterDataSnapshot as any;
    assert.deepEqual(
      [historicalSnapshot.subscriptions[0].name, historicalSnapshot.subscriptions[0].priceCents],
      [originalSnapshot.subscriptions[0].name, originalSnapshot.subscriptions[0].priceCents],
    );
    assert.deepEqual(
      [historicalSnapshot.closures[0].name, historicalSnapshot.closures[0].startDate, historicalSnapshot.closures[0].endDate],
      [originalSnapshot.closures[0].name, originalSnapshot.closures[0].startDate, originalSnapshot.closures[0].endDate],
    );
    assert.deepEqual(
      [futureSnapshot.subscriptions[0].name, futureSnapshot.subscriptions[0].priceCents],
      [changedSubscription.name, 8800],
    );
    assert.deepEqual(
      [futureSnapshot.closures[0].name, futureSnapshot.closures[0].startDate, futureSnapshot.closures[0].endDate],
      [changedClosure.name, changedClosure.startDate, changedClosure.endDate],
    );
  });

  financialTest("a concurrent season update and legacy backfill persist one complete master-data version", async (check) => {
    const { request, owner, ownerSeasonId, ownerDetail, database } = check;
    const changedSeason = {
      ...ownerDetail,
      name: "Gewijzigd tijdens legacy backfill",
      defaultSalary: 925,
      expectedUpdatedAt: ownerDetail.updatedAt,
      teachers: ownerDetail.teachers.map((teacher: any) => ({
        ...teacher,
        name: "Nieuwe backfill-docent",
        hourlyRate: 81,
        weeklyTravel: 37,
      })),
      locations: ownerDetail.locations.map((location: any) => ({
        ...location,
        name: "Nieuwe backfill-locatie",
        rent: 105,
      })),
      lessons: ownerDetail.lessons.map((lesson: any) => ({
        ...lesson,
        name: "Nieuwe backfill-les",
        durationMinutes: 95,
      })),
    };
    const [legacyMonth] = await database.insert(financialMonthsTable).values({
      seasonId: ownerSeasonId,
      month: "2026-09-01",
      contributionRevenueCents: 240000,
      taxArrearsCents: 2500,
      salaryOverrideCents: null,
      masterDataSnapshot: null,
    }).returning();
    await database.insert(financialLessonMonthInputsTable).values({
      financialMonthId: legacyMonth.id,
      lessonId: ownerDetail.lessons[0].id,
      attendance: 24,
      lessonCountOverride: 4,
    });

    let releaseSeasonSave!: () => void;
    const seasonSaveMayContinue = new Promise<void>(resolve => { releaseSeasonSave = resolve; });
    let seasonLockAcquired!: () => void;
    const seasonHasLock = new Promise<void>(resolve => { seasonLockAcquired = resolve; });
    check.beforeFinancialSeasonMasterSave = async () => {
      seasonLockAcquired();
      await seasonSaveMayContinue;
    };
    const seasonRequest = request(`/financial/seasons/${ownerSeasonId}`, owner, {
      method: "PUT",
      body: changedSeason,
    });
    await seasonHasLock;
    const backfillRequest = backfillLegacyFinancialMonthSnapshots(database);
    await new Promise(resolve => setTimeout(resolve, 25));
    releaseSeasonSave();

    const [seasonResponse, backfillReport] = await Promise.all([seasonRequest, backfillRequest]);
    assert.equal(seasonResponse.status, 200);
    assert.equal(backfillReport.migrated, 1);
    assert.deepEqual(backfillReport.nonMigratable, []);

    const [storedMonth] = await database.select().from(financialMonthsTable)
      .where(eq(financialMonthsTable.id, legacyMonth.id));
    const snapshot = storedMonth.masterDataSnapshot as any;
    assert.deepEqual({
      defaultSalaryCents: snapshot.defaultSalaryCents,
      teacher: [snapshot.teachers[0].name, snapshot.teachers[0].hourlyRateCents, snapshot.teachers[0].weeklyTravelCents],
      location: [snapshot.locations[0].name, snapshot.locations[0].rentCents],
      lesson: [snapshot.lessons[0].name, snapshot.lessons[0].durationMinutes],
    }, {
      defaultSalaryCents: 92500,
      teacher: ["Nieuwe backfill-docent", 8100, 3700],
      location: ["Nieuwe backfill-locatie", 10500],
      lesson: ["Nieuwe backfill-les", 95],
    });
    assert.deepEqual(snapshot.lessonInputs, [{
      lessonId: snapshot.lessons[0].id,
      attendance: 24,
      lessonCountOverride: 4,
    }]);
  });

  financialTest("a legacy backfill that wins the season lock preserves the complete old master-data version", async (check) => {
    const { request, owner, ownerSeasonId, ownerDetail, database } = check;
    const [legacyMonth] = await database.insert(financialMonthsTable).values({
      seasonId: ownerSeasonId,
      month: "2026-09-01",
      contributionRevenueCents: 240000,
      taxArrearsCents: 2500,
      salaryOverrideCents: null,
      masterDataSnapshot: null,
    }).returning();
    await database.insert(financialLessonMonthInputsTable).values({
      financialMonthId: legacyMonth.id,
      lessonId: ownerDetail.lessons[0].id,
      attendance: 24,
      lessonCountOverride: 4,
    });

    let releaseBackfill!: () => void;
    const backfillMayContinue = new Promise<void>(resolve => { releaseBackfill = resolve; });
    let backfillLockAcquired!: () => void;
    const backfillHasLock = new Promise<void>(resolve => { backfillLockAcquired = resolve; });
    const pausedBackfillDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver);
        return async (callback: (tx: any) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            const pausedTransaction = new Proxy(tx, {
              get(transactionTarget, transactionProperty, transactionReceiver) {
                if (transactionProperty !== "execute") {
                  return Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
                }
                return async (query: Parameters<typeof tx.execute>[0]) => {
                  const result = await transactionTarget.execute(query);
                  backfillLockAcquired();
                  await backfillMayContinue;
                  return result;
                };
              },
            });
            return callback(pausedTransaction);
          });
      },
    }) as typeof database;

    const changedSeason = {
      ...ownerDetail,
      name: "Nieuwe seizoenversie na backfill",
      startDate: "2026-08-01",
      endDate: "2026-12-31",
      country: "België",
      hasStarterDeduction: false,
      defaultSalary: 925,
      expectedUpdatedAt: ownerDetail.updatedAt,
      teachers: ownerDetail.teachers.map((teacher: any) => ({
        ...teacher,
        name: "Nieuwe geblokkeerde docent",
        hourlyRate: 81,
        weeklyTravel: 37,
      })),
      locations: ownerDetail.locations.map((location: any) => ({
        ...location,
        name: "Nieuwe geblokkeerde locatie",
        rent: 105,
      })),
      subscriptions: ownerDetail.subscriptions.map((subscription: any) => ({
        ...subscription,
        name: `Nieuw ${subscription.name}`,
        price: subscription.price + 10,
      })),
      lessons: ownerDetail.lessons.map((lesson: any) => ({
        ...lesson,
        name: "Nieuwe geblokkeerde les",
        durationMinutes: 95,
      })),
      closures: ownerDetail.closures.map((closure: any) => ({
        ...closure,
        name: "Nieuwe geblokkeerde sluiting",
      })),
    };

    const backfillRequest = backfillLegacyFinancialMonthSnapshots(pausedBackfillDatabase);
    await backfillHasLock;
    let seasonRequestFinished = false;
    const seasonRequest = request(`/financial/seasons/${ownerSeasonId}`, owner, {
      method: "PUT",
      body: changedSeason,
    }).then(response => {
      seasonRequestFinished = true;
      return response;
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(seasonRequestFinished, false, "the season update must wait while the backfill owns the lock");
    releaseBackfill();

    const [backfillReport, seasonResponse] = await Promise.all([backfillRequest, seasonRequest]);
    assert.equal(backfillReport.migrated, 1);
    assert.equal(seasonResponse.status, 200);

    const [storedMonth] = await database.select().from(financialMonthsTable)
      .where(eq(financialMonthsTable.id, legacyMonth.id));
    const snapshot = storedMonth.masterDataSnapshot as any;
    assert.deepEqual({
      seasonStartDate: snapshot.seasonStartDate,
      seasonEndDate: snapshot.seasonEndDate,
      country: snapshot.country,
      hasStarterDeduction: snapshot.hasStarterDeduction,
      defaultSalaryCents: snapshot.defaultSalaryCents,
      teacher: [snapshot.teachers[0].name, snapshot.teachers[0].hourlyRateCents, snapshot.teachers[0].weeklyTravelCents],
      location: [snapshot.locations[0].name, snapshot.locations[0].rentCents],
      subscriptions: snapshot.subscriptions.map((subscription: any) => [subscription.name, subscription.priceCents]),
      lesson: [snapshot.lessons[0].name, snapshot.lessons[0].durationMinutes],
      closure: snapshot.closures[0].name,
    }, {
      seasonStartDate: ownerDetail.startDate,
      seasonEndDate: ownerDetail.endDate,
      country: ownerDetail.country,
      hasStarterDeduction: ownerDetail.hasStarterDeduction,
      defaultSalaryCents: ownerDetail.defaultSalary * 100,
      teacher: [ownerDetail.teachers[0].name, ownerDetail.teachers[0].hourlyRate * 100, ownerDetail.teachers[0].weeklyTravel * 100],
      location: [ownerDetail.locations[0].name, ownerDetail.locations[0].rent * 100],
      subscriptions: ownerDetail.subscriptions.map((subscription: any) => [subscription.name, subscription.price * 100]),
      lesson: [ownerDetail.lessons[0].name, ownerDetail.lessons[0].durationMinutes],
      closure: ownerDetail.closures[0].name,
    });
    assert.deepEqual(snapshot.lessonInputs, [{
      lessonId: ownerDetail.lessons[0].id,
      attendance: 24,
      lessonCountOverride: 4,
    }]);
  });

  financialTest("a waiting month save revalidates boundaries from the season update that won the lock", async (check) => {
    const { request, owner, ownerSeasonId, ownerLessonId, ownerDetail, database } = check;
    const shortenedSeason = {
      ...ownerDetail,
      startDate: "2026-10-01",
      expectedUpdatedAt: ownerDetail.updatedAt,
    };
    let releaseSeasonSave!: () => void;
    const seasonSaveMayContinue = new Promise<void>(resolve => { releaseSeasonSave = resolve; });
    let seasonLockAcquired!: () => void;
    const seasonHasLock = new Promise<void>(resolve => { seasonLockAcquired = resolve; });
    check.beforeFinancialSeasonMasterSave = async () => {
      seasonLockAcquired();
      await seasonSaveMayContinue;
    };

    const seasonRequest = request(`/financial/seasons/${ownerSeasonId}`, owner, {
      method: "PUT",
      body: shortenedSeason,
    });
    await seasonHasLock;
    const monthRequest = request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner, {
      method: "PUT",
      body: monthBody(ownerLessonId, 2400, 24, 4),
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    releaseSeasonSave();

    const [seasonResponse, monthResponse] = await Promise.all([seasonRequest, monthRequest]);
    assert.equal(seasonResponse.status, 200);
    assert.equal(monthResponse.status, 400);
    assert.match(monthResponse.body.error, /buiten dit seizoen/i);
    const storedMonths = await database.select().from(financialMonthsTable).where(and(
      eq(financialMonthsTable.seasonId, ownerSeasonId),
      eq(financialMonthsTable.month, "2026-09-01"),
    ));
    assert.equal(storedMonths.length, 0);
  });

  financialTest("a writer cannot adopt a revision committed by another writer before its response", async (check) => {
    const { request, owner, ownerSeasonId, ownerLessonId } = check;
    const path = `/financial/seasons/${ownerSeasonId}/months/2026-09-01`;
    const initial = await request(path, owner, { method: "PUT", body: monthBody(ownerLessonId, 1000) });
    assert.equal(initial.status, 200);

    let interveningResponse: Awaited<ReturnType<typeof request>> | undefined;
    check.beforeFinancialMonthResponse = async (firstWriterRevision) => {
      check.beforeFinancialMonthResponse = undefined;
      interveningResponse = await request(path, owner, {
        method: "PUT",
        body: { ...monthBody(ownerLessonId, 1300), expectedUpdatedAt: firstWriterRevision },
      });
    };

    const firstResponse = await request(path, owner, {
      method: "PUT",
      body: { ...monthBody(ownerLessonId, 1100), expectedUpdatedAt: initial.body.updatedAt },
    });
    assert.equal(firstResponse.status, 200);
    assert.equal(interveningResponse?.status, 200);
    assert.notEqual(firstResponse.body.updatedAt, initial.body.updatedAt);
    assert.notEqual(firstResponse.body.updatedAt, interveningResponse?.body.updatedAt);
    const staleRetry = await request(path, owner, {
      method: "PUT",
      body: { ...monthBody(ownerLessonId, 1400), expectedUpdatedAt: firstResponse.body.updatedAt },
    });
    assert.equal(staleRetry.status, 409);
  });

  financialTest("a participant cannot read or change another school's season, master data, lesson, or month", async ({ request, owner, ownerSeasonId, outsiderSeasonId, outsiderLessonId, ownerDetail, outsiderDetail }) => {
    const list = await request("/financial/seasons", owner);
    const listedSeasonIds = list.body.map((season: { id: number }) => season.id);
    assert.ok(listedSeasonIds.includes(ownerSeasonId));
    assert.ok(!listedSeasonIds.includes(outsiderSeasonId));
    assert.equal((await request(`/financial/seasons/${outsiderSeasonId}`, owner)).status, 404);
    assert.equal((await request(`/financial/seasons/${outsiderSeasonId}`, owner, { method: "PUT", body: outsiderDetail })).status, 404);
    assert.equal((await request(`/financial/seasons/${outsiderSeasonId}/months/2026-09-01`, owner)).status, 404);
    assert.equal((await request(`/financial/seasons/${outsiderSeasonId}/months/2026-09-01`, owner, { method: "PUT", body: monthBody(outsiderLessonId, 1000) })).status, 404);
    assert.equal((await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner, { method: "PUT", body: monthBody(outsiderLessonId, 1000) })).status, 400);

    const foreignMaster = {
      ...ownerDetail,
      expectedUpdatedAt: ownerDetail.updatedAt,
      teachers: [{ ...ownerDetail.teachers[0], id: outsiderDetail.teachers[0].id }],
    };
    assert.equal((await request(`/financial/seasons/${ownerSeasonId}`, owner, { method: "PUT", body: foreignMaster })).status, 400);
  });

  financialTest("admin routes reject participants and expose only the explicitly requested school to admins", async ({ request, owner, outsider, ownerSeasonId, outsiderSeasonId }) => {
    assert.equal((await request(`/admin/financial/participants/${outsider.id}/seasons`, owner)).status, 403);
    const adminList = await request(`/admin/financial/participants/${outsider.id}/seasons`, owner, { admin: true });
    assert.equal(adminList.status, 200);
    assert.deepEqual(adminList.body.map((season: { id: number }) => season.id), [outsiderSeasonId]);
    assert.equal((await request(`/admin/financial/participants/${owner.id}/seasons/${outsiderSeasonId}`, owner, { admin: true })).status, 404);
    const adminDetail = await request(`/admin/financial/participants/${outsider.id}/seasons/${outsiderSeasonId}`, owner, { admin: true });
    assert.equal(adminDetail.body.locations[0].rentTermCount, 3);
  });

  financialTest("admin season detail reports damaged saved financial history without leaking internal values", async ({ request, owner, ownerSeasonId, ownerLessonId, database }) => {
    const validPath = `/admin/financial/participants/${owner.id}/seasons/${ownerSeasonId}`;
    const saved = await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner, {
      method: "PUT",
      body: monthBody(ownerLessonId, 1200),
    });
    assert.equal(saved.status, 200);
    assert.equal((await request(validPath, owner, { admin: true })).status, 200);

    const [storedMonth] = await database.select().from(financialMonthsTable).where(and(
      eq(financialMonthsTable.seasonId, ownerSeasonId),
      eq(financialMonthsTable.month, "2026-09-01"),
    ));
    const snapshot = storedMonth.masterDataSnapshot as Record<string, any>;
    await database.update(financialMonthsTable)
      .set({
        masterDataSnapshot: {
          ...snapshot,
          lessons: snapshot.lessons.map((lesson: Record<string, unknown>, index: number) => index === 0
            ? { ...lesson, name: { internalValue: "mag-nooit-in-de-api-fout-staan" } }
            : lesson),
        },
      })
      .where(eq(financialMonthsTable.id, storedMonth.id));

    const response = await request(validPath, owner, { admin: true });
    assert.equal(response.status, 422);
    assert.deepEqual(response.body, {
      code: INVALID_FINANCIAL_HISTORY_ERROR_CODE,
      error: "De opgeslagen financiële historie van dit seizoen is beschadigd. Herstel de opgeslagen maandgegevens voordat je verdergaat.",
    });
    assert.doesNotMatch(JSON.stringify(response.body), /savedMonths|lessonProfitability|internalValue|mag-nooit/);
  });

  financialTest("PUT and GET match, including cumulative results", async ({ request, owner, ownerSeasonId, ownerLessonId }) => {
    const septemberPut = await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner, { method: "PUT", body: monthBody(ownerLessonId, 2000, 20, 3) });
    assert.equal(septemberPut.status, 200);
    assert.equal(septemberPut.body.isSaved, true);
    assert.deepEqual(septemberPut.body.fixedCosts, [
      { group: "Marketing", description: "Advertenties", frequency: "monthly", amount: 60 },
      { group: "Marketing", description: "Drukwerk", frequency: "one_time", amount: 40 },
    ]);
    assert.deepEqual((await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body, septemberPut.body);

    const octoberDraft = await request(`/financial/seasons/${ownerSeasonId}/months/2026-10-01`, owner);
    assert.equal(octoberDraft.body.isSaved, false);
    assert.deepEqual(octoberDraft.body.lessonInputs, [{ lessonId: ownerLessonId, attendance: 20, attendanceSourceMonth: "2026-09-01", lessonCountOverride: null }]);
    assert.deepEqual(octoberDraft.body.fixedCosts, []);
    assert.equal(octoberDraft.body.previousMonth, "2026-09-01");
    assert.deepEqual(octoberDraft.body.previousMonthFixedCosts, [septemberPut.body.fixedCosts[0]]);

    const septemberBeforeOctober = (await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body;
    const blankOctober = await request(`/financial/seasons/${ownerSeasonId}/months/2026-10-01`, owner, { method: "PUT", body: monthBody(ownerLessonId, 3000, null) });
    assert.equal(blankOctober.body.isSaved, true);
    assert.deepEqual(blankOctober.body.lessonInputs, [{ lessonId: ownerLessonId, attendance: null, attendanceSourceMonth: null, lessonCountOverride: null }]);
    assert.deepEqual((await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body, septemberBeforeOctober);
    const novemberAfterBlankOctober = await request(`/financial/seasons/${ownerSeasonId}/months/2026-11-01`, owner);
    assert.deepEqual(novemberAfterBlankOctober.body.lessonInputs, [{ lessonId: ownerLessonId, attendance: 20, attendanceSourceMonth: "2026-09-01", lessonCountOverride: null }]);

    const octoberPut = await request(`/financial/seasons/${ownerSeasonId}/months/2026-10-01`, owner, {
      method: "PUT",
      body: { ...monthBody(ownerLessonId, 3000, 25), expectedUpdatedAt: blankOctober.body.updatedAt },
    });
    assert.equal(octoberPut.status, 200);
    const octoberGet = await request(`/financial/seasons/${ownerSeasonId}/months/2026-10-01`, owner);
    assert.deepEqual(octoberGet.body, octoberPut.body);
    assert.deepEqual((await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body, septemberBeforeOctober);
    const novemberDraft = await request(`/financial/seasons/${ownerSeasonId}/months/2026-11-01`, owner);
    assert.equal(novemberDraft.body.isSaved, false);
    assert.deepEqual(novemberDraft.body.lessonInputs, [{ lessonId: ownerLessonId, attendance: 25, attendanceSourceMonth: "2026-10-01", lessonCountOverride: null }]);
    assert.equal(octoberGet.body.cumulative.revenue, septemberPut.body.revenue + octoberPut.body.revenue);
    const seasonWithForecast = await request(`/financial/seasons/${ownerSeasonId}`, owner);
    const lessonForecast = seasonWithForecast.body.lessonSeasonForecast.lessons[0];
    assert.equal(lessonForecast.actualMonthCount, 2);
    assert.equal(lessonForecast.forecastMonthCount, 1);
    assert.equal(lessonForecast.months.find((item: { month: string }) => item.month === "2026-11-01").attendance, 25);
    assert.equal(lessonForecast.months.find((item: { month: string }) => item.month === "2026-11-01").lessonCount, 5);
    assert.equal(lessonForecast.months.reduce((sum: number, item: { revenue: number | null }) => sum + (item.revenue ?? 0), 0), 8000);
  });

  financialTest("unknown snapshot versions have a stable safe API error while legacy and current versions still load", async ({ request, owner, database }) => {
    const createSavedMonth = async (name: string) => {
      const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody(name) });
      assert.equal(created.status, 201);
      const seasonId = created.body.id as number;
      const detail = await request(`/financial/seasons/${seasonId}`, owner);
      const lessonId = detail.body.lessons[0].id as number;
      const path = `/financial/seasons/${seasonId}/months/2026-09-01`;
      const saved = await request(path, owner, { method: "PUT", body: monthBody(lessonId, 1200) });
      assert.equal(saved.status, 200);
      const [record] = await database.select().from(financialMonthsTable).where(and(
        eq(financialMonthsTable.seasonId, seasonId),
        eq(financialMonthsTable.month, "2026-09-01"),
      ));
      return { path, record };
    };

    const legacy = await createSavedMonth("Bekende legacy snapshot");
    const { formatVersion: _ignored, ...legacySnapshot } = legacy.record.masterDataSnapshot as Record<string, unknown>;
    await database.update(financialMonthsTable)
      .set({ masterDataSnapshot: legacySnapshot })
      .where(eq(financialMonthsTable.id, legacy.record.id));

    const current = await createSavedMonth("Bekende actuele snapshot");
    assert.equal(
      (current.record.masterDataSnapshot as { formatVersion: number }).formatVersion,
      CURRENT_FINANCIAL_SNAPSHOT_FORMAT_VERSION,
    );

    assert.equal((await request(legacy.path, owner)).status, 200);
    assert.equal((await request(current.path, owner)).status, 200);

    const unsupported = await createSavedMonth("Onbekende snapshot");
    await database.update(financialMonthsTable)
      .set({
        masterDataSnapshot: {
          ...(unsupported.record.masterDataSnapshot as Record<string, unknown>),
          formatVersion: 999,
          sensitiveSnapshotValue: "mag-nooit-in-de-api-fout-staan",
        },
      })
      .where(eq(financialMonthsTable.id, unsupported.record.id));

    const response = await request(unsupported.path, owner);
    assert.equal(response.status, 422);
    assert.deepEqual(response.body, {
      code: UNSUPPORTED_FINANCIAL_SNAPSHOT_FORMAT_ERROR_CODE,
      error: "Deze financiële maand gebruikt een niet-ondersteunde gegevensversie.",
    });
    assert.doesNotMatch(JSON.stringify(response.body), /999|sensitiveSnapshotValue|mag-nooit/);
  });

  financialTest("legacy months are inventoried, backfilled once, and stay frozen", async ({ request, owner, database }) => {
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Legacy backfill") });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const detail = await request(`/financial/seasons/${seasonId}`, owner);
    const lessonId = detail.body.lessons[0].id as number;
    const [legacyMonth] = await database.insert(financialMonthsTable).values({
      seasonId,
      month: "2026-09-01",
      contributionRevenueCents: 200000,
      taxArrearsCents: 2500,
      salaryOverrideCents: null,
      masterDataSnapshot: null,
    }).returning();
    await database.insert(financialLessonMonthInputsTable).values({
      financialMonthId: legacyMonth.id,
      lessonId,
      attendance: 20,
      lessonCountOverride: 3,
    });

    const firstReport = await backfillLegacyFinancialMonthSnapshots(database);
    assert.equal(firstReport.found, 1);
    assert.deepEqual(firstReport.legacyMonths, [{
      monthId: legacyMonth.id,
      seasonId,
      month: "2026-09-01",
    }]);
    assert.equal(firstReport.migrated, 1);
    assert.deepEqual(firstReport.nonMigratable, []);
    const [backfilled] = await database.select().from(financialMonthsTable).where(eq(financialMonthsTable.id, legacyMonth.id));
    assert.ok(backfilled.masterDataSnapshot);
    const frozenSnapshot = backfilled.masterDataSnapshot;
    const beforeMasterChanges = (await request(`/financial/seasons/${seasonId}/months/2026-09-01`, owner)).body;

    await database.update(financialTeachersTable).set({ hourlyRateCents: 999900 }).where(eq(financialTeachersTable.seasonId, seasonId));
    await database.update(financialLessonsTable).set({ durationMinutes: 240 }).where(eq(financialLessonsTable.id, lessonId));

    const afterMasterChanges = (await request(`/financial/seasons/${seasonId}/months/2026-09-01`, owner)).body;
    assert.deepEqual(afterMasterChanges, beforeMasterChanges);
    const secondReport = await backfillLegacyFinancialMonthSnapshots(database);
    assert.equal(secondReport.found, 0);
    assert.equal(secondReport.migrated, 0);
    const [afterRerun] = await database.select().from(financialMonthsTable).where(eq(financialMonthsTable.id, legacyMonth.id));
    assert.deepEqual(afterRerun.masterDataSnapshot, frozenSnapshot);
  });

  financialTest("a legacy month deleted after inventory stays non-migratable in the report", async ({ request, owner, database }) => {
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Verdwenen legacy maand") });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const [legacyMonth] = await database.insert(financialMonthsTable).values({
      seasonId,
      month: "2026-09-01",
      contributionRevenueCents: 200000,
      taxArrearsCents: 2500,
      salaryOverrideCents: null,
      masterDataSnapshot: null,
    }).returning();

    let deletedAfterInventory = false;
    const deletingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (...args: Parameters<typeof database.transaction>) => {
            if (!deletedAfterInventory) {
              deletedAfterInventory = true;
              await database.delete(financialMonthsTable).where(eq(financialMonthsTable.id, legacyMonth.id));
            }
            return database.transaction(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const report = await backfillLegacyFinancialMonthSnapshots(deletingDatabase);

    assert.equal(deletedAfterInventory, true);
    assert.equal(report.found, 1);
    assert.deepEqual(report.legacyMonths, [{
      monthId: legacyMonth.id,
      seasonId,
      month: "2026-09-01",
    }]);
    assert.equal(report.migrated, 0);
    assert.equal(report.skippedBecauseAlreadySnapshotted, 0);
    assert.deepEqual(report.nonMigratable, [{
      monthId: legacyMonth.id,
      reason: "MONTH_NOT_FOUND",
    }]);
    assert.equal(
      report.migrated + report.skippedBecauseAlreadySnapshotted + report.nonMigratable.length,
      report.found,
    );
  });

  financialTest("a season deleted after its legacy month is read stays non-migratable in the report", async ({ request, owner, database }) => {
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Verdwenen seizoen tijdens migratie") });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const [legacyMonth] = await database.insert(financialMonthsTable).values({
      seasonId,
      month: "2026-09-01",
      contributionRevenueCents: 200000,
      taxArrearsCents: 2500,
      salaryOverrideCents: null,
      masterDataSnapshot: null,
    }).returning();

    let deletedAfterMonthRead = false;
    const deletingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (
            callback: Parameters<typeof database.transaction>[0],
            ...rest: unknown[]
          ) => database.transaction(async (tx) => {
            let selectCount = 0;
            const deletingTransaction = new Proxy(tx, {
              get(transactionTarget, transactionProperty, transactionReceiver) {
                if (transactionProperty === "select") {
                  return (...args: Parameters<typeof tx.select>) => {
                    selectCount += 1;
                    const selectBuilder = tx.select(...args);
                    if (selectCount !== 1) return selectBuilder;
                    return new Proxy(selectBuilder, {
                      get(selectTarget, selectProperty, selectReceiver) {
                        if (selectProperty === "from") {
                          return (...fromArgs: Parameters<typeof selectBuilder.from>) => {
                            const fromBuilder = selectBuilder.from(...fromArgs);
                            return new Proxy(fromBuilder, {
                              get(fromTarget, fromProperty, fromReceiver) {
                                if (fromProperty === "where") {
                                  return (...whereArgs: Parameters<typeof fromBuilder.where>) => {
                                    const whereBuilder = fromBuilder.where(...whereArgs);
                                    return new Proxy(whereBuilder, {
                                      get(whereTarget, whereProperty, whereReceiver) {
                                        if (whereProperty === "limit") {
                                          return async (...limitArgs: Parameters<typeof whereBuilder.limit>) => {
                                            const result = await whereBuilder.limit(...limitArgs);
                                            deletedAfterMonthRead = true;
                                            await database.delete(financialSeasonsTable).where(eq(financialSeasonsTable.id, seasonId));
                                            return result;
                                          };
                                        }
                                        const value = Reflect.get(whereTarget, whereProperty, whereReceiver);
                                        return typeof value === "function" ? value.bind(whereTarget) : value;
                                      },
                                    });
                                  };
                                }
                                const value = Reflect.get(fromTarget, fromProperty, fromReceiver);
                                return typeof value === "function" ? value.bind(fromTarget) : value;
                              },
                            });
                          };
                        }
                        const value = Reflect.get(selectTarget, selectProperty, selectReceiver);
                        return typeof value === "function" ? value.bind(selectTarget) : value;
                      },
                    });
                  };
                }
                const value = Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
                return typeof value === "function" ? value.bind(transactionTarget) : value;
              },
            });
            return callback(deletingTransaction);
          }, ...rest as []);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const report = await backfillLegacyFinancialMonthSnapshots(deletingDatabase);

    assert.equal(deletedAfterMonthRead, true);
    assert.equal(report.found, 1);
    assert.deepEqual(report.legacyMonths, [{
      monthId: legacyMonth.id,
      seasonId,
      month: "2026-09-01",
    }]);
    assert.equal(report.migrated, 0);
    assert.equal(report.skippedBecauseAlreadySnapshotted, 0);
    assert.deepEqual(report.nonMigratable, [{
      monthId: legacyMonth.id,
      reason: "SEASON_NOT_FOUND",
    }]);
    assert.equal(
      report.migrated + report.skippedBecauseAlreadySnapshotted + report.nonMigratable.length,
      report.found,
    );
  });

  financialTest("a legacy month deleted just before its snapshot update stays non-migratable in the report", async ({ request, owner, database }) => {
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Verdwenen maand tijdens opslaan") });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const [legacyMonth] = await database.insert(financialMonthsTable).values({
      seasonId,
      month: "2026-09-01",
      contributionRevenueCents: 200000,
      taxArrearsCents: 2500,
      salaryOverrideCents: null,
      masterDataSnapshot: null,
    }).returning();

    let deletedBeforeSnapshotUpdate = false;
    const deletingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (
            callback: Parameters<typeof database.transaction>[0],
            ...rest: unknown[]
          ) => database.transaction(async (tx) => {
            const deletingTransaction = new Proxy(tx, {
              get(transactionTarget, transactionProperty, transactionReceiver) {
                if (transactionProperty === "update") {
                  return (...args: Parameters<typeof tx.update>) => {
                    const updateBuilder = tx.update(...args);
                    return new Proxy(updateBuilder, {
                      get(updateTarget, updateProperty, updateReceiver) {
                        if (updateProperty === "set") {
                          return (...setArgs: Parameters<typeof updateBuilder.set>) => {
                            const setBuilder = updateBuilder.set(...setArgs);
                            return new Proxy(setBuilder, {
                              get(setTarget, setProperty, setReceiver) {
                                if (setProperty === "where") {
                                  return (...whereArgs: Parameters<typeof setBuilder.where>) => {
                                    const whereBuilder = setBuilder.where(...whereArgs);
                                    return new Proxy(whereBuilder, {
                                      get(whereTarget, whereProperty, whereReceiver) {
                                        if (whereProperty === "returning") {
                                          return async (...returningArgs: Parameters<typeof whereBuilder.returning>) => {
                                            deletedBeforeSnapshotUpdate = true;
                                            await database.delete(financialMonthsTable).where(eq(financialMonthsTable.id, legacyMonth.id));
                                            return whereBuilder.returning(...returningArgs);
                                          };
                                        }
                                        const value = Reflect.get(whereTarget, whereProperty, whereReceiver);
                                        return typeof value === "function" ? value.bind(whereTarget) : value;
                                      },
                                    });
                                  };
                                }
                                const value = Reflect.get(setTarget, setProperty, setReceiver);
                                return typeof value === "function" ? value.bind(setTarget) : value;
                              },
                            });
                          };
                        }
                        const value = Reflect.get(updateTarget, updateProperty, updateReceiver);
                        return typeof value === "function" ? value.bind(updateTarget) : value;
                      },
                    });
                  };
                }
                const value = Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
                return typeof value === "function" ? value.bind(transactionTarget) : value;
              },
            });
            return callback(deletingTransaction);
          }, ...rest as []);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const report = await backfillLegacyFinancialMonthSnapshots(deletingDatabase);

    assert.equal(deletedBeforeSnapshotUpdate, true);
    assert.equal(report.found, 1);
    assert.equal(report.migrated, 0);
    assert.equal(report.skippedBecauseAlreadySnapshotted, 0);
    assert.deepEqual(report.nonMigratable, [{
      monthId: legacyMonth.id,
      reason: "MONTH_NOT_FOUND",
    }]);
    assert.equal(
      report.migrated + report.skippedBecauseAlreadySnapshotted + report.nonMigratable.length,
      report.found,
    );
  });

  financialTest("concurrent legacy backfills classify valid and non-migratable months exactly once per report", async ({ request, owner, database }) => {
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Gelijktijdige legacy backfill") });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const detail = await request(`/financial/seasons/${seasonId}`, owner);
    const lessonId = detail.body.lessons[0].id as number;
    const preservedSnapshot = {
      marker: "existing-history-must-not-change",
    };
    const legacyMonthValues = [
      { month: "2026-05-01", contributionRevenueCents: 200000 },
      { month: "2026-06-01", contributionRevenueCents: 210000 },
      { month: "2026-07-01", contributionRevenueCents: 220000 },
      { month: "2026-08-01", contributionRevenueCents: 230000 },
      { month: "2026-09-01", contributionRevenueCents: 240000 },
    ];
    const insertedMonths = await database.insert(financialMonthsTable).values([
      ...legacyMonthValues.map(({ month, contributionRevenueCents }) => ({
        seasonId,
        month,
        contributionRevenueCents,
        taxArrearsCents: 2500,
        salaryOverrideCents: null,
        masterDataSnapshot: null,
      })),
      {
        seasonId,
        month: "2026-10-01",
        contributionRevenueCents: 250000,
        taxArrearsCents: 2500,
        salaryOverrideCents: null,
        masterDataSnapshot: preservedSnapshot,
      },
    ]).returning();
    const legacyMonths = insertedMonths.slice(0, legacyMonthValues.length);
    const snapshottedMonth = insertedMonths.at(-1);
    assert.ok(snapshottedMonth);
    await database.insert(financialLessonMonthInputsTable).values(legacyMonths.map((legacyMonth, index) => ({
      financialMonthId: legacyMonth.id,
      lessonId,
      attendance: 20 + index,
      lessonCountOverride: 3 + index,
    })));

    const reports = await Promise.all([
      backfillLegacyFinancialMonthSnapshots(database),
      backfillLegacyFinancialMonthSnapshots(database),
      backfillLegacyFinancialMonthSnapshots(database),
    ]);

    for (const report of reports) {
      assert.deepEqual(report.nonMigratable, []);
      assert.equal(
        report.migrated + report.skippedBecauseAlreadySnapshotted + report.nonMigratable.length,
        report.found,
      );
      assert.equal(report.legacyMonths.length, report.found);
    }
    const inventoriedMonths = reports.reduce((total, report) => total + report.found, 0);
    const explainedMonths = reports.reduce(
      (total, report) => total
        + report.migrated
        + report.skippedBecauseAlreadySnapshotted
        + report.nonMigratable.length,
      0,
    );
    assert.equal(explainedMonths, inventoriedMonths);
    assert.equal(reports.reduce((total, report) => total + report.migrated, 0), legacyMonths.length);

    for (const [index, legacyMonth] of legacyMonths.entries()) {
      const [backfilled] = await database.select().from(financialMonthsTable).where(eq(financialMonthsTable.id, legacyMonth.id));
      assert.ok(backfilled.masterDataSnapshot);
      const backfilledSnapshot = backfilled.masterDataSnapshot as {
        lessonInputs: Array<{ lessonId: number; attendance: number | null; lessonCountOverride: number | null }>;
      };
      assert.deepEqual(backfilledSnapshot.lessonInputs, [{
        lessonId,
        attendance: 20 + index,
        lessonCountOverride: 3 + index,
      }]);
    }
    const [preserved] = await database.select().from(financialMonthsTable).where(eq(financialMonthsTable.id, snapshottedMonth.id));
    assert.deepEqual(preserved.masterDataSnapshot, preservedSnapshot);
  });

  financialTest("an interrupted legacy backfill resumes without rewriting completed months", async ({ request, owner, database }) => {
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody("Onderbroken legacy backfill") });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const detail = await request(`/financial/seasons/${seasonId}`, owner);
    const lessonId = detail.body.lessons[0].id as number;
    const legacyMonthValues = [
      { month: "2026-05-01", contributionRevenueCents: 200000 },
      { month: "2026-06-01", contributionRevenueCents: 210000 },
      { month: "2026-07-01", contributionRevenueCents: 220000 },
      { month: "2026-08-01", contributionRevenueCents: 230000 },
      { month: "2026-09-01", contributionRevenueCents: 240000 },
    ];
    const legacyMonths = await database.insert(financialMonthsTable).values(
      legacyMonthValues.map(({ month, contributionRevenueCents }) => ({
        seasonId,
        month,
        contributionRevenueCents,
        taxArrearsCents: 2500,
        salaryOverrideCents: null,
        masterDataSnapshot: null,
      })),
    ).returning();
    await database.insert(financialLessonMonthInputsTable).values(legacyMonths.map((legacyMonth, index) => ({
      financialMonthId: legacyMonth.id,
      lessonId,
      attendance: 20 + index,
      lessonCountOverride: 3 + index,
    })));

    let completedTransactions = 0;
    const interruptedDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (...args: Parameters<typeof database.transaction>) => {
            if (completedTransactions === 2) throw new Error("controlled backfill interruption");
            const result = await database.transaction(...args);
            completedTransactions += 1;
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await assert.rejects(
      backfillLegacyFinancialMonthSnapshots(interruptedDatabase),
      /controlled backfill interruption/,
    );
    assert.equal(completedTransactions, 2);

    const afterInterruption = await database.select().from(financialMonthsTable)
      .where(eq(financialMonthsTable.seasonId, seasonId));
    const completedBeforeResume = afterInterruption
      .filter(month => month.masterDataSnapshot != null)
      .sort((a, b) => a.id - b.id);
    assert.deepEqual(completedBeforeResume.map(month => month.id), legacyMonths.slice(0, 2).map(month => month.id));
    const frozenSnapshotBytes = new Map(
      completedBeforeResume.map(month => [month.id, JSON.stringify(month.masterDataSnapshot)]),
    );

    const resumeReport = await backfillLegacyFinancialMonthSnapshots(database);
    assert.equal(resumeReport.found, 3);
    assert.equal(resumeReport.migrated, 3);
    assert.equal(resumeReport.skippedBecauseAlreadySnapshotted, 0);
    assert.deepEqual(resumeReport.nonMigratable, []);
    assert.deepEqual(
      resumeReport.legacyMonths.map(month => month.month),
      legacyMonthValues.slice(2).map(month => month.month),
    );
    assert.equal(completedTransactions + resumeReport.migrated, legacyMonths.length);

    const afterResume = await database.select().from(financialMonthsTable)
      .where(eq(financialMonthsTable.seasonId, seasonId));
    assert.equal(afterResume.filter(month => month.masterDataSnapshot != null).length, legacyMonths.length);
    for (const completedMonth of completedBeforeResume) {
      const resumedMonth = afterResume.find(month => month.id === completedMonth.id);
      assert.ok(resumedMonth);
      assert.equal(JSON.stringify(resumedMonth.masterDataSnapshot), frozenSnapshotBytes.get(completedMonth.id));
    }
  });

  financialTest("attendance history stays attached to the same lesson across deactivation, addition, and reactivation", async ({ request, owner, ownerSeasonId, ownerLessonId, ownerDetail }) => {
    const initial = seasonBody("Leshistorie op lesnummer");
    initial.lessons.push({
      ...initial.lessons[0],
      name: "Bestaande tweede les",
      weekday: 3,
      startTime: "20:00",
    });
    const created = await request("/financial/seasons", owner, { method: "POST", body: initial });
    assert.equal(created.status, 201);

    const seasonId = created.body.id as number;
    const original = (await request(`/financial/seasons/${seasonId}`, owner)).body;
    const temporarilyInactiveLesson = original.lessons.find((lesson: any) => lesson.name === "Dansles");
    const continuingLesson = original.lessons.find((lesson: any) => lesson.name === "Bestaande tweede les");
    assert.ok(temporarilyInactiveLesson);
    assert.ok(continuingLesson);

    const septemberPut = await request(`/financial/seasons/${seasonId}/months/2026-09-01`, owner, {
      method: "PUT",
      body: {
        ...monthBody(temporarilyInactiveLesson.id, 2000, 11),
        lessonInputs: [
          { lessonId: temporarilyInactiveLesson.id, attendance: 11, lessonCountOverride: null },
          { lessonId: continuingLesson.id, attendance: 22, lessonCountOverride: null },
        ],
      },
    });
    assert.equal(septemberPut.status, 200);
    const septemberBeforeChanges = (await request(`/financial/seasons/${seasonId}/months/2026-09-01`, owner)).body;

    const deactivated = {
      ...original,
      expectedUpdatedAt: original.updatedAt,
      lessons: [
        { ...temporarilyInactiveLesson, activeUntil: "2026-09-30" },
        continuingLesson,
        {
          teacherId: original.teachers[0].id,
          locationId: original.locations[0].id,
          name: "Nieuw toegevoegde les",
          weekday: 5,
          startTime: "18:00",
          durationMinutes: 60,
          activeFrom: "2026-10-01",
          activeUntil: "2026-11-30",
        },
      ],
    };
    assert.equal((await request(`/financial/seasons/${seasonId}`, owner, { method: "PUT", body: deactivated })).status, 200);

    const afterAddition = (await request(`/financial/seasons/${seasonId}`, owner)).body;
    const newLesson = afterAddition.lessons.find((lesson: any) => lesson.name === "Nieuw toegevoegde les");
    assert.ok(newLesson);
    const octoberDraft = await request(`/financial/seasons/${seasonId}/months/2026-10-01`, owner);
    assert.deepEqual(octoberDraft.body.lessonInputs, [
      { lessonId: continuingLesson.id, attendance: 22, attendanceSourceMonth: "2026-09-01", lessonCountOverride: null },
      { lessonId: newLesson.id, attendance: null, attendanceSourceMonth: null, lessonCountOverride: null },
    ]);

    const reactivated = {
      ...afterAddition,
      expectedUpdatedAt: afterAddition.updatedAt,
      lessons: afterAddition.lessons.map((lesson: any) =>
        lesson.id === temporarilyInactiveLesson.id ? { ...lesson, activeUntil: "2026-11-30" } : lesson
      ),
    };
    assert.equal((await request(`/financial/seasons/${seasonId}`, owner, { method: "PUT", body: reactivated })).status, 200);

    const novemberDraft = await request(`/financial/seasons/${seasonId}/months/2026-11-01`, owner);
    assert.deepEqual(novemberDraft.body.lessonInputs, [
      { lessonId: temporarilyInactiveLesson.id, attendance: 11, attendanceSourceMonth: "2026-09-01", lessonCountOverride: null },
      { lessonId: continuingLesson.id, attendance: 22, attendanceSourceMonth: "2026-09-01", lessonCountOverride: null },
      { lessonId: newLesson.id, attendance: null, attendanceSourceMonth: null, lessonCountOverride: null },
    ]);
    assert.deepEqual(
      (await request(`/financial/seasons/${seasonId}/months/2026-09-01`, owner)).body,
      septemberBeforeChanges,
    );
  });

  financialTest("saved months remain unchanged after every current calculation input changes", async ({ request, owner, ownerSeasonId, ownerLessonId, ownerDetail }) => {
    assert.equal((await request(
      `/financial/seasons/${ownerSeasonId}/months/2026-09-01`,
      owner,
      { method: "PUT", body: monthBody(ownerLessonId, 2000, 20, 3) },
    )).status, 200);
    assert.equal((await request(
      `/financial/seasons/${ownerSeasonId}/months/2026-10-01`,
      owner,
      { method: "PUT", body: monthBody(ownerLessonId, 3000, 25) },
    )).status, 200);

    const beforeSeptember = (await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body;
    const beforeOctober = (await request(`/financial/seasons/${ownerSeasonId}/months/2026-10-01`, owner)).body;
    const current = (await request(`/financial/seasons/${ownerSeasonId}`, owner)).body;
    const changed = {
      ...current,
      expectedUpdatedAt: current.updatedAt,
      country: "België",
      hasStarterDeduction: false,
      defaultSalary: 1500,
      teachers: current.teachers.map((teacher: any) => ({ ...teacher, hourlyRate: 300, weeklyTravel: 100 })),
      locations: current.locations.map((location: any) => ({ ...location, rentFrequency: "hour", rent: 200, rentTermCount: null })),
      subscriptions: current.subscriptions.map((subscription: any) => ({ ...subscription, price: 5, vatRate: 6 })),
      lessons: current.lessons.map((lesson: any) => ({ ...lesson, weekday: 5, durationMinutes: 120 })),
      closures: current.closures.map((closure: any) => ({ ...closure, startDate: "2026-09-01", endDate: "2026-10-31" })),
    };
    assert.equal((await request(`/financial/seasons/${ownerSeasonId}`, owner, { method: "PUT", body: changed })).status, 200);
    assert.deepEqual((await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body, beforeSeptember);
    assert.deepEqual((await request(`/financial/seasons/${ownerSeasonId}/months/2026-10-01`, owner)).body, beforeOctober);
  });

  financialTest("a failed month replacement rolls back deletions and partial inserts", async ({ request, owner, ownerSeasonId, ownerLessonId, database }) => {
    const before = (await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body;
    const invalid = {
      ...monthBody(ownerLessonId, 9999),
      fixedCosts: [
        { group: "Overig", description: "Geldige regel", frequency: "one_time", amount: 1 },
        { group: "Overig", description: "Te groot voor opslag", frequency: "one_time", amount: 30_000_000 },
      ],
    };
    assert.equal((await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner, { method: "PUT", body: invalid })).status, 500);
    assert.deepEqual((await request(`/financial/seasons/${ownerSeasonId}/months/2026-09-01`, owner)).body, before);
  });

  financialTest("a failed season creation leaves no season or master data behind", async ({ request, owner, database }) => {
    const invalid = seasonBody("Rollback seizoen");
    invalid.closures.push({ name: "Dubbele sluiting", startDate: "2026-10-12", endDate: "2026-10-18" });
    assert.equal((await request("/financial/seasons", owner, { method: "POST", body: invalid })).status, 400);
    const list = await request("/financial/seasons", owner);
    assert.equal(list.body.some((season: { name: string }) => season.name === invalid.name), false);
    const rows = await database.select().from(financialSeasonsTable).where(eq(financialSeasonsTable.name, invalid.name));
    assert.equal(rows.length, 0);
  });

  financialTest("invalid combinations of product type and payment details are rejected", async ({ request, owner, database }) => {
    const invalid = seasonBody("Ongeldige rittenkaart");
    invalid.subscriptions = [{
      ...invalid.subscriptions[0],
      name: "Rittenkaart zonder ritten",
      productType: "punch_card",
      paymentFrequency: "monthly",
      rideCount: null,
    }];
    assert.equal((await request("/financial/seasons", owner, { method: "POST", body: invalid })).status, 400);
    const rows = await database.select().from(financialSeasonsTable).where(eq(financialSeasonsTable.name, invalid.name));
    assert.equal(rows.length, 0);
  });

  financialTest("monthly locations require a whole number of rent terms", async ({ request, owner }) => {
    const invalid: any = seasonBody("Maandhuur zonder termijnen");
    invalid.locations[0].rentTermCount = null;
    assert.equal((await request("/financial/seasons", owner, { method: "POST", body: invalid })).status, 400);
    invalid.locations[0].rentTermCount = 2.5;
    assert.equal((await request("/financial/seasons", owner, { method: "POST", body: invalid })).status, 400);
  });

  financialTest("older payloads without rent terms keep working with twelve terms", async ({ request, owner }) => {
    const compatible: any = seasonBody("Oud locatieformulier");
    delete compatible.locations[0].rentTermCount;
    const created = await request("/financial/seasons", owner, { method: "POST", body: compatible });
    assert.equal(created.status, 201);
    const createdDetail = await request(`/financial/seasons/${created.body.id}`, owner);
    assert.equal(createdDetail.body.locations[0].rentTermCount, 12);
  });
  },
);