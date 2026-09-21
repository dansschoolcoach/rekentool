import { pool } from "@workspace/db";
import { backfillLegacyFinancialMonthSnapshots } from "../services/financialSnapshot.ts";

try {
  const report = await backfillLegacyFinancialMonthSnapshots();
  console.log(JSON.stringify(report, null, 2));
  if (report.nonMigratable.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
}