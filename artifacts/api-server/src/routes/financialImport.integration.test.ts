import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import {
  financialLessonsTable,
  financialMonthsTable,
  financialSubscriptionsTable,
  financialTeachersTable,
  participantsTable,
  pool,
  type Participant,
} from "@workspace/db";
import { createFinancialRouter } from "./financial.ts";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";
import { buildScheduleImportTemplate } from "../services/financialImport.ts";

const teacherHeaders = ["Naam docent", "Uurtarief (€)", "Reiskosten per week (€)"];
const subscriptionHeaders = ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden", "Btw-tarief"];
const punchCardHeaders = ["Naam", "Doelgroep", "Kaartprijs (€)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"];

async function xlsxFile(sheets: Record<string, unknown[][] | undefined>) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (!rows) continue;
    const sheet = workbook.addWorksheet(name);
    rows.forEach(row => sheet.addRow(row));
  }
  return new File([await workbook.xlsx.writeBuffer()], "import.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const seasonBody = {
  name: `Import test ${Date.now()}`,
  startDate: "2026-09-01",
  endDate: "2027-06-30",
  country: "Nederland",
  hasStarterDeduction: false,
  defaultSalary: 0,
  teachers: [
    { clientId: "retained", name: "Nina", hourlyRate: 30, weeklyTravel: 5 },
    { clientId: "removed", name: "Oude docent", hourlyRate: 25, weeklyTravel: 2 },
  ],
  locations: [
    { clientId: "studio", name: "Studio", rentFrequency: "session", rent: 10, rentTermCount: null, sessionMinutes: 60 },
  ],
  subscriptions: [
    {
      name: "Oud abonnement",
      audience: "adult",
      productType: "subscription",
      paymentFrequency: "monthly",
      price: 50,
      installmentCount: null,
      durationMonths: null,
      rideCount: null,
      validityMonths: null,
      vatRate: 21,
    },
    {
      name: "Oude rittenkaart",
      audience: "youth",
      productType: "punch_card",
      paymentFrequency: "one_time",
      price: 90,
      installmentCount: null,
      durationMonths: null,
      rideCount: 10,
      validityMonths: 6,
      vatRate: 9,
    },
  ],
  lessons: [
    { teacherClientId: "retained", locationClientId: "studio", name: "Les Nina", weekday: 1, startTime: "18:00", durationMinutes: 60, activeFrom: "2026-09-01", activeUntil: "2027-06-30" },
    { teacherClientId: "removed", locationClientId: "studio", name: "Les oude docent", weekday: 2, startTime: "18:00", durationMinutes: 60, activeFrom: "2026-09-01", activeUntil: "2027-06-30" },
  ],
  closures: [],
};

type FinancialImportTestContext = {
  isolated: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  owner: Participant;
  outsider: Participant;
  seasonId: number;
  retainedTeacher: any;
  removedTeacher: any;
  request: (path: string, participant: Participant, options?: { method?: string; body?: unknown; admin?: boolean; form?: FormData; raw?: boolean }) => Promise<{ status: number; body: any }>;
  setAfterFinancialTeacherImportMutation: (hook: (() => Promise<void>) | undefined) => void;
  setAfterFinancialTeacherImportDelete: (hook: (() => Promise<void>) | undefined) => void;
  setAfterFinancialSubscriptionImportDelete: (hook: (() => Promise<void>) | undefined) => void;
  setBeforeFinancialScheduleInsert: (hook: (() => Promise<void>) | undefined) => void;
};

