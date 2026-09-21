import assert from "node:assert/strict";
import type { Server } from "node:http";
import test, { after } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import ExcelJS from "exceljs";
import { participantsTable, pool } from "@workspace/db";
import { createAdminParticipantsRouter } from "./challenge.ts";
import { createIsolatedTestDatabase } from "../test/isolatedDatabase.ts";
import { PARTICIPANT_IMPORT_HEADERS } from "../services/participantImport.ts";

async function participantFile(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Deelnemers");
  sheet.addRow([...PARTICIPANT_IMPORT_HEADERS]);
  rows.forEach(row => sheet.addRow(row));
  return new File([await workbook.xlsx.writeBuffer()], "deelnemers.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function postFile(baseUrl: string, path: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", body: form });
  return { status: response.status, body: await response.json() as any };
}

after(async () => {
  await pool.end();
});

test("participant import reports every source row and never partially stores a mixed list", async () => {
  const isolated = await createIsolatedTestDatabase("participant_import_atomic");
  let server: Server | undefined;
  try {
    const app = express();
    app.use((req, _res, next) => {
      req.log = { info() {} } as unknown as Request["log"];
      next();
    });
    app.use("/admin/participants", createAdminParticipantsRouter({
      database: isolated.db,
      signedInMiddleware: (_req, _res, next) => next(),
      adminMiddleware: async (_req, _res, next) => next(),
    }));
    app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: "Interne serverfout." });
    });
    server = app.listen(0, "127.0.0.1");
    const activeServer = server;
    await new Promise<void>(resolve => activeServer.once("listening", resolve));
    const address = activeServer.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await isolated.db.insert(participantsTable).values({
      schoolName: "Bestaande school",
      contactName: "Bestaande beheerder",
      email: "bestaand@example.test",
      country: "Nederland",
    });

    const mixedFile = await participantFile([
      ["Dansschool Geldig", "Gwen", "gwen@example.test", "Nederland"],
      ["Dansschool Leeg", "Olivia", "", "België"],
      ["Dansschool Zonder Apenstaart", "Amir", "amir.example.test", "Nederland"],
      ["Dansschool Zonder Domeinpunt", "Dana", "dana@example", "België"],
      ["Dansschool Dubbel", "Alex", "BESTAAND@EXAMPLE.TEST", "Nederland"],
    ]);
    const preview = await postFile(baseUrl, "/admin/participants/import/preview", mixedFile);
    assert.equal(preview.status, 422);
    assert.deepEqual(preview.body.rows.map((row: any) => row.row), [2, 3, 4, 5, 6]);
    assert.deepEqual(preview.body.issues.map((issue: any) => issue.row), [3, 4, 5, 6]);
    assert.equal((await isolated.db.select().from(participantsTable)).length, 1);

    const rejectedImport = await postFile(baseUrl, "/admin/participants/import/confirm", mixedFile);
    assert.equal(rejectedImport.status, 422);
    assert.deepEqual(rejectedImport.body.rows.map((row: any) => row.row), [2, 3, 4, 5, 6]);
    assert.deepEqual(rejectedImport.body.issues.map((issue: any) => issue.row), [3, 4, 5, 6]);
    assert.equal((await isolated.db.select().from(participantsTable)).length, 1);

    const malformedResponse = await fetch(`${baseUrl}/admin/participants/import/preview`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data" },
      body: "geen geldige multipart-inhoud",
    });
    const malformedBody = await malformedResponse.json() as any;
    assert.equal(malformedResponse.status, 422);
    assert.equal(malformedBody.valid, false);
    assert.equal(malformedBody.issues[0].column, "Bestand");

    const validFile = await participantFile([
      ["Dansschool Noord", "Nina", " NINA@EXAMPLE.TEST ", "Nederland"],
      ["Dansschool Zuid", "Sam", "sam@example.test", "België"],
    ]);
    const validPreview = await postFile(baseUrl, "/admin/participants/import/preview", validFile);
    assert.equal(validPreview.status, 200);
    assert.equal(validPreview.body.valid, true);
    assert.equal((await isolated.db.select().from(participantsTable)).length, 1);

    const imported = await postFile(baseUrl, "/admin/participants/import/confirm", validFile);
    assert.equal(imported.status, 201);
    assert.deepEqual(imported.body, { importedCount: 2 });
    const stored = await isolated.db.select().from(participantsTable);
    assert.deepEqual(stored.map(row => row.email).sort(), ["bestaand@example.test", "nina@example.test", "sam@example.test"]);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await isolated.dispose();
  }
});