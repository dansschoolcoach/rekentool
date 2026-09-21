import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  buildScheduleImportTemplate,
  parseFinancialImport,
  parseScheduleImport,
  SCHEDULE_HEADERS,
  SCHEDULE_METADATA_SHEET,
  SCHEDULE_TEMPLATE_VERSION,
  type ScheduleImportContext,
  type SubscriptionImportRow,
} from "./financialImport.ts";

const publishedTemplateDirectory = path.resolve(
  import.meta.dirname,
  "../../../byb-ledenchallenge/public/templates",
);

async function workbookBuffer(sheets: Record<string, unknown[][] | undefined>) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    if (!rows) continue;
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

for (const template of [
  {
    filename: "ByB-Cijfers-sjabloon-docenten.xlsx",
    kind: "teachers",
  },
  {
    filename: "ByB-Cijfers-sjabloon-abonnementen-en-rittenkaarten.xlsx",
    kind: "subscriptions",
  },
] as const) {
  test(`published ${template.kind} template matches the financial import schema`, async () => {
    const buffer = await readFile(path.join(publishedTemplateDirectory, template.filename));
    const result = await parseFinancialImport(buffer, template.filename, template.kind);

    assert.deepEqual(result.issues, []);
  });
}

test("teacher import matches worksheet names case-insensitively and ignores empty rows", async () => {
  const result = await parseFinancialImport(await workbookBuffer({
    " docenten ": [
      ["Naam docent", "Uurtarief (€)", "Reiskosten per week (€)"],
      [" Nina ", 35, 4.5],
      [null, null, null],
    ],
    Instructies: [["niet relevant"]],
  }), "teachers.XLSX", "teachers");

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows, [{ name: "Nina", hourlyRate: 35, weeklyTravel: 4.5 }]);
});

test("teacher import ignores extra worksheets", async () => {
  const result = await parseFinancialImport(await workbookBuffer({
    Docenten: [
      ["Naam docent", "Uurtarief (€)", "Reiskosten per week (€)"],
      ["Nina", 35, 4.5],
    ],
    Instructies: [
      ["Dit tabblad wordt niet geïmporteerd"],
      ["Geen docent", "geen uurtarief", "geen reiskosten"],
    ],
  }), "teachers.xlsx", "teachers");

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows, [{ name: "Nina", hourlyRate: 35, weeklyTravel: 4.5 }]);
});

test("teacher import rejects changed column headers without returning rows", async () => {
  const result = await parseFinancialImport(await workbookBuffer({
    Docenten: [
      ["Naam docent", "Uurtarief (€ incl. btw indien van toepassing)", "Andere kolom"],
      ["Nina", 35, 4.5],
    ],
  }), "teachers.xlsx", "teachers");

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues, [{
    sheet: "Docenten",
    row: 1,
    message: "De kolommen moeten exact zijn: Naam docent, Uurtarief (€ incl. btw indien van toepassing), Reiskosten per week (€ incl. btw).",
  }]);
});

test("subscription import ignores extra worksheets", async () => {
  const result = await parseFinancialImport(await workbookBuffer({
    Abonnementen: [
      ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden", "Btw-tarief"],
      ["Maand", "Jeugd", "Per maand", 30, 12, "9% btw"],
    ],
    Rittenkaarten: [
      ["Naam", "Doelgroep", "Kaartprijs (€)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"],
    ],
    "Eigen tabblad": [
      ["Dit tabblad wordt niet geïmporteerd"],
      ["Geen aanbieding", "Onbekende doelgroep", "Onbekende betaalwijze", -1, "geen getal", "Onbekend btw-tarief"],
    ],
  }), "offers.xlsx", "subscriptions");

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows, [{
    name: "Maand",
    audience: "youth",
    productType: "subscription",
    paymentFrequency: "monthly",
    price: 30,
    installmentCount: null,
    durationMonths: 12,
    rideCount: null,
    validityMonths: null,
    vatRate: 9,
  }]);
});

