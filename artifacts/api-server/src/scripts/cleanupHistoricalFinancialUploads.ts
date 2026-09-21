import { db, pool } from "@workspace/db";
import {
  cleanupHistoricalOrphanedFinancialUploads,
  HISTORICAL_FINANCIAL_UPLOAD_RETENTION_MS,
} from "../services/financialFileCleanup.ts";
import { financialSubmissionStorage } from "../services/financialFileStorage.ts";

const deleteObjects = process.argv.includes("--delete");
const unknownArguments = process.argv.slice(2).filter(argument => argument !== "--delete");

if (unknownArguments.length > 0) {
  throw new Error(`Onbekende argumenten: ${unknownArguments.join(", ")}`);
}

try {
  const report = await cleanupHistoricalOrphanedFinancialUploads(db, financialSubmissionStorage, {
    dryRun: !deleteObjects,
  });
  console.log(JSON.stringify({
    ...report,
    retentionDays: HISTORICAL_FINANCIAL_UPLOAD_RETENTION_MS / (24 * 60 * 60 * 1000),
  }));
} finally {
  await pool.end();
}