async function withFinancialImportTest(run: (context: FinancialImportTestContext) => Promise<void>) {
  const isolated = await createIsolatedTestDatabase("financial_import_test");
  const marker = `${Date.now()}-${process.pid}`;
  const [owner, outsider] = await isolated.db.insert(participantsTable).values([
    { schoolName: `Import owner ${marker}`, contactName: "Owner", email: `import-owner-${marker}@example.test` },
    { schoolName: `Import outsider ${marker}`, contactName: "Outsider", email: `import-outsider-${marker}@example.test` },
  ]).returning();
  let server: Server | undefined;
  let afterFinancialTeacherImportMutation: (() => Promise<void>) | undefined;
  let afterFinancialTeacherImportDelete: (() => Promise<void>) | undefined;
  let afterFinancialSubscriptionImportDelete: (() => Promise<void>) | undefined;
  let beforeFinancialScheduleInsert: (() => Promise<void>) | undefined;
  try {
    const app = express();
    app.use(express.json());
    app.use(createFinancialRouter({
      database: isolated.db,
      participantForRequest: async req => Number(req.headers["x-participant-id"]) === outsider.id ? outsider : owner,
      signedInMiddleware: (_req, _res, next) => next(),
      adminMiddleware: (req, res, next) => req.headers["x-admin"] === "true" ? next() : res.status(403).json({ error: "admin required" }),
      afterFinancialTeacherImportMutation: () => afterFinancialTeacherImportMutation?.() ?? Promise.resolve(),
      afterFinancialTeacherImportDelete: () => afterFinancialTeacherImportDelete?.() ?? Promise.resolve(),
      afterFinancialSubscriptionImportDelete: () => afterFinancialSubscriptionImportDelete?.() ?? Promise.resolve(),
      beforeFinancialScheduleInsert: () => beforeFinancialScheduleInsert?.() ?? Promise.resolve(),
    }));
    app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: "request failed" }));
    server = app.listen(0, "127.0.0.1");
    const activeServer = server;
    await new Promise<void>(resolve => activeServer.once("listening", resolve));
    const address = activeServer.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    async function request(path: string, participant: Participant, options: { method?: string; body?: unknown; admin?: boolean; form?: FormData; raw?: boolean } = {}) {
      const headers: Record<string, string> = { "x-participant-id": String(participant.id) };
      if (options.admin) headers["x-admin"] = "true";
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: options.form ? headers : { ...headers, "content-type": "application/json" },
        body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      });
      return { status: response.status, body: options.raw ? await response.arrayBuffer() : await response.json() as any };
    }
    const created = await request("/financial/seasons", owner, { method: "POST", body: seasonBody });
    assert.equal(created.status, 201);
    const seasonId = created.body.id as number;
    const detail = await request(`/financial/seasons/${seasonId}`, owner);
    const retainedTeacher = detail.body.teachers.find((row: any) => row.name === "Nina");
    const removedTeacher = detail.body.teachers.find((row: any) => row.name === "Oude docent");
    const lessonIds = detail.body.lessons.map((row: any) => row.id);
    const savedMonth = await request(`/financial/seasons/${seasonId}/months/2026-09-01`, owner, {
      method: "PUT",
      body: {
        expectedUpdatedAt: null,
        contributionRevenue: 0,
        taxArrears: 0,
        salaryOverride: null,
        fixedCosts: [],
        activities: [],
        lessonInputs: lessonIds.map((lessonId: number) => ({ lessonId, attendance: 1, lessonCountOverride: null })),
      },
    });
    assert.equal(savedMonth.status, 200);
    await run({
      isolated,
      owner,
      outsider,
      seasonId,
      retainedTeacher,
      removedTeacher,
      request,
      setAfterFinancialTeacherImportMutation: hook => { afterFinancialTeacherImportMutation = hook; },
      setAfterFinancialTeacherImportDelete: hook => { afterFinancialTeacherImportDelete = hook; },
      setAfterFinancialSubscriptionImportDelete: hook => { afterFinancialSubscriptionImportDelete = hook; },
      setBeforeFinancialScheduleInsert: hook => { beforeFinancialScheduleInsert = hook; },
    });
  } finally {
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    await isolated.dispose();
  }
}

