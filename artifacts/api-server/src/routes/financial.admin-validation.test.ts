import assert from "node:assert/strict";
import test from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { createFinancialRouter } from "./financial.ts";

async function startApp() {
  let databaseActions = 0;
  const database = new Proxy({}, {
    get() {
      databaseActions += 1;
      throw new Error("Database action started after invalid request-body validation");
    },
  });
  const allow = (_req: Request, _res: Response, next: NextFunction) => next();
  const app = express();
  app.use(express.json());
  app.use(createFinancialRouter({
    database: database as never,
    signedInMiddleware: allow,
    adminMiddleware: allow,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    databaseActions: () => databaseActions,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

test("invalid admin financial payloads return 400 before database actions", async () => {
  const app = await startApp();
  try {
    const requests = [
      ["/admin/financial/participants/17/seasons", "POST"],
      ["/admin/financial/participants/17/seasons/23", "PUT"],
      ["/admin/financial/participants/17/seasons/23/months/2026-01-01", "PUT"],
      ["/admin/financial/participants/17/tax-years/2026", "PUT"],
    ] as const;

    const responses = await Promise.all(requests.map(([path, method]) => fetch(`${app.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invalid: true }),
    })));

    assert.deepEqual(responses.map(response => response.status), [400, 400, 400, 400]);
    assert.equal(app.databaseActions(), 0);
  } finally {
    await app.close();
  }
});

test("unsafe financial route ids return their intended 400 errors before database actions", async () => {
  const app = await startApp();
  const unsafeId = String(Number.MAX_SAFE_INTEGER + 1);
  try {
    const requests = [
      [`/admin/financial/participants/${unsafeId}/seasons`, "Ongeldige deelnemer."],
      [`/admin/financial/participants/17/seasons/${unsafeId}`, "Ongeldige deelnemer of seizoen."],
      [`/financial/seasons/${unsafeId}`, "Ongeldig seizoen."],
      [`/admin/financial/file-submissions/${unsafeId}`, "Ongeldige aanlevering."],
    ] as const;

    const responses = await Promise.all(requests.map(async ([path]) => {
      const response = await fetch(`${app.baseUrl}${path}`, {
        method: path.includes("file-submissions") ? "PATCH" : "GET",
        headers: { "content-type": "application/json" },
        body: path.includes("file-submissions") ? JSON.stringify({ status: "processed" }) : undefined,
      });
      return {
        status: response.status,
        body: await response.json(),
      };
    }));

    assert.deepEqual(
      responses,
      requests.map(([, error]) => ({ status: 400, body: { error } })),
    );
    assert.equal(app.databaseActions(), 0);
  } finally {
    await app.close();
  }
});
