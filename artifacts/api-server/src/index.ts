import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { clerkClient } from "@clerk/express";
import { retryParticipantIdentityReleases } from "./services/participantAccess";
import { cleanupAbandonedFinancialUploads } from "./services/financialFileCleanup";
import { financialSubmissionStorage } from "./services/financialFileStorage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const identityReleaseRetry = setInterval(() => {
  retryParticipantIdentityReleases(db, (userId) => clerkClient.users.deleteUser(userId)).catch((err) => {
    logger.error({ err }, "Could not retry participant identity releases");
  });
}, 30_000);
identityReleaseRetry.unref();

retryParticipantIdentityReleases(db, (userId) => clerkClient.users.deleteUser(userId)).catch((err) => {
  logger.error({ err }, "Could not retry participant identity releases at startup");
});

const financialUploadCleanup = setInterval(() => {
  cleanupAbandonedFinancialUploads(db, financialSubmissionStorage).catch((err) => {
    logger.error({ err }, "Could not clean up abandoned financial uploads");
  });
}, 60 * 60 * 1000);
financialUploadCleanup.unref();

cleanupAbandonedFinancialUploads(db, financialSubmissionStorage).catch((err) => {
  logger.error({ err }, "Could not clean up abandoned financial uploads at startup");
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