test("teacher imports enforce admin ownership, preview without mutation, revision checks, and snapshot/link safety", async () => {
  await withFinancialImportTest(async ({
    isolated,
    owner,
    outsider,
    seasonId,
    retainedTeacher,
    removedTeacher,
    request,
    setAfterFinancialTeacherImportMutation,
    setAfterFinancialTeacherImportDelete,
  }) => {
    const teacherFile = await xlsxFile({
      Docenten: [teacherHeaders, ["Nina", 42, 8]],
    });
    const previewPath = `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/preview`;
    const unauthorized = new FormData();
    unauthorized.set("file", teacherFile);
    assert.equal((await request(previewPath, owner, { method: "POST", form: unauthorized })).status, 403);
    const wrongOwner = new FormData();
    wrongOwner.set("file", teacherFile);
    assert.equal((await request(`/admin/financial/participants/${outsider.id}/seasons/${seasonId}/imports/teachers/preview`, owner, { method: "POST", admin: true, form: wrongOwner })).status, 404);
    const beforePreview = await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId));
    const previewForm = new FormData();
    previewForm.set("file", teacherFile);
    const preview = await request(previewPath, owner, { method: "POST", admin: true, form: previewForm });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.existingCount, 2);
    assert.equal(preview.body.newCount, 1);
    assert.equal((await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId))).length, beforePreview.length);

    const stale = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: "2020-01-01T00:00:00.000Z", rows: preview.body.rows },
    });
    assert.equal(stale.status, 409);
    const teachersBeforeFailedTeacherImport = await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId));
    const subscriptionsBeforeFailedTeacherImport = await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId));
    const lessonsBeforeFailedTeacherImport = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    const monthsBeforeFailedTeacherImport = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    setAfterFinancialTeacherImportMutation(async () => {
      throw new Error("forced teacher import failure");
    });
    const failedTeacherImport = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: preview.body.expectedUpdatedAt, rows: preview.body.rows },
    });
    setAfterFinancialTeacherImportMutation(undefined);
    assert.equal(failedTeacherImport.status, 500);
    assert.deepEqual(failedTeacherImport.body, { error: "request failed" });
    assert.deepEqual(await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId)), teachersBeforeFailedTeacherImport);
    assert.deepEqual(await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId)), subscriptionsBeforeFailedTeacherImport);
    assert.deepEqual(await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId)), lessonsBeforeFailedTeacherImport);
    assert.deepEqual(await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId)), monthsBeforeFailedTeacherImport);
    const emptyTeacherForm = new FormData();
    emptyTeacherForm.set("file", await xlsxFile({ Docenten: [teacherHeaders] }));
    const emptyTeacherPreview = await request(previewPath, owner, { method: "POST", admin: true, form: emptyTeacherForm });
    assert.equal(emptyTeacherPreview.status, 200);
    assert.equal(emptyTeacherPreview.body.existingCount, 2);
    assert.equal(emptyTeacherPreview.body.newCount, 0);
    assert.deepEqual(emptyTeacherPreview.body.rows, []);
    const currentSeason = (await request(`/financial/seasons/${seasonId}`, owner)).body;
    const currentTeacherClientId = "current-teacher";
    const currentTeacherName = "Actuele docent";
    const currentLessonName = "Actuele les";
    const currentSeasonUpdate = await request(`/financial/seasons/${seasonId}`, owner, {
      method: "PUT",
      body: {
        ...currentSeason,
        expectedUpdatedAt: currentSeason.updatedAt,
        teachers: [
          ...currentSeason.teachers,
          { clientId: currentTeacherClientId, name: currentTeacherName, hourlyRate: 35, weeklyTravel: 4 },
        ],
        lessons: [
          ...currentSeason.lessons,
          {
            teacherClientId: currentTeacherClientId,
            locationId: currentSeason.locations[0].id,
            name: currentLessonName,
            weekday: 3,
            startTime: "19:00",
            durationMinutes: 60,
            activeFrom: "2026-09-01",
            activeUntil: "2027-06-30",
          },
        ],
      },
    });
    assert.equal(currentSeasonUpdate.status, 200);
    const currentTeacher = currentSeasonUpdate.body.teachers.find((row: any) => row.name === currentTeacherName);
    assert.ok(currentTeacher);
    assert.equal(currentSeasonUpdate.body.lessons.find((row: any) => row.name === currentLessonName)?.teacherId, currentTeacher.id);
    const staleEmptyTeacherImport = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: emptyTeacherPreview.body.expectedUpdatedAt, rows: emptyTeacherPreview.body.rows },
    });
    assert.equal(staleEmptyTeacherImport.status, 409);
    const seasonAfterStaleEmptyTeacherImport = (await request(`/financial/seasons/${seasonId}`, owner)).body;
    assert.equal(seasonAfterStaleEmptyTeacherImport.teachers.find((row: any) => row.name === currentTeacherName)?.id, currentTeacher.id);
    assert.equal(
      seasonAfterStaleEmptyTeacherImport.lessons.find((row: any) => row.name === currentLessonName)?.teacherId,
      currentTeacher.id,
    );
    const freshEmptyTeacherForm = new FormData();
    freshEmptyTeacherForm.set("file", await xlsxFile({ Docenten: [teacherHeaders] }));
    const freshEmptyTeacherPreview = await request(previewPath, owner, { method: "POST", admin: true, form: freshEmptyTeacherForm });
    assert.equal(freshEmptyTeacherPreview.status, 200);
    const teachersBeforeFailedEmptyTeacherImport = await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId));
    const lessonsBeforeFailedEmptyTeacherImport = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    const monthsBeforeFailedEmptyTeacherImport = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    setAfterFinancialTeacherImportDelete(async () => {
      throw new Error("forced empty teacher import failure");
    });
    const failedEmptyTeacherImport = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: freshEmptyTeacherPreview.body.expectedUpdatedAt, rows: freshEmptyTeacherPreview.body.rows },
    });
    setAfterFinancialTeacherImportDelete(undefined);
    assert.equal(failedEmptyTeacherImport.status, 500);
    assert.deepEqual(failedEmptyTeacherImport.body, { error: "request failed" });
    assert.deepEqual(await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId)), teachersBeforeFailedEmptyTeacherImport);
    assert.deepEqual(await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId)), lessonsBeforeFailedEmptyTeacherImport);
    assert.deepEqual(await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId)), monthsBeforeFailedEmptyTeacherImport);
    const confirmedEmptyTeacherImport = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: freshEmptyTeacherPreview.body.expectedUpdatedAt, rows: freshEmptyTeacherPreview.body.rows },
    });
    assert.equal(confirmedEmptyTeacherImport.status, 200);
    assert.equal(confirmedEmptyTeacherImport.body.importedCount, 0);
    assert.deepEqual(await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId)), []);
    const lessonsAfterEmptyTeacherImport = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    assert.deepEqual(lessonsAfterEmptyTeacherImport.map(row => ({ name: row.name, teacherId: row.teacherId })), [
      { name: "Les Nina", teacherId: null },
      { name: "Les oude docent", teacherId: null },
      { name: currentLessonName, teacherId: null },
    ]);
    const [monthAfterEmptyTeacherImport] = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    assert.deepEqual((monthAfterEmptyTeacherImport.masterDataSnapshot as any).teachers.map((row: any) => row.name), ["Nina", "Oude docent"]);
    assert.deepEqual((monthAfterEmptyTeacherImport.masterDataSnapshot as any).lessons.map((row: any) => ({ name: row.name, teacherId: row.teacherId })), [
      { name: "Les Nina", teacherId: retainedTeacher.id },
      { name: "Les oude docent", teacherId: removedTeacher.id },
    ]);
    const restoreTeacherForm = new FormData();
    restoreTeacherForm.set("file", await xlsxFile({ Docenten: [teacherHeaders, ["Nina", 42, 8]] }));
    const restoreTeacherPreview = await request(previewPath, owner, { method: "POST", admin: true, form: restoreTeacherForm });
    assert.equal(restoreTeacherPreview.status, 200);
    const confirmed = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: restoreTeacherPreview.body.expectedUpdatedAt, rows: restoreTeacherPreview.body.rows },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.importedCount, 1);
    const teachersAfter = await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId));
    assert.deepEqual(teachersAfter.map(row => row.name), ["Nina"]);
    const lessonsAfter = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    assert.equal(lessonsAfter.find(row => row.name === "Les Nina")?.teacherId, null);
    assert.equal(lessonsAfter.find(row => row.name === "Les oude docent")?.teacherId, null);
    const [monthAfter] = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    assert.equal((monthAfter.masterDataSnapshot as any).teachers.find((row: any) => row.id === removedTeacher.id)?.name, "Oude docent");
  });
});