test("subscription import rejects missing or changed column headers without returning rows", async () => {
  const result = await parseFinancialImport(await workbookBuffer({
    Abonnementen: [
      ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden"],
      ["Maand", "Jeugd", "Per maand", 30, 12, "9% btw"],
    ],
    Rittenkaarten: [
      ["Naam", "Doelgroep", "Andere kolom", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"],
      ["Kaart", "Jeugd", 100, 10, 6, "9% btw"],
    ],
  }), "offers.xlsx", "subscriptions");

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues, [
    {
      sheet: "Abonnementen",
      row: 1,
      message: "De kolommen moeten exact zijn: Naam, Doelgroep, Betaalwijze, Prijs per maand (€ incl. btw), Looptijd in maanden, Btw-tarief.",
    },
    {
      sheet: "Rittenkaarten",
      row: 1,
      message: "De kolommen moeten exact zijn: Naam, Doelgroep, Kaartprijs (€ incl. btw), Aantal ritten, Geldig in maanden (leeg = onbeperkt), Btw-tarief.",
    },
  ]);
});

test("subscription import reports all invalid cells without returning a partially valid import", async () => {
  const result = await parseFinancialImport(await workbookBuffer({
    abonnementen: [
      ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden", "Btw-tarief"],
      ["", "Onbekend", "Per maand", -1, "geen getal", "21% btw"],
    ],
    RITTENKAARTEN: [
      ["Naam", "Doelgroep", "Kaartprijs (€)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"],
      ["Kaart", "Jeugd", "Per ongeluk tekst", 10, -2, "9% btw"],
    ],
  }), "offers.xlsx", "subscriptions");

  assert.ok(result.issues.length >= 5);
  assert.ok(result.issues.some(issue => issue.column === "Naam"));
  assert.ok(result.issues.some(issue => issue.column === "Doelgroep"));
  assert.ok(result.issues.some(issue => issue.column === "Prijs per maand (€ incl. btw)"));
  assert.ok(result.issues.some(issue => issue.column === "Looptijd in maanden"));
  assert.ok(result.issues.some(issue => issue.column === "Kaartprijs (€ incl. btw)"));
  assert.deepEqual(result.rows, []);
});

test("subscription import converts monthly Excel prices to the existing form semantics", async () => {
  const result = await parseFinancialImport(await workbookBuffer({
    Abonnementen: [
      ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden", "Btw-tarief"],
      ["Maand", "Jeugd", "Per maand", 30, 12, "9% btw"],
      ["Vier weken", "Jeugd", "Per 4 weken", 65, 12, "9% btw"],
      ["Kwartaal", "Volwassen", "Per kwartaal", 30, 12, "21% btw"],
      ["Halfjaar", "Volwassen", "Per halfjaar", 30, 12, "21% btw"],
      ["Jaar", "Volwassen", "Per jaar", 30, 12, "21% btw"],
      ["Termijnen", "Jeugd", "In termijnen", 30, 12, "9% btw"],
    ],
    Rittenkaarten: [
      ["Naam", "Doelgroep", "Kaartprijs (€)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"],
    ],
  }), "offers.xlsx", "subscriptions");

  assert.deepEqual(result.issues, []);
  assert.deepEqual((result.rows as SubscriptionImportRow[]).map(row => ({
    name: row.name,
    price: row.price,
    installmentCount: row.installmentCount,
  })), [
    { name: "Maand", price: 30, installmentCount: null },
    { name: "Vier weken", price: 60, installmentCount: null },
    { name: "Kwartaal", price: 90, installmentCount: null },
    { name: "Halfjaar", price: 180, installmentCount: null },
    { name: "Jaar", price: 360, installmentCount: null },
    { name: "Termijnen", price: 360, installmentCount: 12 },
  ]);
});

