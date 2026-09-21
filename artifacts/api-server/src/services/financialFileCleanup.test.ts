import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  financialFileSubmissionsTable,
  financialSeasonsTable,
  participantsTable,
  pool,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";
import {
  cleanupAbandonedFinancialUploads,
  cleanupHistoricalOrphanedFinancialUploads,
  FINANCIAL_UPLOAD_RETENTION_MS,
  HISTORICAL_FINANCIAL_UPLOAD_RETENTION_MS,
} from "./financialFileCleanup.ts";
import type { FinancialSubmissionStorage } from "./financialFileStorage.ts";

test("cleanup removes only expired unconfirmed financial uploads and continues after failures", async () => {
  const isolated = await createIsolatedTestDatabase("financial_file_cleanup_test");
  try {
    const marker = `${Date.now()}-${process.pid}`;
    const [participant] = await isolated.db.insert(participantsTable).values({
      schoolName: `Cleanup ${marker}`,
      contactName: "Cleanup",
      email: `cleanup-${marker}@example.test`,
    }).returning();
    const [season] = await isolated.db.insert(financialSeasonsTable).values({
      participantId: participant.id,
      name: "Seizoen",
      startDate: "2026-09-01",
      endDate: "2027-06-30",
      country: "Nederland",
    }).returning();
    const old = new Date("2026-09-14T00:00:00Z");
    const paths = {
      failed: `/objects/financial-submissions/${participant.id}/${season.id}/11111111-1111-1111-1111-111111111111.xlsx`,
      abandoned: `/objects/financial-submissions/${participant.id}/${season.id}/22222222-2222-2222-2222-222222222222.xlsx`,
      confirmed: `/objects/financial-submissions/${participant.id}/${season.id}/33333333-3333-3333-3333-333333333333.xlsx`,
      recent: `/objects/financial-submissions/${participant.id}/${season.id}/44444444-4444-4444-4444-444444444444.xlsx`,
    };
    await isolated.db.insert(financialFileSubmissionsTable).values([
      { participantId: participant.id, seasonId: season.id, fileType: "teachers", originalFilename: "failed.xlsx", objectPath: paths.failed, sizeBytes: 4, status: "uploading", createdAt: old },
      { participantId: participant.id, seasonId: season.id, fileType: "teachers", originalFilename: "abandoned.xlsx", objectPath: paths.abandoned, sizeBytes: 4, status: "uploading", createdAt: old },
      { participantId: participant.id, seasonId: season.id, fileType: "teachers", originalFilename: "confirmed.xlsx", objectPath: paths.confirmed, sizeBytes: 4, status: "open", createdAt: old },
      { participantId: participant.id, seasonId: season.id, fileType: "teachers", originalFilename: "recent.xlsx", objectPath: paths.recent, sizeBytes: 4, status: "uploading", createdAt: new Date("2026-09-15T13:00:00Z") },
    ]);
    const deleted: string[] = [];
    const errors: Array<{ context: Record<string, unknown>; message: string }> = [];
    const storage: FinancialSubmissionStorage = {
      async requestUpload() { throw new Error("unused"); },
      async listFinancialSubmissionObjects() { return []; },
      async inspect() { return null; },
      createReadStream() { return Readable.from([]); },
      async delete(objectPath) {
        if (objectPath === paths.failed) throw new Error("storage unavailable");
        deleted.push(objectPath);
      },
    };

    const result = await cleanupAbandonedFinancialUploads(isolated.db, storage, {
      now: new Date("2026-09-16T12:00:00Z"),
      retentionMs: FINANCIAL_UPLOAD_RETENTION_MS,
      logError: (context, message) => errors.push({ context, message }),
    });

    assert.deepEqual(result, { candidates: 2, removed: 1 });
    assert.deepEqual(deleted, [paths.abandoned]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].context.objectPath, paths.failed);
    const remaining = await isolated.db.select().from(financialFileSubmissionsTable);
    assert.deepEqual(new Set(remaining.map(row => row.objectPath)), new Set([paths.failed, paths.confirmed, paths.recent]));
    assert.equal(remaining.find(row => row.objectPath === paths.failed)?.status, "uploading");
    assert.equal(remaining.find(row => row.objectPath === paths.confirmed)?.status, "open");
    assert.equal((await isolated.db.select().from(financialFileSubmissionsTable).where(eq(financialFileSubmissionsTable.objectPath, paths.abandoned))).length, 0);
  } finally {
    await isolated.dispose();
  }
});

test("historical cleanup reports a dry run and only deletes old unregistered Excel objects", async () => {
  const isolated = await createIsolatedTestDatabase("historical_financial_file_cleanup_test");
  try {
    const marker = `${Date.now()}-${process.pid}`;
    const [participant] = await isolated.db.insert(participantsTable).values({
      schoolName: `Historical cleanup ${marker}`,
      contactName: "Cleanup",
      email: `historical-cleanup-${marker}@example.test`,
    }).returning();
    const [season] = await isolated.db.insert(financialSeasonsTable).values({
      participantId: participant.id,
      name: "Seizoen",
      startDate: "2026-09-01",
      endDate: "2027-06-30",
      country: "Nederland",
    }).returning();
    const paths = {
      orphan: `/objects/financial-submissions/${participant.id}/${season.id}/55555555-5555-5555-5555-555555555555.xlsx`,
      linked: `/objects/financial-submissions/${participant.id}/${season.id}/66666666-6666-6666-6666-666666666666.xlsx`,
      recent: `/objects/financial-submissions/${participant.id}/${season.id}/77777777-7777-7777-7777-777777777777.xlsx`,
      unknownAge: `/objects/financial-submissions/${participant.id}/${season.id}/88888888-8888-8888-8888-888888888888.xlsx`,
    };
    await isolated.db.insert(financialFileSubmissionsTable).values({
      participantId: participant.id,
      seasonId: season.id,
      fileType: "teachers",
      originalFilename: "linked.xlsx",
      objectPath: paths.linked,
      sizeBytes: 4,
      status: "open",
    });
    const deleted: string[] = [];
    const storage: FinancialSubmissionStorage = {
      async requestUpload() { throw new Error("unused"); },
      async listFinancialSubmissionObjects() {
        return [
          { objectPath: paths.orphan, createdAt: new Date("2026-01-01T00:00:00Z") },
          { objectPath: paths.linked, createdAt: new Date("2026-01-01T00:00:00Z") },
          { objectPath: paths.recent, createdAt: new Date("2026-09-01T00:00:00Z") },
          { objectPath: paths.unknownAge, createdAt: null },
        ];
      },
      async inspect() { return null; },
      createReadStream() { return Readable.from([]); },
      async delete(objectPath) { deleted.push(objectPath); },
    };
    const options = {
      now: new Date("2026-09-19T00:00:00Z"),
      retentionMs: HISTORICAL_FINANCIAL_UPLOAD_RETENTION_MS,
    };

    const dryRun = await cleanupHistoricalOrphanedFinancialUploads(isolated.db, storage, options);
    assert.deepEqual(dryRun, { dryRun: true, found: 4, skipped: 4, removed: 0 });
    assert.deepEqual(deleted, []);

    const deletion = await cleanupHistoricalOrphanedFinancialUploads(isolated.db, storage, {
      ...options,
      dryRun: false,
    });
    assert.deepEqual(deletion, { dryRun: false, found: 4, skipped: 3, removed: 1 });
    assert.deepEqual(deleted, [paths.orphan]);
  } finally {
    await isolated.dispose();
  }
});

after(async () => {
  await pool.end();
});