test("schedule imports ignore extra worksheets, enforce revision checks, rollback failures, and preserve saved snapshots", async () => {
  await withFinancialImportTest(async ({
    isolated,
    owner,
    seasonId,
    request,
    setBeforeFinancialScheduleInsert,
  }) => {
    const refreshedForSchedule = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}`, owner, { admin: true });
    const location = refreshedForSchedule.body.locations[0];
    const scheduleTemplate = await buildScheduleImportTemplate({
      participantId: owner.id,
      seasonId,
      seasonName: refreshedForSchedule.body.name,
      templateVersion: "1",
      masterDataVersion: refreshedForSchedule.body.updatedAt,
      startDate: refreshedForSchedule.body.startDate,
      endDate: refreshedForSchedule.body.endDate,
      teachers: refreshedForSchedule.body.teachers,
      locations: refreshedForSchedule.body.locations,
    });
    const templateResponse = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/schedule/template`, owner, { admin: true, raw: true });
    assert.equal(templateResponse.status, 200);
    assert.ok((templateResponse.body as ArrayBuffer).byteLength > 100);
    const scheduleWorkbook = new ExcelJS.Workbook();
    await scheduleWorkbook.xlsx.load(scheduleTemplate as unknown as Parameters<typeof scheduleWorkbook.xlsx.load>[0]);
    const scheduleSheet = scheduleWorkbook.getWorksheet("Rooster")!;
    ["Nieuwe les", "Geen (Zelf)", `Studio (locatie ${location.id})`, "Woensdag", "19:30", 75, "2026-09-01", "2027-06-30"]
      .forEach((value, index) => { scheduleSheet.getRow(2).getCell(index + 1).value = value; });
    scheduleWorkbook.addWorksheet("Eigen instructies").addRows([
      ["Geen geldige les", "Onbekende docent", "Onbekende locatie", "Geen dag", "geen tijd", -1, "geen datum", "geen datum"],
    ]);
    const scheduleFile = new File([await scheduleWorkbook.xlsx.writeBuffer()], "rooster.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const schedulePreviewForm = new FormData();
    schedulePreviewForm.set("file", scheduleFile);
    const schedulePreview = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/schedule/preview`, owner, { method: "POST", admin: true, form: schedulePreviewForm });
    assert.equal(schedulePreview.status, 200);
    assert.deepEqual(schedulePreview.body.errors, []);
    assert.equal(schedulePreview.body.newCount, 1);
    assert.equal(schedulePreview.body.rows[0].locationId, location.id);
    const staleSchedule = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/schedule/confirm`, owner, {
      method: "POST",
      admin: true,
      body: {
        expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
        participantId: owner.id,
        seasonId,
        templateVersion: schedulePreview.body.metadata.templateVersion,
        masterDataVersion: "2020-01-01T00:00:00.000Z",
        rows: schedulePreview.body.rows,
      },
    });
    assert.equal(staleSchedule.status, 409);
    const lessonsBeforeFailedSchedule = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    const [monthBeforeFailedSchedule] = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    setBeforeFinancialScheduleInsert(async () => {
      throw new Error("forced schedule insert failure");
    });
    const failedSchedule = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/schedule/confirm`, owner, {
      method: "POST",
      admin: true,
      body: {
        expectedUpdatedAt: schedulePreview.body.expectedUpdatedAt,
        participantId: owner.id,
        seasonId,
        templateVersion: schedulePreview.body.metadata.templateVersion,
        masterDataVersion: schedulePreview.body.metadata.masterDataVersion,
        rows: schedulePreview.body.rows,
      },
    });
    setBeforeFinancialScheduleInsert(undefined);
    assert.equal(failedSchedule.status, 500);
    assert.deepEqual(failedSchedule.body, { error: "request failed" });
    const lessonsAfterFailedSchedule = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    const [monthAfterFailedSchedule] = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    assert.deepEqual(lessonsAfterFailedSchedule, lessonsBeforeFailedSchedule);
    assert.deepEqual(monthAfterFailedSchedule, monthBeforeFailedSchedule);
    const scheduleConfirmed = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/schedule/confirm`, owner, {
      method: "POST",
      admin: true,
      body: {
        expectedUpdatedAt: schedulePreview.body.expectedUpdatedAt,
        participantId: owner.id,
        seasonId,
        templateVersion: schedulePreview.body.metadata.templateVersion,
        masterDataVersion: schedulePreview.body.metadata.masterDataVersion,
        rows: schedulePreview.body.rows,
      },
    });
    assert.equal(scheduleConfirmed.status, 200);
    assert.equal(scheduleConfirmed.body.importedCount, 1);
    const lessonsAfterSchedule = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    assert.deepEqual(lessonsAfterSchedule.map(row => ({ name: row.name, teacherId: row.teacherId, locationId: row.locationId, startTime: row.startTime })), [{
      name: "Nieuwe les",
      teacherId: null,
      locationId: location.id,
      startTime: "19:30",
    }]);
    const [monthAfterSchedule] = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    assert.deepEqual((monthAfterSchedule.masterDataSnapshot as any).lessons.map((row: any) => row.name), ["Les Nina", "Les oude docent"]);
  });
});

