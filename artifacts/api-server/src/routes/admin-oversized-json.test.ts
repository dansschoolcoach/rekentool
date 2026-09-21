import assert from "node:assert/strict";
import test from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { malformedJsonErrorHandler } from "../middlewares/malformedJsonErrorHandler.ts";
import { createAdminWeeklyEntriesRouter } from "./challenge.ts";
import { createFinancialRouter } from "./financial.ts";

const signedOutMessage = { error: "Je moet ingelogd zijn." };
const forbiddenMessage = { error: "Alleen admins hebben toegang tot dit onderdeel." };
const oversizedMessage = { error: "De JSON in dit verzoek is te groot." };

type TestRole = "signed-out" | "participant" | "admin";

const adminJsonMutations = [
  { path: "/admin/challenge", method: "PATCH" },
  { path: "/admin/weekly-entries?id=29&participantId=17", method: "PATCH" },
  { path: "/admin/financial/file-submissions/31", method: "PATCH" },
  { path: "/admin/financial/participants/17/seasons/23/imports/teachers/confirm", method: "POST" },
  { path: "/admin/financial/participants/17/seasons/23/imports/subscriptions/confirm", method: "POST" },
  { path: "/admin/financial/participants/17/seasons/23/imports/schedule/confirm", method: "POST" },
  { path: "/admin/financial/participants/17/seasons", method: "POST" },
  { path: "/admin/financial/participants/17/seasons/23", method: "PUT" },
  { path: "/admin/financial/participants/17/seasons/23/months/2026-01-01", method: "PUT" },
  { path: "/admin/financial/participants/17/tax-years/2026", method: "PUT" },
] as const;

async function requestOversizedAdminJson(role: TestRole) {
  const actions = { database: 0, storage: 0, email: 0, challenge: 0 };
  const forbiddenDependency = (kind: keyof typeof actions) => new Proxy({}, {
    get() {
      actions[kind] += 1;
      throw new Error(`${kind} action started before oversized request rejection`);
    },
  });
  const signedInMiddleware = (_req: Request, res: Response, next: NextFunction) => {
    if (role === "signed-out") {
      res.status(401).json(signedOutMessage);
      return;
    }
    next();
  };
  const adminMiddleware = (_req: Request, res: Response, next: NextFunction) => {
    if (role !== "admin") {
      res.status(403).json(forbiddenMessage);
      return;
    }
    next();
  };
  const allow = (_req: Request, _res: Response, next: NextFunction) => next();
  const allowAdmin = async (_req: Request, _res: Response, next: NextFunction) => next();
  const app = express();
  app.use("/admin", signedInMiddleware, adminMiddleware);
  app.use(express.json());
  app.use(malformedJsonErrorHandler);
  app.patch("/admin/challenge", () => {
    actions.challenge += 1;
  });
  app.use("/admin/weekly-entries", createAdminWeeklyEntriesRouter({
    database: forbiddenDependency("database") as never,
    signedInMiddleware: allow,
    adminMiddleware: allowAdmin,
  }));
  app.use(createFinancialRouter({
    database: forbiddenDependency("database") as never,
    signedInMiddleware: allow,
    adminMiddleware: allow,
    submissionStorage: forbiddenDependency("storage") as never,
    sendSubmissionProcessedEmail: forbiddenDependency("email") as never,
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const oversizedBody = JSON.stringify({ value: "x".repeat(101 * 1024) });
    const responses = await Promise.all(adminJsonMutations.map(({ path, method }) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: oversizedBody,
      }),
    ));
    return {
      responses: await Promise.all(responses.map(async response => ({
        status: response.status,
        body: await response.json() as unknown,
      }))),
      actions,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

test("all other admin JSON mutations reject oversized signed-out requests before parsing", async () => {
  const result = await requestOversizedAdminJson("signed-out");

  assert.deepEqual(
    result.responses,
    adminJsonMutations.map(() => ({ status: 401, body: signedOutMessage })),
  );
  assert.deepEqual(result.actions, { database: 0, storage: 0, email: 0, challenge: 0 });
});

test("all other admin JSON mutations reject oversized non-admin requests before parsing", async () => {
  const result = await requestOversizedAdminJson("participant");

  assert.deepEqual(
    result.responses,
    adminJsonMutations.map(() => ({ status: 403, body: forbiddenMessage })),
  );
  assert.deepEqual(result.actions, { database: 0, storage: 0, email: 0, challenge: 0 });
});

test("all other admin JSON mutations expose the fixed oversized response only to admins", async () => {
  const result = await requestOversizedAdminJson("admin");

  assert.deepEqual(
    result.responses,
    adminJsonMutations.map(() => ({ status: 413, body: oversizedMessage })),
  );
  assert.deepEqual(result.actions, { database: 0, storage: 0, email: 0, challenge: 0 });
});