for (const missingSheet of ["Abonnementen", "Rittenkaarten"] as const) {
  test(`subscription import rejects a workbook without the ${missingSheet} sheet`, async () => {
    const sheets = missingSheet === "Abonnementen"
      ? {
          Rittenkaarten: [
            ["Naam", "Doelgroep", "Kaartprijs (€)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"],
          ],
        }
      : {
          Abonnementen: [
            ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden", "Btw-tarief"],
          ],
        };
    const result = await parseFinancialImport(
      await workbookBuffer(sheets),
      "offers.xlsx",
      "subscriptions",
    );

    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.issues, [{
      sheet: missingSheet,
      message: "Het verplichte tabblad ontbreekt.",
    }]);
  });
}

test("teacher import rejects a completely empty workbook with the missing worksheet issue", async () => {
  const result = await parseFinancialImport(
    await workbookBuffer({}),
    "empty.xlsx",
    "teachers",
  );

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues, [{
    sheet: "Docenten",
    message: "Het verplichte tabblad ontbreekt.",
  }]);
});

test("subscription import rejects a completely empty workbook with both missing worksheet issues", async () => {
  const result = await parseFinancialImport(
    await workbookBuffer({}),
    "empty.xlsx",
    "subscriptions",
  );

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues, [
    { sheet: "Abonnementen", message: "Het verplichte tabblad ontbreekt." },
    { sheet: "Rittenkaarten", message: "Het verplichte tabblad ontbreekt." },
  ]);
});

const scheduleContext: ScheduleImportContext = {
  participantId: 7,
  seasonId: 22,
  seasonName: "2026/2027",
  templateVersion: SCHEDULE_TEMPLATE_VERSION,
  masterDataVersion: "2026-08-01T00:00:00.000Z",
  startDate: "2026-09-01",
  endDate: "2027-06-30",
  teachers: [
    { id: 4, name: "Nina" },
    { id: 9, name: "Nina" },
  ],
  locations: [
    { id: 11, name: "Studio" },
    { id: 12, name: "Studio" },
  ],
};

test("schedule template has instructions, hidden metadata, stable duplicate-name choices, and validations", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildScheduleImportTemplate(scheduleContext) as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Instructies", "Rooster", "Keuzes", SCHEDULE_METADATA_SHEET]);
  assert.equal(workbook.getWorksheet("Keuzes")?.state, "hidden");
  assert.equal(workbook.getWorksheet(SCHEDULE_METADATA_SHEET)?.state, "veryHidden");
  const headerValues = workbook.getWorksheet("Rooster")?.getRow(1).values;
  assert.deepEqual(Array.isArray(headerValues) ? headerValues.slice(1) : [], SCHEDULE_HEADERS);
  assert.equal(workbook.getWorksheet("Rooster")?.getRow(2).getCell(2).value, "Geen (Zelf)");
  assert.equal(workbook.getWorksheet("Keuzes")?.getCell("A3").value, "Nina (docent 4)");
  assert.equal(workbook.getWorksheet("Keuzes")?.getCell("A4").value, "Nina (docent 9)");
  assert.equal(workbook.getWorksheet("Keuzes")?.getCell("B2").value, "Studio (locatie 11)");
  assert.equal(workbook.getWorksheet("Keuzes")?.getCell("B3").value, "Studio (locatie 12)");
  assert.match(String(workbook.getWorksheet(SCHEDULE_METADATA_SHEET)?.getCell("A1").value), /"seasonId":22/);
  assert.ok((workbook.getWorksheet("Rooster") as unknown as { dataValidations?: unknown }).dataValidations);
});

test("schedule import maps stable duplicate identities and normalizes Excel dates and times", async () => {
  const template = await buildScheduleImportTemplate(scheduleContext);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet("Rooster")!;
  ["Hiphop 12+", "Nina (docent 9)", "Studio (locatie 12)", "Dinsdag", 18 / 24 + 30 / (24 * 60), 75, 45901, new Date("2027-06-30T00:00:00.000Z")]
    .forEach((value, index) => { sheet.getRow(2).getCell(index + 1).value = value; });
  const result = await parseScheduleImport(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "rooster.xlsx",
    scheduleContext,
  );

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows, [{
    name: "Hiphop 12+",
    teacherId: 9,
    teacherLabel: "Nina (docent 9)",
    locationId: 12,
    locationLabel: "Studio (locatie 12)",
    weekday: 2,
    weekdayLabel: "Dinsdag",
    startTime: "18:30",
    durationMinutes: 75,
    activeFrom: "2025-09-01",
    activeUntil: "2027-06-30",
  }]);
});