test("teacher and offer imports ignore extra worksheets through preview and confirmation", async () => {
  await withFinancialImportTest(async ({ isolated, owner, seasonId, request }) => {
    const teacherForm = new FormData();
    teacherForm.set("file", await xlsxFile({
      Docenten: [teacherHeaders, ["Nina", 42, 8]],
      Instructies: [
        ["Dit tabblad wordt niet geïmporteerd"],
        ["Geen docent", "geen uurtarief", "geen reiskosten"],
      ],
    }));
    const teacherPreview = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/preview`,
      owner,
      { method: "POST", admin: true, form: teacherForm },
    );
    assert.equal(teacherPreview.status, 200);
    assert.deepEqual(teacherPreview.body.rows, [{ name: "Nina", hourlyRate: 42, weeklyTravel: 8 }]);
    const teacherConfirmed = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/confirm`,
      owner,
      {
        method: "POST",
        admin: true,
        body: { expectedUpdatedAt: teacherPreview.body.expectedUpdatedAt, rows: teacherPreview.body.rows },
      },
    );
    assert.equal(teacherConfirmed.status, 200);
    assert.equal(teacherConfirmed.body.importedCount, 1);
    assert.deepEqual(
      (await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId))).map(row => row.name),
      ["Nina"],
    );

    const offersForm = new FormData();
    offersForm.set("file", await xlsxFile({
      Abonnementen: [subscriptionHeaders, ["Nieuw abonnement", "Volwassen", "Per maand", 70, 12, "9% btw"]],
      Rittenkaarten: [punchCardHeaders],
      "Eigen tabblad": [
        ["Dit tabblad wordt niet geïmporteerd"],
        ["Geen aanbieding", "Onbekende doelgroep", "Onbekende betaalwijze", -1, "geen getal", "Onbekend btw-tarief"],
      ],
    }));
    const offersPreview = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`,
      owner,
      { method: "POST", admin: true, form: offersForm },
    );
    assert.equal(offersPreview.status, 200);
    assert.deepEqual(offersPreview.body.rows, [{
      name: "Nieuw abonnement",
      audience: "adult",
      productType: "subscription",
      paymentFrequency: "monthly",
      price: 70,
      installmentCount: null,
      durationMonths: 12,
      rideCount: null,
      validityMonths: null,
      vatRate: 9,
    }]);
    const offersConfirmed = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/confirm`,
      owner,
      {
        method: "POST",
        admin: true,
        body: { expectedUpdatedAt: offersPreview.body.expectedUpdatedAt, rows: offersPreview.body.rows },
      },
    );
    assert.equal(offersConfirmed.status, 200);
    assert.equal(offersConfirmed.body.importedCount, 1);
    assert.deepEqual(
      (await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId))).map(row => row.name),
      ["Nieuw abonnement"],
    );
  });
});

