import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  GetAdminFinancialFileSubmissionsResponse,
  UpdateAdminFinancialFileSubmissionResponse,
} from "@workspace/api-zod";
import {
  financialFileSubmissionsTable,
  financialSeasonsTable,
  financialTeachersTable,
  participantsTable,
  pool,
  type Participant,
} from "@workspace/db";
import { createFinancialRouter } from "./financial.ts";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";
import type { FinancialSubmissionStorage } from "../services/financialFileStorage.ts";

test("financial file submissions stay private, queued, and separate from imports", async () => {
  const isolated = await createIsolatedTestDatabase("financial_file_submission_test");
  const marker = `${Date.now()}-${process.pid}`;
  const [owner, outsider] = await isolated.db.insert(participantsTable).values([
    { schoolName: `Submission owner ${marker}`, contactName: "Owner", email: `submission-owner-${marker}@example.test` },
    { schoolName: `Submission outsider ${marker}`, contactName: "Outsider", email: `submission-outsider-${marker}@example.test` },
  ]).returning();
  const [season] = await isolated.db.insert(financialSeasonsTable).values({
    participantId: owner.id,
    name: "Seizoen 2026",
    startDate: "2026-09-01",
    endDate: "2027-06-30",
    country: "Nederland",
  }).returning();
  await isolated.db.insert(financialTeachersTable).values({
    seasonId: season.id,
    name: "Bestaande docent",
    hourlyRateCents: 3500,
  });

  const objects = new Map<string, Buffer>();
  let uploadCounter = 0;
  const storage: FinancialSubmissionStorage = {
    async requestUpload(participantId, seasonId) {
      uploadCounter += 1;
      return {
        uploadUrl: "https://storage.example.test/signed",
        objectPath: `/objects/financial-submissions/${participantId}/${seasonId}/11111111-1111-1111-1111-${String(uploadCounter).padStart(12, "0")}.xlsx`,
      };
    },
    async listFinancialSubmissionObjects() { return []; },
    async inspect(objectPath) {
      const bytes = objects.get(objectPath);
      return bytes ? {
        size: bytes.length,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        hasZipSignature: bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      } : null;
    },
    createReadStream(objectPath) {
      return Readable.from(objects.get(objectPath) ?? Buffer.alloc(0));
    },
    async delete(objectPath) {
      objects.delete(objectPath);
    },
  };
  const sentEmails: Array<{ email: string; filename: string }> = [];
  let emailFailure: Error | null = null;
  let server: Server | undefined;
  try {
    const app = express();
    app.use(express.json());
    app.use(createFinancialRouter({
      database: isolated.db,
      participantForRequest: async req => Number(req.headers["x-participant-id"]) === outsider.id ? outsider : owner,
      signedInMiddleware: (_req, _res, next) => next(),
      adminMiddleware: (req, res, next) => req.headers["x-admin"] === "true" ? next() : res.status(403).json({ error: "admin required" }),
      adminDisplayNameForRequest: () => "Ninny Beheer",
      submissionStorage: storage,
      sendSubmissionProcessedEmail: async input => {
        sentEmails.push({ email: input.email, filename: input.filename });
        if (emailFailure) throw emailFailure;
      },
    }));
    app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: "request failed" }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    async function json(path: string, participant: Participant, options: { method?: string; body?: unknown; admin?: boolean } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          "content-type": "application/json",
          "x-participant-id": String(participant.id),
          ...(options.admin ? { "x-admin": "true" } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, body: await response.json() as any };
    }

    const uploadPath = `/financial/seasons/${season.id}/file-submissions/upload`;
    assert.equal((await json(uploadPath, owner, {
      method: "POST",
      body: { fileType: "teachers", filename: "docenten.csv", sizeBytes: 4 },
    })).status, 400);
    assert.equal((await json(uploadPath, outsider, {
      method: "POST",
      body: { fileType: "teachers", filename: "docenten.xlsx", sizeBytes: 4 },
    })).status, 404);

    const upload = await json(uploadPath, owner, {
      method: "POST",
      body: { fileType: "teachers", filename: "docenten.xlsx", sizeBytes: 4 },
    });
    assert.equal(upload.status, 200);
    assert.equal((await isolated.db.select().from(financialFileSubmissionsTable)).at(0)?.status, "uploading");
    assert.deepEqual((await json(`/financial/seasons/${season.id}/file-submissions`, owner)).body, []);
    objects.set(upload.body.objectPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const teachersBefore = await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, season.id));
    const created = await json(`/financial/seasons/${season.id}/file-submissions`, owner, {
      method: "POST",
      body: {
        fileType: "teachers",
        filename: "docenten.xlsx",
        sizeBytes: 4,
        objectPath: upload.body.objectPath,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "open");
    assert.equal((await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, season.id))).length, teachersBefore.length);
    assert.equal((await isolated.db.select().from(financialFileSubmissionsTable)).length, 1);

    assert.equal((await json(`/financial/seasons/${season.id}/file-submissions`, outsider)).status, 404);
    const ownerList = await json(`/financial/seasons/${season.id}/file-submissions`, owner);
    assert.equal(ownerList.body[0].filename, "docenten.xlsx");
    assert.equal((await json("/admin/financial/file-submissions", owner)).status, 403);
    const [existingSubmission] = await isolated.db.insert(financialFileSubmissionsTable).values({
      participantId: owner.id,
      seasonId: season.id,
      fileType: "subscriptions",
      originalFilename: "bestaande-abonnementen.xlsx",
      objectPath: `/objects/financial-submissions/${owner.id}/${season.id}/existing.xlsx`,
      sizeBytes: 4,
      status: "open",
    }).returning();
    const queue = await json("/admin/financial/file-submissions", owner, { admin: true });
    assert.equal(queue.status, 200);
    const parsedQueue = GetAdminFinancialFileSubmissionsResponse.parse(queue.body);
    for (const submissionId of [created.body.id, existingSubmission.id]) {
      const queuedSubmission = parsedQueue.find(submission => submission.id === submissionId);
      assert.ok(queuedSubmission);
      assert.equal(queuedSubmission.schoolName, owner.schoolName);
      assert.equal(queuedSubmission.seasonName, season.name);
      assert.equal(queuedSubmission.status, "open");
      assert.equal(queuedSubmission.statusChangedAt, null);
      assert.equal(queuedSubmission.statusChangedBy, null);
      assert.equal(queuedSubmission.notificationAttemptedAt, null);
      assert.equal(queuedSubmission.notificationSentAt, null);
      assert.equal(queuedSubmission.notificationError, null);
    }

    assert.equal((await json(`/admin/financial/file-submissions/${created.body.id}`, owner, {
      method: "PATCH",
      body: { status: "processed" },
    })).status, 403);
    assert.equal((await json(`/admin/financial/file-submissions/${created.body.id}`, owner, {
      method: "PATCH",
      admin: true,
      body: { status: "unknown" },
    })).status, 400);
    const updated = await json(`/admin/financial/file-submissions/${created.body.id}`, owner, {
      method: "PATCH",
      admin: true,
      body: { status: "in_progress" },
    });
    assert.equal(updated.status, 200);
    const parsedUpdated = UpdateAdminFinancialFileSubmissionResponse.parse(updated.body);
    assert.equal(parsedUpdated.status, "in_progress");
    assert.equal(parsedUpdated.statusChangedBy, "Ninny Beheer");
    assert.ok(!Number.isNaN(parsedUpdated.statusChangedAt?.getTime()));
    assert.equal(parsedUpdated.notificationAttemptedAt, null);
    assert.equal(parsedUpdated.notificationSentAt, null);
    assert.equal(parsedUpdated.notificationError, null);
    const [storedSubmission] = await isolated.db
      .select()
      .from(financialFileSubmissionsTable)
      .where(eq(financialFileSubmissionsTable.id, created.body.id));
    assert.equal(storedSubmission.statusChangedBy, "Ninny Beheer");
    assert.equal(storedSubmission.statusChangedAt?.toISOString(), parsedUpdated.statusChangedAt?.toISOString());
    const refreshedOwnerList = await json(`/financial/seasons/${season.id}/file-submissions`, owner);
    const refreshedCreatedSubmission = refreshedOwnerList.body.find((submission: { id: number }) => submission.id === created.body.id);
    assert.ok(refreshedCreatedSubmission);
    assert.equal(refreshedCreatedSubmission.status, "in_progress");
    assert.equal("statusChangedBy" in refreshedCreatedSubmission, false);
    assert.equal("statusChangedAt" in refreshedCreatedSubmission, false);
    assert.equal((await isolated.db.select().from(financialTeachersTable).where(eq(financialTeachersTable.seasonId, season.id))).length, teachersBefore.length);

    const processed = await json(`/admin/financial/file-submissions/${created.body.id}`, owner, {
      method: "PATCH",
      admin: true,
      body: { status: "processed" },
    });
    assert.equal(processed.status, 200);
    const parsedProcessed = UpdateAdminFinancialFileSubmissionResponse.parse(processed.body);
    assert.equal(sentEmails.length, 1);
    assert.deepEqual(sentEmails[0], { email: owner.email, filename: "docenten.xlsx" });
    assert.ok(parsedProcessed.notificationAttemptedAt);
    assert.ok(parsedProcessed.notificationSentAt);
    assert.equal(parsedProcessed.notificationError, null);
    const processedAgain = await json(`/admin/financial/file-submissions/${created.body.id}`, owner, {
      method: "PATCH",
      admin: true,
      body: { status: "processed" },
    });
    assert.equal(processedAgain.status, 200);
    UpdateAdminFinancialFileSubmissionResponse.parse(processedAgain.body);
    assert.equal(sentEmails.length, 1);

    const secondUpload = await json(uploadPath, owner, {
      method: "POST",
      body: { fileType: "subscriptions", filename: "abonnementen.xlsx", sizeBytes: 4 },
    });
    objects.set(secondUpload.body.objectPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const secondCreated = await json(`/financial/seasons/${season.id}/file-submissions`, owner, {
      method: "POST",
      body: {
        fileType: "subscriptions",
        filename: "abonnementen.xlsx",
        sizeBytes: 4,
        objectPath: secondUpload.body.objectPath,
      },
    });
    emailFailure = new Error("Resend tijdelijk niet beschikbaar");
    const failedNotification = await json(`/admin/financial/file-submissions/${secondCreated.body.id}`, owner, {
      method: "PATCH",
      admin: true,
      body: { status: "processed" },
    });
    assert.equal(failedNotification.status, 200);
    const parsedFailedNotification = UpdateAdminFinancialFileSubmissionResponse.parse(failedNotification.body);
    assert.equal(parsedFailedNotification.status, "processed");
    assert.ok(parsedFailedNotification.notificationAttemptedAt);
    assert.match(parsedFailedNotification.notificationError ?? "", /Resend tijdelijk niet beschikbaar/);
    assert.equal(parsedFailedNotification.notificationSentAt, null);
    assert.equal(sentEmails.length, 2);
    const failedNotificationAgain = await json(`/admin/financial/file-submissions/${secondCreated.body.id}`, owner, {
      method: "PATCH",
      admin: true,
      body: { status: "processed" },
    });
    assert.equal(failedNotificationAgain.status, 200);
    UpdateAdminFinancialFileSubmissionResponse.parse(failedNotificationAgain.body);
    assert.equal(sentEmails.length, 2);

    const outsiderDownload = await fetch(`${baseUrl}/financial/file-submissions/${created.body.id}/download`, {
      headers: { "x-participant-id": String(outsider.id) },
    });
    assert.equal(outsiderDownload.status, 404);
    const ownerDownload = await fetch(`${baseUrl}/financial/file-submissions/${created.body.id}/download`, {
      headers: { "x-participant-id": String(owner.id) },
    });
    assert.equal(ownerDownload.status, 200);
    assert.deepEqual(Buffer.from(await ownerDownload.arrayBuffer()), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  } finally {
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    await isolated.dispose();
  }
});

after(async () => {
  await pool.end();
});