test("schedule import ignores invalid user worksheets and returns only metadata issues", async () => {
  const template = await buildScheduleImportTemplate(scheduleContext);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  workbook.addWorksheet("Eigen instructies").addRows([
    ["Geen geldig rooster", "Onbekende docent", "Onbekende locatie", "Geen dag", "geen tijd", -1, "geen datum", "geen datum"],
  ]);
  const sheet = workbook.getWorksheet("Rooster")!;
  ["Hiphop 12+", "Nina (docent 9)", "Studio (locatie 12)", "Dinsdag", "18:30", 75, "2025-09-01", "2027-06-30"]
    .forEach((value, index) => { sheet.getRow(2).getCell(index + 1).value = value; });

  const result = await parseScheduleImport(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "rooster.xlsx",
    { ...scheduleContext, masterDataVersion: "2026-08-02T00:00:00.000Z" },
  );

  assert.deepEqual(result.rows, [{
    name: "Hiphop 12+",
    teacherId: 9,
    teacherLabel: "Nina (docent 9)",
    locationId: 12,
    locationLabel: "Studio (locatie 12)",
    weekday: 2,
    weekdayLabel: "Dinsdag",
    startTime: "18:30",
    durationMinutes: 75,
    activeFrom: "2025-09-01",
    activeUntil: "2027-06-30",
  }]);
  assert.deepEqual(result.issues, [{
    sheet: SCHEDULE_METADATA_SHEET,
    row: 1,
    column: "A",
    message: "De stamgegevens zijn gewijzigd sinds dit sjabloon is gedownload. Download een nieuw sjabloon.",
  }]);
});

test("schedule import reports metadata and every invalid cell while rejecting an empty roster", async () => {
  const template = await buildScheduleImportTemplate(scheduleContext);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet("Rooster")!;
  ["", "Onbekende docent", "Onbekende locatie", "Geen dag", "geen tijd", -1, "geen datum", "2026-01-01"]
    .forEach((value, index) => { sheet.getRow(2).getCell(index + 1).value = value; });
  sheet.addRow(["Tweede fout", "Geen (Zelf)", "Onbekende locatie", "Ook geen dag", "25:99", "fout", "2026-02-31", "2026-01-01"]);
  const result = await parseScheduleImport(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "rooster.xlsx",
    { ...scheduleContext, masterDataVersion: "2026-08-02T00:00:00.000Z" },
  );

  assert.ok(result.issues.length >= 9);
  assert.ok(result.issues.every(issue => issue.sheet === "Rooster" || issue.sheet === SCHEDULE_METADATA_SHEET));
  assert.ok(result.issues.some(issue => issue.sheet === SCHEDULE_METADATA_SHEET));
  assert.ok(result.issues.some(issue => issue.row === 2 && issue.column === "Naam les"));
  assert.ok(result.issues.some(issue => issue.row === 2 && issue.column === "Starttijd"));
  assert.ok(result.issues.some(issue => issue.row === 3 && issue.column === "Locatie"));
  assert.deepEqual(result.rows, []);

  const emptyWorkbook = new ExcelJS.Workbook();
  await emptyWorkbook.xlsx.load(template as unknown as Parameters<typeof emptyWorkbook.xlsx.load>[0]);
  for (let index = 1; index <= SCHEDULE_HEADERS.length; index += 1) emptyWorkbook.getWorksheet("Rooster")!.getRow(2).getCell(index).value = "";
  const empty = await parseScheduleImport(Buffer.from(await emptyWorkbook.xlsx.writeBuffer()), "rooster.xlsx", scheduleContext);
  assert.ok(empty.issues.some(issue => issue.message.includes("geen lessen")));
});