test("invalid offer imports return validation errors without changing existing subscriptions", async () => {
  await withFinancialImportTest(async ({ isolated, owner, seasonId, request }) => {
    const subscriptionsBeforeInvalidImport = await isolated.db
      .select()
      .from(financialSubscriptionsTable)
      .where(eq(financialSubscriptionsTable.seasonId, seasonId));

    for (const invalidImport of [
      {
        sheet: "Abonnementen",
        row: ["", "Onbekende doelgroep", "Onbekende betaalwijze", -1, "geen getal", "Onbekend btw-tarief"],
        errorColumn: "Naam",
      },
      {
        sheet: "Rittenkaarten",
        row: ["Ongeldige kaart", "Jeugd", "geen prijs", 0, -1, "Onbekend btw-tarief"],
        errorColumn: "Kaartprijs (€ incl. btw)",
      },
    ]) {
      const form = new FormData();
      form.set("file", await xlsxFile({
        Abonnementen: invalidImport.sheet === "Abonnementen"
          ? [subscriptionHeaders, invalidImport.row]
          : [subscriptionHeaders],
        Rittenkaarten: invalidImport.sheet === "Rittenkaarten"
          ? [punchCardHeaders, invalidImport.row]
          : [punchCardHeaders],
      }));

      const preview = await request(
        `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`,
        owner,
        { method: "POST", admin: true, form },
      );

      assert.equal(preview.status, 422);
      assert.equal(preview.body.valid, false);
      assert.deepEqual(preview.body.rows, []);
      assert.ok(preview.body.errors.some((error: string) => error.includes(invalidImport.errorColumn)));
      assert.deepEqual(
        await isolated.db
          .select()
          .from(financialSubscriptionsTable)
          .where(eq(financialSubscriptionsTable.seasonId, seasonId)),
        subscriptionsBeforeInvalidImport,
      );
    }
  });
});

test("invalid import headers return empty previews without changing financial data", async () => {
  await withFinancialImportTest(async ({ isolated, owner, seasonId, request }) => {
    const teachersBefore = await isolated.db
      .select()
      .from(financialTeachersTable)
      .where(eq(financialTeachersTable.seasonId, seasonId));
    const subscriptionsBefore = await isolated.db
      .select()
      .from(financialSubscriptionsTable)
      .where(eq(financialSubscriptionsTable.seasonId, seasonId));
    const lessonsBefore = await isolated.db
      .select()
      .from(financialLessonsTable)
      .where(eq(financialLessonsTable.seasonId, seasonId));
    const monthsBefore = await isolated.db
      .select()
      .from(financialMonthsTable)
      .where(eq(financialMonthsTable.seasonId, seasonId));

    const teacherForm = new FormData();
    teacherForm.set("file", await xlsxFile({
      Docenten: [
        ["Naam docent", "Gewijzigde kolom", "Reiskosten per week (€)"],
        ["Nieuwe docent", 42, 8],
      ],
    }));
    const teacherPreview = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/preview`,
      owner,
      { method: "POST", admin: true, form: teacherForm },
    );
    assert.equal(teacherPreview.status, 422);
    assert.equal(teacherPreview.body.valid, false);
    assert.deepEqual(teacherPreview.body.rows, []);
    assert.equal(teacherPreview.body.newCount, 0);
    assert.ok(teacherPreview.body.errors.some((error: string) => error.includes("Docenten")));
    assert.ok(teacherPreview.body.errors.some((error: string) => error.includes("Uurtarief (€ incl. btw indien van toepassing)")));

    const offersForm = new FormData();
    offersForm.set("file", await xlsxFile({
      Abonnementen: [
        ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden"],
        ["Nieuw abonnement", "Volwassen", "Per maand", 70, 12, "9% btw"],
      ],
      Rittenkaarten: [
        ["Naam", "Doelgroep", "Kaartprijs (€)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"],
      ],
    }));
    const offersPreview = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`,
      owner,
      { method: "POST", admin: true, form: offersForm },
    );
    assert.equal(offersPreview.status, 422);
    assert.equal(offersPreview.body.valid, false);
    assert.deepEqual(offersPreview.body.rows, []);
    assert.equal(offersPreview.body.newCount, 0);
    assert.ok(offersPreview.body.errors.some((error: string) => error.includes("Abonnementen")));
    assert.ok(offersPreview.body.errors.some((error: string) => error.includes("Btw-tarief")));

    assert.deepEqual(
      await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId)),
      teachersBefore,
    );
    assert.deepEqual(
      await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId)),
      subscriptionsBefore,
    );
    assert.deepEqual(
      await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId)),
      lessonsBefore,
    );
    assert.deepEqual(
      await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId)),
      monthsBefore,
    );
  });
});

