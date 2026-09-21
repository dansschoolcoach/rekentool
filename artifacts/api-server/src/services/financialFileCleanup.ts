import { and, eq, lte } from "drizzle-orm";
import { financialFileSubmissionsTable } from "@workspace/db";
import type { db as defaultDb } from "@workspace/db";
import { logger } from "../lib/logger.ts";
import type { FinancialSubmissionStorage } from "./financialFileStorage.ts";

export const FINANCIAL_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
export const HISTORICAL_FINANCIAL_UPLOAD_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function cleanupAbandonedFinancialUploads(
  database: typeof defaultDb,
  storage: FinancialSubmissionStorage,
  options: {
    now?: Date;
    retentionMs?: number;
    logError?: (context: Record<string, unknown>, message: string) => void;
  } = {},
) {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.retentionMs ?? FINANCIAL_UPLOAD_RETENTION_MS));
  const logError = options.logError ?? ((context, message) => logger.error(context, message));
  const candidates = await database.select().from(financialFileSubmissionsTable)
    .where(and(
      eq(financialFileSubmissionsTable.status, "uploading"),
      lte(financialFileSubmissionsTable.createdAt, cutoff),
    ));
  let removed = 0;

  for (const candidate of candidates) {
    const [claimed] = await database.update(financialFileSubmissionsTable)
      .set({ status: "deleting", updatedAt: now })
      .where(and(
        eq(financialFileSubmissionsTable.id, candidate.id),
        eq(financialFileSubmissionsTable.status, "uploading"),
        lte(financialFileSubmissionsTable.createdAt, cutoff),
      ))
      .returning({ id: financialFileSubmissionsTable.id });
    if (!claimed) continue;

    try {
      await storage.delete(candidate.objectPath);
      await database.delete(financialFileSubmissionsTable).where(and(
        eq(financialFileSubmissionsTable.id, candidate.id),
        eq(financialFileSubmissionsTable.status, "deleting"),
      ));
      removed += 1;
    } catch (error) {
      try {
        await database.update(financialFileSubmissionsTable)
          .set({ status: "uploading", updatedAt: now })
          .where(and(
            eq(financialFileSubmissionsTable.id, candidate.id),
            eq(financialFileSubmissionsTable.status, "deleting"),
          ));
      } catch (resetError) {
        logError({
          err: resetError,
          submissionId: candidate.id,
          objectPath: candidate.objectPath,
        }, "Could not reset abandoned financial upload after cleanup failure");
      }
      logError({
        err: error,
        submissionId: candidate.id,
        objectPath: candidate.objectPath,
      }, "Could not remove abandoned financial upload");
    }
  }

  return { candidates: candidates.length, removed };
}

export async function cleanupHistoricalOrphanedFinancialUploads(
  database: typeof defaultDb,
  storage: FinancialSubmissionStorage,
  options: {
    dryRun?: boolean;
    now?: Date;
    retentionMs?: number;
    logError?: (context: Record<string, unknown>, message: string) => void;
  } = {},
) {
  const dryRun = options.dryRun ?? true;
  const now = options.now ?? new Date();
  const retentionMs = options.retentionMs ?? HISTORICAL_FINANCIAL_UPLOAD_RETENTION_MS;
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new Error("De bewaartermijn voor historische uploads moet groter dan nul zijn.");
  }
  const cutoff = new Date(now.getTime() - retentionMs);
  const logError = options.logError ?? ((context, message) => logger.error(context, message));
  const objects = await storage.listFinancialSubmissionObjects();
  const registered = await database.select({
    objectPath: financialFileSubmissionsTable.objectPath,
  }).from(financialFileSubmissionsTable);
  const registeredPaths = new Set(registered.map(row => row.objectPath));
  let skipped = 0;
  let removed = 0;

  for (const object of objects) {
    if (registeredPaths.has(object.objectPath) || object.createdAt === null || object.createdAt > cutoff) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      skipped += 1;
      continue;
    }

    try {
      const [linkedNow] = await database.select({ id: financialFileSubmissionsTable.id })
        .from(financialFileSubmissionsTable)
        .where(eq(financialFileSubmissionsTable.objectPath, object.objectPath))
        .limit(1);
      if (linkedNow) {
        skipped += 1;
        continue;
      }
      await storage.delete(object.objectPath);
      removed += 1;
    } catch (error) {
      skipped += 1;
      logError({ err: error, objectPath: object.objectPath }, "Could not remove historical orphaned financial upload");
    }
  }

  return { dryRun, found: objects.length, skipped, removed };
}