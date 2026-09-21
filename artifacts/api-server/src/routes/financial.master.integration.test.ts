import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  financialLessonsTable,
  financialLocationsTable,
  financialSeasonsTable,
  financialTeachersTable,
  participantsTable,
  type Participant,
} from "@workspace/db";
import { createFinancialRouter } from "./financial.ts";

const rollback = Symbol("rollback");

const teacher = (clientId: string, name: string) => ({
  clientId,
  name,
  hourlyRate: 30,
  weeklyTravel: 10,
});

const location = (clientId: string, name: string) => ({
  clientId,
  name,
  rentFrequency: "session",
  rent: 20,
  rentTermCount: null,
  sessionMinutes: 60,
});

const lesson = (name: string, teacherClientId: string, locationClientId: string) => ({
  name,
  teacherClientId,
  locationClientId,
  weekday: 1,
  startTime: "19:00",
  durationMinutes: 60,
  activeFrom: "2026-09-01",
  activeUntil: "2027-06-30",
});

const seasonBody = (marker: string) => ({
  name: `Transactietest ${marker}`,
  startDate: "2026-09-01",
  endDate: "2027-06-30",
  country: "Nederland",
  hasStarterDeduction: true,
  defaultSalary: 500,
  teachers: [
    teacher("teacher-retained", `Docent behouden ${marker}`),
    teacher("teacher-removed", `Docent verwijderen ${marker}`),
  ],
  locations: [
    location("location-retained", `Locatie behouden ${marker}`),
    location("location-removed", `Locatie verwijderen ${marker}`),
  ],
  subscriptions: [{
    name: `Abonnement behouden ${marker}`,
    audience: "adult",
    productType: "subscription",
    paymentFrequency: "monthly",
    price: 75,
    installmentCount: null,
    durationMonths: null,
    rideCount: null,
    validityMonths: null,
    vatRate: 21,
  }],
  lessons: [
    lesson(`Les behouden ${marker}`, "teacher-retained", "location-retained"),
    lesson(`Les verwijderen ${marker}`, "teacher-removed", "location-removed"),
  ],
  closures: [{
    name: `Sluiting behouden ${marker}`,
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  }],
});