test("offer imports validate workbook sheets, rollback failures, and preserve saved snapshots", async () => {
  await withFinancialImportTest(async ({
    isolated,
    owner,
    seasonId,
    request,
    setAfterFinancialSubscriptionImportDelete,
  }) => {
    const offersForm = new FormData();
    offersForm.set("file", await xlsxFile({
      Abonnementen: [
        subscriptionHeaders,
        ["Nieuw abonnement", "Volwassen", "Per maand", 70, 12, "9% btw"],
        ["Termijnabonnement", "Jeugd", "In termijnen", 360, 12, "9% btw"],
      ],
      Rittenkaarten: [punchCardHeaders, ["Tienrittenkaart", "Jeugd", 100, 10, null, "21% btw"]],
    }));
    const offersPreview = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`, owner, { method: "POST", admin: true, form: offersForm });
    assert.equal(offersPreview.status, 200);
    const teachersBeforeFailedOfferImport = await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId));
    const subscriptionsBeforeFailedOfferImport = await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId));
    const lessonsBeforeFailedOfferImport = await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId));
    const monthsBeforeFailedOfferImport = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    setAfterFinancialSubscriptionImportDelete(async () => {
      throw new Error("forced subscription import failure");
    });
    const failedOfferImport = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: offersPreview.body.expectedUpdatedAt, rows: offersPreview.body.rows },
    });
    setAfterFinancialSubscriptionImportDelete(undefined);
    assert.equal(failedOfferImport.status, 500);
    assert.deepEqual(failedOfferImport.body, { error: "request failed" });
    assert.deepEqual(await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId)), teachersBeforeFailedOfferImport);
    assert.deepEqual(await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId)), subscriptionsBeforeFailedOfferImport);
    assert.deepEqual(await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId)), lessonsBeforeFailedOfferImport);
    assert.deepEqual(await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId)), monthsBeforeFailedOfferImport);
    const offersConfirmed = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: offersPreview.body.expectedUpdatedAt, rows: offersPreview.body.rows },
    });
    assert.equal(offersConfirmed.status, 200);
    const importedOffers = await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId));
    assert.deepEqual(importedOffers.map(row => row.name).sort(), ["Nieuw abonnement", "Termijnabonnement", "Tienrittenkaart"]);
    assert.equal(importedOffers.find(row => row.name === "Termijnabonnement")?.installmentCount, 12);
    const [monthAfterOffers] = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    assert.equal((monthAfterOffers.masterDataSnapshot as any).subscriptions[0].name, "Oud abonnement");

    for (const incompleteSheets of [
      { Abonnementen: [subscriptionHeaders] },
      { Rittenkaarten: [punchCardHeaders] },
    ]) {
      const subscriptionsBeforeIncompleteOfferImport = await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId));
      const incompleteOffersForm = new FormData();
      incompleteOffersForm.set("file", await xlsxFile(incompleteSheets));
      const incompleteOffersPreview = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`, owner, {
        method: "POST",
        admin: true,
        form: incompleteOffersForm,
      });
      assert.equal(incompleteOffersPreview.status, 422);
      assert.ok(incompleteOffersPreview.body.errors.some((error: string) => error.includes("Het verplichte tabblad ontbreekt.")));
      assert.deepEqual(
        await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId)),
        subscriptionsBeforeIncompleteOfferImport,
      );
    }

    const emptyOffersForm = new FormData();
    emptyOffersForm.set("file", await xlsxFile({
      Abonnementen: [subscriptionHeaders],
      Rittenkaarten: [punchCardHeaders],
    }));
    const emptyOffersPreview = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`, owner, {
      method: "POST",
      admin: true,
      form: emptyOffersForm,
    });
    assert.equal(emptyOffersPreview.status, 200);
    assert.deepEqual(emptyOffersPreview.body.rows, []);
    const newerOffersForm = new FormData();
    newerOffersForm.set("file", await xlsxFile({
      Abonnementen: [subscriptionHeaders, ["Recent abonnement", "Volwassen", "Per maand", 80, 12, "21% btw"]],
      Rittenkaarten: [punchCardHeaders],
    }));
    const newerOffersPreview = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`, owner, {
      method: "POST",
      admin: true,
      form: newerOffersForm,
    });
    assert.equal(newerOffersPreview.status, 200);
    const newerOffersConfirmed = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: newerOffersPreview.body.expectedUpdatedAt, rows: newerOffersPreview.body.rows },
    });
    assert.equal(newerOffersConfirmed.status, 200);
    assert.deepEqual(
      (await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId))).map(row => row.name),
      ["Recent abonnement"],
    );
    const staleEmptyOffersConfirmed = await request(`/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/confirm`, owner, {
      method: "POST",
      admin: true,
      body: { expectedUpdatedAt: emptyOffersPreview.body.expectedUpdatedAt, rows: emptyOffersPreview.body.rows },
    });
    assert.equal(staleEmptyOffersConfirmed.status, 409);
    assert.deepEqual(
      (await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId))).map(row => row.name),
      ["Recent abonnement"],
    );
    const [monthAfterStaleEmptyOffers] = await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId));
    assert.deepEqual(
      (monthAfterStaleEmptyOffers.masterDataSnapshot as any).subscriptions.map((row: any) => row.name).sort(),
      ["Oud abonnement", "Oude rittenkaart"],
    );
  });
});

test("completely empty workbooks are rejected for teachers and offers without database changes", async () => {
  await withFinancialImportTest(async ({ isolated, owner, seasonId, request }) => {
    const teachersBefore = await isolated.db
      .select()
      .from(financialTeachersTable)
      .where(eq(financialTeachersTable.seasonId, seasonId));
    const subscriptionsBefore = await isolated.db
      .select()
      .from(financialSubscriptionsTable)
      .where(eq(financialSubscriptionsTable.seasonId, seasonId));
    const lessonsBefore = await isolated.db
      .select()
      .from(financialLessonsTable)
      .where(eq(financialLessonsTable.seasonId, seasonId));
    const monthsBefore = await isolated.db
      .select()
      .from(financialMonthsTable)
      .where(eq(financialMonthsTable.seasonId, seasonId));

    const emptyTeacherForm = new FormData();
    emptyTeacherForm.set("file", await xlsxFile({}));
    const teacherPreview = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/teachers/preview`,
      owner,
      { method: "POST", admin: true, form: emptyTeacherForm },
    );
    assert.equal(teacherPreview.status, 422);
    assert.equal(teacherPreview.body.valid, false);
    assert.deepEqual(teacherPreview.body.rows, []);
    assert.deepEqual(teacherPreview.body.errors, [
      "Docenten: Het verplichte tabblad ontbreekt.",
    ]);

    const emptyOffersForm = new FormData();
    emptyOffersForm.set("file", await xlsxFile({}));
    const offersPreview = await request(
      `/admin/financial/participants/${owner.id}/seasons/${seasonId}/imports/subscriptions/preview`,
      owner,
      { method: "POST", admin: true, form: emptyOffersForm },
    );
    assert.equal(offersPreview.status, 422);
    assert.equal(offersPreview.body.valid, false);
    assert.deepEqual(offersPreview.body.rows, []);
    assert.deepEqual(offersPreview.body.errors, [
      "Abonnementen: Het verplichte tabblad ontbreekt.",
      "Rittenkaarten: Het verplichte tabblad ontbreekt.",
    ]);

    assert.deepEqual(
      await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, seasonId)),
      teachersBefore,
    );
    assert.deepEqual(
      await isolated.db.select().from(financialSubscriptionsTable).where(eq(financialSubscriptionsTable.seasonId, seasonId)),
      subscriptionsBefore,
    );
    assert.deepEqual(
      await isolated.db.select().from(financialLessonsTable).where(eq(financialLessonsTable.seasonId, seasonId)),
      lessonsBefore,
    );
    assert.deepEqual(
      await isolated.db.select().from(financialMonthsTable).where(eq(financialMonthsTable.seasonId, seasonId)),
      monthsBefore,
    );
  });
});

after(async () => {
  await pool.end();
});