async function startApp(database: typeof db, participant: Participant) {
  const app = express();
  app.use(express.json());
  app.use(createFinancialRouter({
    database,
    participantForRequest: async () => participant,
    signedInMiddleware: (_req, _res, next) => next(),
    adminMiddleware: (_req, _res, next) => next(),
  }));
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Test request failed." });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

async function jsonRequest(baseUrl: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

test("a season with only base details and empty master data can be created, updated, and retrieved", async () => {
  try {
    await db.transaction(async (tx) => {
      const marker = `${Date.now()}-${process.pid}`;
      const [participant] = await tx.insert(participantsTable).values({
        schoolName: `Leeg seizoen ${marker}`,
        contactName: "Test",
        email: `empty-financial-season-${marker}@example.test`,
      }).returning();
      const app = await startApp(tx as unknown as typeof db, participant);

      try {
        const input = {
          name: `Basis-seizoen ${marker}`,
          startDate: "2026-09-01",
          endDate: "2027-06-30",
          country: "Nederland",
          hasStarterDeduction: false,
          defaultSalary: 0,
          teachers: [],
          locations: [],
          subscriptions: [],
          lessons: [],
          closures: [],
        };

        const created = await jsonRequest(app.baseUrl, "/financial/seasons", "POST", input);
        assert.equal(created.status, 201);
        assert.ok(created.body.id > 0);

        const [stored] = await tx.select().from(financialSeasonsTable).where(and(
          eq(financialSeasonsTable.id, created.body.id),
          eq(financialSeasonsTable.participantId, participant.id),
        ));
        assert.equal(stored.name, input.name);
        assert.equal(stored.defaultSalaryCents, 0);

        const retrieved = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`);
        assert.equal(retrieved.status, 200);
        assert.equal(retrieved.body.name, input.name);
        assert.equal(retrieved.body.defaultSalary, 0);
        assert.deepEqual(retrieved.body.teachers, []);
        assert.deepEqual(retrieved.body.locations, []);
        assert.deepEqual(retrieved.body.subscriptions, []);
        assert.deepEqual(retrieved.body.lessons, []);
        assert.deepEqual(retrieved.body.closures, []);

        const update = {
          name: `Bijgewerkt basis-seizoen ${marker}`,
          startDate: "2026-10-01",
          endDate: "2027-07-31",
          country: "België",
          hasStarterDeduction: true,
          defaultSalary: 125,
          expectedUpdatedAt: retrieved.body.updatedAt,
          teachers: [],
          locations: [],
          subscriptions: [],
          lessons: [],
          closures: [],
        };
        const updated = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`, "PUT", update);
        assert.equal(updated.status, 200);
        assert.equal(updated.body.name, update.name);
        assert.equal(updated.body.startDate, update.startDate);
        assert.equal(updated.body.endDate, update.endDate);
        assert.equal(updated.body.country, update.country);
        assert.equal(updated.body.hasStarterDeduction, update.hasStarterDeduction);
        assert.equal(updated.body.defaultSalary, update.defaultSalary);
        assert.notEqual(updated.body.updatedAt, retrieved.body.updatedAt);
        assert.deepEqual(updated.body.teachers, []);
        assert.deepEqual(updated.body.locations, []);
        assert.deepEqual(updated.body.subscriptions, []);
        assert.deepEqual(updated.body.lessons, []);
        assert.deepEqual(updated.body.closures, []);

        const retrievedAfterUpdate = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`);
        assert.equal(retrievedAfterUpdate.status, 200);
        assert.equal(retrievedAfterUpdate.body.name, update.name);
        assert.equal(retrievedAfterUpdate.body.startDate, update.startDate);
        assert.equal(retrievedAfterUpdate.body.endDate, update.endDate);
        assert.equal(retrievedAfterUpdate.body.country, update.country);
        assert.equal(retrievedAfterUpdate.body.hasStarterDeduction, update.hasStarterDeduction);
        assert.equal(retrievedAfterUpdate.body.defaultSalary, update.defaultSalary);
        assert.equal(retrievedAfterUpdate.body.updatedAt, updated.body.updatedAt);
        assert.deepEqual(retrievedAfterUpdate.body.teachers, []);
        assert.deepEqual(retrievedAfterUpdate.body.locations, []);
        assert.deepEqual(retrievedAfterUpdate.body.subscriptions, []);
        assert.deepEqual(retrievedAfterUpdate.body.lessons, []);
        assert.deepEqual(retrievedAfterUpdate.body.closures, []);
      } finally {
        await app.close();
      }

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test("a stale update cannot overwrite an empty season after a successful update", async () => {
  try {
    await db.transaction(async (tx) => {
      const marker = `${Date.now()}-${process.pid}`;
      const [participant] = await tx.insert(participantsTable).values({
        schoolName: `Verouderd leeg seizoen ${marker}`,
        contactName: "Test",
        email: `stale-empty-financial-season-${marker}@example.test`,
      }).returning();
      const app = await startApp(tx as unknown as typeof db, participant);

      try {
        const initial = {
          name: `Basis-seizoen ${marker}`,
          startDate: "2026-09-01",
          endDate: "2027-06-30",
          country: "Nederland",
          hasStarterDeduction: false,
          defaultSalary: 0,
          teachers: [],
          locations: [],
          subscriptions: [],
          lessons: [],
          closures: [],
        };
        const created = await jsonRequest(app.baseUrl, "/financial/seasons", "POST", initial);
        assert.equal(created.status, 201);

        const loaded = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`);
        assert.equal(loaded.status, 200);
        const firstUpdate = {
          ...initial,
          name: `Eerste wijziging ${marker}`,
          startDate: "2026-10-01",
          endDate: "2027-07-31",
          country: "België",
          hasStarterDeduction: true,
          defaultSalary: 125,
          expectedUpdatedAt: loaded.body.updatedAt,
        };
        const updated = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`, "PUT", firstUpdate);
        assert.equal(updated.status, 200);

        const staleUpdate = {
          ...firstUpdate,
          name: `Verouderde wijziging ${marker}`,
          defaultSalary: 999,
          expectedUpdatedAt: loaded.body.updatedAt,
        };
        const rejected = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`, "PUT", staleUpdate);
        assert.equal(rejected.status, 409);

        const afterRejectedUpdate = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`);
        assert.equal(afterRejectedUpdate.status, 200);
        assert.equal(afterRejectedUpdate.body.name, firstUpdate.name);
        assert.equal(afterRejectedUpdate.body.startDate, firstUpdate.startDate);
        assert.equal(afterRejectedUpdate.body.endDate, firstUpdate.endDate);
        assert.equal(afterRejectedUpdate.body.country, firstUpdate.country);
        assert.equal(afterRejectedUpdate.body.hasStarterDeduction, firstUpdate.hasStarterDeduction);
        assert.equal(afterRejectedUpdate.body.defaultSalary, firstUpdate.defaultSalary);
        assert.equal(afterRejectedUpdate.body.updatedAt, updated.body.updatedAt);
        assert.deepEqual(afterRejectedUpdate.body.teachers, []);
        assert.deepEqual(afterRejectedUpdate.body.locations, []);
        assert.deepEqual(afterRejectedUpdate.body.subscriptions, []);
        assert.deepEqual(afterRejectedUpdate.body.lessons, []);
        assert.deepEqual(afterRejectedUpdate.body.closures, []);
      } finally {
        await app.close();
      }

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test("a stale update cannot overwrite a non-empty season after a successful update", async () => {
  try {
    await db.transaction(async (tx) => {
      const marker = `${Date.now()}-${process.pid}`;
      const [participant] = await tx.insert(participantsTable).values({
        schoolName: `Verouderd gevuld seizoen ${marker}`,
        contactName: "Test",
        email: `stale-populated-financial-season-${marker}@example.test`,
      }).returning();
      const app = await startApp(tx as unknown as typeof db, participant);

      try {
        const initial = seasonBody(marker);
        const created = await jsonRequest(app.baseUrl, "/financial/seasons", "POST", initial);
        assert.equal(created.status, 201);

        const loaded = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`);
        assert.equal(loaded.status, 200);
        const firstTeacherName = `Docent eerst gewijzigd ${marker}`;
        const firstLocationName = `Locatie eerst gewijzigd ${marker}`;
        const firstSubscriptionName = `Abonnement eerst gewijzigd ${marker}`;
        const firstLessonName = `Les eerst gewijzigd ${marker}`;
        const firstClosureName = `Sluiting eerst gewijzigd ${marker}`;
        const firstUpdate = {
          ...loaded.body,
          name: `Eerste wijziging gevuld ${marker}`,
          defaultSalary: 725,
          expectedUpdatedAt: loaded.body.updatedAt,
          teachers: loaded.body.teachers.map((teacher: any) => teacher.name === initial.teachers[0].name
            ? { ...teacher, name: firstTeacherName }
            : teacher),
          locations: loaded.body.locations.map((location: any) => location.name === initial.locations[0].name
            ? { ...location, name: firstLocationName }
            : location),
          subscriptions: loaded.body.subscriptions.map((subscription: any) => ({
            ...subscription,
            name: firstSubscriptionName,
            price: 85,
          })),
          lessons: loaded.body.lessons.map((lesson: any) => lesson.name === initial.lessons[0].name
            ? { ...lesson, name: firstLessonName }
            : lesson),
          closures: loaded.body.closures.map((closure: any) => ({
            ...closure,
            name: firstClosureName,
          })),
        };
        const updated = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`, "PUT", firstUpdate);
        assert.equal(updated.status, 200);
        assert.equal(updated.body.name, firstUpdate.name);
        assert.equal(updated.body.defaultSalary, firstUpdate.defaultSalary);
        assert.equal(updated.body.teachers.find((teacher: any) => teacher.name === firstTeacherName).name, firstTeacherName);
        assert.equal(updated.body.locations.find((location: any) => location.name === firstLocationName).name, firstLocationName);
        assert.equal(updated.body.subscriptions.find((subscription: any) => subscription.name === firstSubscriptionName).name, firstSubscriptionName);
        assert.equal(updated.body.lessons.find((lesson: any) => lesson.name === firstLessonName).name, firstLessonName);
        assert.equal(updated.body.closures.find((closure: any) => closure.name === firstClosureName).name, firstClosureName);

        const staleUpdate = {
          ...loaded.body,
          name: `Verouderde wijziging gevuld ${marker}`,
          defaultSalary: 999,
          expectedUpdatedAt: loaded.body.updatedAt,
          teachers: loaded.body.teachers.map((teacher: any) => ({
            ...teacher,
            name: `Docent verouderde wijziging ${marker}`,
          })),
          locations: loaded.body.locations.map((location: any) => ({
            ...location,
            name: `Locatie verouderde wijziging ${marker}`,
          })),
          subscriptions: loaded.body.subscriptions.map((subscription: any) => ({
            ...subscription,
            name: `Abonnement verouderde wijziging ${marker}`,
            price: 999,
          })),
          lessons: loaded.body.lessons.map((lesson: any) => ({
            ...lesson,
            name: `Les verouderde wijziging ${marker}`,
          })),
          closures: loaded.body.closures.map((closure: any) => ({
            ...closure,
            name: `Sluiting verouderde wijziging ${marker}`,
          })),
        };
        const rejected = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`, "PUT", staleUpdate);
        assert.equal(rejected.status, 409);

        const afterRejectedUpdate = await jsonRequest(app.baseUrl, `/financial/seasons/${created.body.id}`);
        assert.equal(afterRejectedUpdate.status, 200);
        assert.equal(afterRejectedUpdate.body.name, updated.body.name);
        assert.equal(afterRejectedUpdate.body.defaultSalary, updated.body.defaultSalary);
        assert.equal(afterRejectedUpdate.body.updatedAt, updated.body.updatedAt);
        assert.deepEqual(afterRejectedUpdate.body.teachers, updated.body.teachers);
        assert.deepEqual(afterRejectedUpdate.body.locations, updated.body.locations);
        assert.deepEqual(afterRejectedUpdate.body.subscriptions, updated.body.subscriptions);
        assert.deepEqual(afterRejectedUpdate.body.lessons, updated.body.lessons);
        assert.deepEqual(afterRejectedUpdate.body.closures, updated.body.closures);
      } finally {
        await app.close();
      }

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test("an admin can create and retrieve a season with only base details and empty master data", async () => {
  try {
    await db.transaction(async (tx) => {
      const marker = `${Date.now()}-${process.pid}`;
      const [participant] = await tx.insert(participantsTable).values({
        schoolName: `Leeg beheerseizoen ${marker}`,
        contactName: "Test",
        email: `empty-admin-financial-season-${marker}@example.test`,
      }).returning();
      const app = await startApp(tx as unknown as typeof db, participant);

      try {
        const input = {
          name: `Basis-beheerseizoen ${marker}`,
          startDate: "2026-09-01",
          endDate: "2027-06-30",
          country: "Nederland",
          hasStarterDeduction: false,
          defaultSalary: 0,
          teachers: [],
          locations: [],
          subscriptions: [],
          lessons: [],
          closures: [],
        };
        const adminSeasonsPath = `/admin/financial/participants/${participant.id}/seasons`;

        const created = await jsonRequest(app.baseUrl, adminSeasonsPath, "POST", input);
        assert.equal(created.status, 201);
        assert.ok(created.body.id > 0);
        assert.equal(created.body.defaultSalary, 0);

        const [stored] = await tx.select().from(financialSeasonsTable).where(and(
          eq(financialSeasonsTable.id, created.body.id),
          eq(financialSeasonsTable.participantId, participant.id),
        ));
        assert.equal(stored.name, input.name);
        assert.equal(stored.defaultSalaryCents, 0);

        const retrieved = await jsonRequest(app.baseUrl, `${adminSeasonsPath}/${created.body.id}`);
        assert.equal(retrieved.status, 200);
        assert.equal(retrieved.body.name, input.name);
        assert.equal(retrieved.body.defaultSalary, 0);
        assert.deepEqual(retrieved.body.teachers, []);
        assert.deepEqual(retrieved.body.locations, []);
        assert.deepEqual(retrieved.body.subscriptions, []);
        assert.deepEqual(retrieved.body.lessons, []);
        assert.deepEqual(retrieved.body.closures, []);
      } finally {
        await app.close();
      }

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test("an admin stale update cannot overwrite a non-empty season after a successful update", async () => {
  try {
    await db.transaction(async (tx) => {
      const marker = `${Date.now()}-${process.pid}`;
      const [participant] = await tx.insert(participantsTable).values({
        schoolName: `Beheer verouderd gevuld seizoen ${marker}`,
        contactName: "Test",
        email: `stale-admin-financial-season-${marker}@example.test`,
      }).returning();
      const app = await startApp(tx as unknown as typeof db, participant);

      try {
        const initial = seasonBody(marker);
        const created = await jsonRequest(
          app.baseUrl,
          `/admin/financial/participants/${participant.id}/seasons`,
          "POST",
          initial,
        );
        assert.equal(created.status, 201);

        const adminSeasonPath = `/admin/financial/participants/${participant.id}/seasons/${created.body.id}`;
        const loaded = await jsonRequest(app.baseUrl, adminSeasonPath);
        assert.equal(loaded.status, 200);
        assert.equal(loaded.body.updatedAt, created.body.updatedAt);
        assert.equal(loaded.body.teachers.length, initial.teachers.length);
        assert.equal(loaded.body.locations.length, initial.locations.length);
        assert.equal(loaded.body.subscriptions.length, initial.subscriptions.length);
        assert.equal(loaded.body.lessons.length, initial.lessons.length);
        assert.equal(loaded.body.closures.length, initial.closures.length);

        const firstTeacherName = `Docent eerst gewijzigd via beheer ${marker}`;
        const firstLocationName = `Locatie eerst gewijzigd via beheer ${marker}`;
        const firstSubscriptionName = `Abonnement eerst gewijzigd via beheer ${marker}`;
        const firstLessonName = `Les eerst gewijzigd via beheer ${marker}`;
        const firstClosureName = `Sluiting eerst gewijzigd via beheer ${marker}`;
        const firstUpdate = {
          ...loaded.body,
          name: `Eerste beheerwijziging gevuld ${marker}`,
          defaultSalary: 725,
          expectedUpdatedAt: loaded.body.updatedAt,
          teachers: loaded.body.teachers.map((item: any) => item.name === initial.teachers[0].name
            ? { ...item, name: firstTeacherName }
            : item),
          locations: loaded.body.locations.map((item: any) => item.name === initial.locations[0].name
            ? { ...item, name: firstLocationName }
            : item),
          subscriptions: loaded.body.subscriptions.map((item: any) => ({
            ...item,
            name: firstSubscriptionName,
            price: 85,
          })),
          lessons: loaded.body.lessons.map((item: any) => item.name === initial.lessons[0].name
            ? { ...item, name: firstLessonName }
            : item),
          closures: loaded.body.closures.map((item: any) => ({
            ...item,
            name: firstClosureName,
          })),
        };
        const updated = await jsonRequest(app.baseUrl, adminSeasonPath, "PUT", firstUpdate);
        assert.equal(updated.status, 200);
        assert.equal(updated.body.name, firstUpdate.name);
        assert.equal(updated.body.defaultSalary, firstUpdate.defaultSalary);
        assert.deepEqual(updated.body.teachers, firstUpdate.teachers);
        assert.deepEqual(updated.body.locations, firstUpdate.locations);
        assert.deepEqual(updated.body.subscriptions, firstUpdate.subscriptions);
        assert.deepEqual(updated.body.lessons, firstUpdate.lessons);
        assert.deepEqual(updated.body.closures, firstUpdate.closures);

        const staleUpdate = {
          ...loaded.body,
          name: `Verouderde beheerwijziging gevuld ${marker}`,
          defaultSalary: 999,
          expectedUpdatedAt: loaded.body.updatedAt,
          teachers: loaded.body.teachers.map((item: any) => ({
            ...item,
            name: `Docent verouderde beheerwijziging ${marker}`,
          })),
          locations: loaded.body.locations.map((item: any) => ({
            ...item,
            name: `Locatie verouderde beheerwijziging ${marker}`,
          })),
          subscriptions: loaded.body.subscriptions.map((item: any) => ({
            ...item,
            name: `Abonnement verouderde beheerwijziging ${marker}`,
            price: 999,
          })),
          lessons: loaded.body.lessons.map((item: any) => ({
            ...item,
            name: `Les verouderde beheerwijziging ${marker}`,
          })),
          closures: loaded.body.closures.map((item: any) => ({
            ...item,
            name: `Sluiting verouderde beheerwijziging ${marker}`,
          })),
        };
        const rejected = await jsonRequest(app.baseUrl, adminSeasonPath, "PUT", staleUpdate);
        assert.equal(rejected.status, 409);

        const afterRejectedUpdate = await jsonRequest(app.baseUrl, adminSeasonPath);
        assert.equal(afterRejectedUpdate.status, 200);
        assert.equal(afterRejectedUpdate.body.name, updated.body.name);
        assert.equal(afterRejectedUpdate.body.defaultSalary, updated.body.defaultSalary);
        assert.equal(afterRejectedUpdate.body.updatedAt, updated.body.updatedAt);
        assert.deepEqual(afterRejectedUpdate.body.teachers, updated.body.teachers);
        assert.deepEqual(afterRejectedUpdate.body.locations, updated.body.locations);
        assert.deepEqual(afterRejectedUpdate.body.subscriptions, updated.body.subscriptions);
        assert.deepEqual(afterRejectedUpdate.body.lessons, updated.body.lessons);
        assert.deepEqual(afterRejectedUpdate.body.closures, updated.body.closures);
      } finally {
        await app.close();
      }

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test("financial master data is atomic and resolves temporary references against a real database", async () => {
  try {
    await db.transaction(async (tx) => {
      const marker = `${Date.now()}-${process.pid}`;
      const [participant] = await tx.insert(participantsTable).values({
        schoolName: `Transactietest ${marker}`,
        contactName: "Test",
        email: `financial-transaction-${marker}@example.test`,
      }).returning();
      const app = await startApp(tx as unknown as typeof db, participant);

      try {
        const initial = seasonBody(marker);
        const created = await jsonRequest(app.baseUrl, "/financial/seasons", "POST", initial);
        assert.equal(created.status, 201);

        const seasonId = created.body.id as number;
        const detail = await jsonRequest(app.baseUrl, `/financial/seasons/${seasonId}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.teachers.length, 2);
        assert.equal(detail.body.locations.length, 2);
        assert.equal(detail.body.lessons.length, 2);

        const retainedTeacher = detail.body.teachers.find((item: any) => item.name === initial.teachers[0].name);
        const retainedLocation = detail.body.locations.find((item: any) => item.name === initial.locations[0].name);
        const retainedLesson = detail.body.lessons.find((item: any) => item.name === initial.lessons[0].name);
        assert.ok(retainedTeacher.id > 0);
        assert.ok(retainedLocation.id > 0);
        assert.equal(retainedLesson.teacherId, retainedTeacher.id);
        assert.equal(retainedLesson.locationId, retainedLocation.id);

        const invalid = seasonBody(`ongeldig-${marker}`);
        invalid.lessons[0].teacherClientId = "missing-teacher";
        invalid.lessons[0].locationClientId = "missing-location";
        const failed = await jsonRequest(app.baseUrl, "/financial/seasons", "POST", invalid);
        assert.equal(failed.status, 400);
        assert.equal((await tx.select().from(financialSeasonsTable).where(eq(financialSeasonsTable.name, invalid.name))).length, 0);
        assert.equal((await tx.select().from(financialTeachersTable).where(eq(financialTeachersTable.name, invalid.teachers[0].name))).length, 0);
        assert.equal((await tx.select().from(financialLocationsTable).where(eq(financialLocationsTable.name, invalid.locations[0].name))).length, 0);
        assert.equal((await tx.select().from(financialLessonsTable).where(eq(financialLessonsTable.name, invalid.lessons[0].name))).length, 0);

        const addedTeacherName = `Docent toegevoegd ${marker}`;
        const addedLocationName = `Locatie toegevoegd ${marker}`;
        const addedLessonName = `Les toegevoegd ${marker}`;
        const update = {
          ...detail.body,
          expectedUpdatedAt: detail.body.updatedAt,
          name: initial.name,
          teachers: [{ ...retainedTeacher, name: `Docent gewijzigd ${marker}` }, teacher("teacher-added", addedTeacherName)],
          locations: [{ ...retainedLocation, name: `Locatie gewijzigd ${marker}` }, location("location-added", addedLocationName)],
          lessons: [
            { ...retainedLesson, name: `Les gewijzigd ${marker}`, teacherId: retainedTeacher.id, locationId: retainedLocation.id },
            lesson(addedLessonName, "teacher-added", "location-added"),
          ],
        };
        const updated = await jsonRequest(app.baseUrl, `/financial/seasons/${seasonId}`, "PUT", update);
        assert.equal(updated.status, 200);
        assert.deepEqual(updated.body.teachers.map((item: any) => item.name).sort(), [addedTeacherName, `Docent gewijzigd ${marker}`].sort());
        assert.deepEqual(updated.body.locations.map((item: any) => item.name).sort(), [addedLocationName, `Locatie gewijzigd ${marker}`].sort());
        assert.deepEqual(updated.body.lessons.map((item: any) => item.name).sort(), [addedLessonName, `Les gewijzigd ${marker}`].sort());

        const addedTeacher = updated.body.teachers.find((item: any) => item.name === addedTeacherName);
        const addedLocation = updated.body.locations.find((item: any) => item.name === addedLocationName);
        const addedLesson = updated.body.lessons.find((item: any) => item.name === addedLessonName);
        assert.equal(addedLesson.teacherId, addedTeacher.id);
        assert.equal(addedLesson.locationId, addedLocation.id);
        assert.equal((await tx.select().from(financialTeachersTable).where(and(
          eq(financialTeachersTable.seasonId, seasonId),
          eq(financialTeachersTable.name, initial.teachers[1].name),
        ))).length, 0);
        assert.equal((await tx.select().from(financialLocationsTable).where(and(
          eq(financialLocationsTable.seasonId, seasonId),
          eq(financialLocationsTable.name, initial.locations[1].name),
        ))).length, 0);
        assert.equal((await tx.select().from(financialLessonsTable).where(and(
          eq(financialLessonsTable.seasonId, seasonId),
          eq(financialLessonsTable.name, initial.lessons[1].name),
        ))).length, 0);
      } finally {
        await app.close();
      }

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});