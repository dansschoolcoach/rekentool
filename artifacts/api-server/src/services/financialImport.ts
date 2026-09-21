import ExcelJS from "exceljs";

export type ImportIssue = {
  sheet?: string;
  row?: number;
  column?: string;
  message: string;
};

export type TeacherImportRow = {
  name: string;
  hourlyRate: number;
  weeklyTravel: number;
};

export type SubscriptionImportRow = {
  name: string;
  audience: "youth" | "adult";
  productType: "subscription" | "punch_card";
  paymentFrequency: "monthly" | "four_weekly" | "quarterly" | "half_yearly" | "yearly" | "installments" | "one_time";
  price: number;
  installmentCount: number | null;
  durationMonths: number | null;
  rideCount: number | null;
  validityMonths: number | null;
  vatRate: number;
};

export const SCHEDULE_TEMPLATE_VERSION = "1";
export const SCHEDULE_HEADERS = ["Naam les", "Docent", "Locatie", "Dag", "Starttijd", "Duur (minuten)", "Actief vanaf", "Actief tot"];
export const WEEKDAY_LABELS = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"] as const;
export const SCHEDULE_METADATA_SHEET = "__ByBMetadata";

export type ScheduleImportOption = { id: number; name: string };
export type ScheduleImportRow = {
  name: string;
  teacherId: number | null;
  teacherLabel: string;
  locationId: number;
  locationLabel: string;
  weekday: number;
  weekdayLabel: string;
  startTime: string;
  durationMinutes: number;
  activeFrom: string;
  activeUntil: string;
};
export type ScheduleImportMetadata = {
  participantId: number;
  seasonId: number;
  seasonName: string;
  templateVersion: string;
  masterDataVersion: string;
};
export type ScheduleImportContext = ScheduleImportMetadata & {
  startDate: string;
  endDate: string;
  teachers: ScheduleImportOption[];
  locations: ScheduleImportOption[];
};

export type ParsedImport =
  | { kind: "teachers"; rows: TeacherImportRow[]; issues: ImportIssue[] }
  | { kind: "subscriptions"; rows: SubscriptionImportRow[]; issues: ImportIssue[] }
  | { kind: "schedule"; rows: ScheduleImportRow[]; issues: ImportIssue[]; metadata?: ScheduleImportMetadata };

const TEACHER_HEADERS = ["Naam docent", "Uurtarief (€ incl. btw indien van toepassing)", "Reiskosten per week (€ incl. btw)"];
const LEGACY_TEACHER_HEADERS = ["Naam docent", "Uurtarief (€)", "Reiskosten per week (€)"];
const SUBSCRIPTION_HEADERS = ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€ incl. btw)", "Looptijd in maanden", "Btw-tarief"];
const LEGACY_SUBSCRIPTION_HEADERS = ["Naam", "Doelgroep", "Betaalwijze", "Prijs per maand (€)", "Looptijd in maanden", "Btw-tarief"];
const PUNCH_CARD_HEADERS = ["Naam", "Doelgroep", "Kaartprijs (€ incl. btw)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"];
const LEGACY_PUNCH_CARD_HEADERS = ["Naam", "Doelgroep", "Kaartprijs (€)", "Aantal ritten", "Geldig in maanden (leeg = onbeperkt)", "Btw-tarief"];
const PAYMENT_FREQUENCIES: Record<string, SubscriptionImportRow["paymentFrequency"]> = {
  "Per maand": "monthly",
  "Per 4 weken": "four_weekly",
  "Per kwartaal": "quarterly",
  "Per halfjaar": "half_yearly",
  "Per jaar": "yearly",
  "In termijnen": "installments",
};
const VAT_RATES: Record<string, number> = { "0% btw": 0, "9% btw": 9, "21% btw": 21 };

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sheetByName(workbook: ExcelJS.Workbook, expected: string): ExcelJS.Worksheet | undefined {
  const normalized = expected.trim().toLocaleLowerCase();
  return workbook.worksheets.find(candidate => candidate.name.trim().toLocaleLowerCase() === normalized);
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && "result" in value) return value.result;
  if (value && typeof value === "object" && "richText" in value) return value.richText.map(part => part.text).join("");
  return value;
}

function scheduleOptionLabel(name: string, id: number, kind: "docent" | "locatie") {
  return `${name} (${kind} ${id})`;
}

function dateFromExcel(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 2958465) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    const date = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : null;
  }
  const parts = candidate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!parts) return null;
  const normalized = `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
}

function timeFromExcel(value: unknown): string | null {
  let hours: number;
  let minutes: number;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    hours = value.getUTCHours();
    minutes = value.getUTCMinutes();
  } else if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    hours = Math.floor(totalMinutes / 60);
    minutes = totalMinutes % 60;
  } else if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match || Number(match[3] ?? 0) !== 0) return null;
    hours = Number(match[1]);
    minutes = Number(match[2]);
  } else {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function scheduleMetadataFromSheet(workbook: ExcelJS.Workbook, issues: ImportIssue[]): ScheduleImportMetadata | null {
  const sheet = sheetByName(workbook, SCHEDULE_METADATA_SHEET);
  if (!sheet) {
    issues.push({ sheet: SCHEDULE_METADATA_SHEET, message: "De controlemetadata ontbreekt." });
    return null;
  }
  try {
    const raw = cellValue(sheet.getCell("A1").value);
    const metadata = JSON.parse(String(raw ?? "")) as Partial<ScheduleImportMetadata>;
    if (
      !Number.isSafeInteger(metadata.participantId)
      || !Number.isSafeInteger(metadata.seasonId)
      || typeof metadata.seasonName !== "string"
      || typeof metadata.templateVersion !== "string"
      || typeof metadata.masterDataVersion !== "string"
    ) throw new Error("invalid");
    return metadata as ScheduleImportMetadata;
  } catch {
    issues.push({ sheet: SCHEDULE_METADATA_SHEET, row: 1, column: "A", message: "De controlemetadata is ongeldig." });
    return null;
  }
}

export async function buildScheduleImportTemplate(context: ScheduleImportContext): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ByB";
  workbook.created = new Date();

  const instructions = workbook.addWorksheet("Instructies");
  instructions.columns = [{ width: 28 }, { width: 100 }];
  instructions.addRows([
    ["ByB roosterimport", ""],
    ["Deelnemer", context.seasonName ? `${context.participantId} · ${context.seasonName}` : String(context.participantId)],
    ["Seizoen", context.seasonName],
    ["Gebruik", "Vul alleen het tabblad Rooster in. Elke ingevulde rij wordt een les; volledig lege rijen worden genegeerd."],
    ["Verwijderen", "Laat de grijze voorbeeldrij staan als voorbeeld maar verwijder deze voordat je het bestand terugstuurt."],
    ["Docent", "Kies een actuele docent of Geen (Zelf). De tekst tussen haakjes is de vaste herkenning van het record."],
    ["Locatie", "Kies een actuele locatie. Een locatie is verplicht voor iedere les."],
    ["Datums en tijden", "Gebruik Excel-datums en -tijden of de tekstnotaties JJJJ-MM-DD, DD-MM-JJJJ en UU:MM."],
    ["Waarschuwing", "Een bevestiging vervangt het volledige rooster van dit seizoen. Een leeg rooster wordt niet ongemerkt opgeslagen."],
  ]);
  instructions.getRow(1).font = { bold: true, size: 16, color: { argb: "FF17324D" } };
  instructions.getColumn(1).font = { bold: true, color: { argb: "FF17324D" } };
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  instructions.eachRow(row => { row.height = 28; });

  const schedule = workbook.addWorksheet("Rooster");
  schedule.columns = [
    { width: 28 }, { width: 30 }, { width: 30 }, { width: 18 },
    { width: 15 }, { width: 18 }, { width: 16 }, { width: 16 },
  ];
  schedule.addRow(SCHEDULE_HEADERS);
  const firstLocation = context.locations[0];
  schedule.addRow([
    "Voorbeeldles",
    "Geen (Zelf)",
    scheduleOptionLabel(firstLocation.name, firstLocation.id, "locatie"),
    "Maandag",
    "18:00",
    60,
    context.startDate,
    context.endDate,
  ]);
  schedule.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  schedule.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  schedule.getRow(2).font = { italic: true, color: { argb: "FF777777" } };
  schedule.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  schedule.getRow(2).eachCell(cell => { cell.protection = { locked: false }; });
  schedule.views = [{ state: "frozen", ySplit: 1 }];
  schedule.autoFilter = "A1:H1";

  const choices = workbook.addWorksheet("Keuzes");
  choices.columns = [{ width: 36 }, { width: 36 }, { width: 20 }];
  choices.addRow(["Docenten", "Locaties", "Dagen"]);
  choices.addRow(["Geen (Zelf)", firstLocation ? scheduleOptionLabel(firstLocation.name, firstLocation.id, "locatie") : "", WEEKDAY_LABELS[0]]);
  context.teachers.forEach((teacher, index) => choices.getCell(index + 3, 1).value = scheduleOptionLabel(teacher.name, teacher.id, "docent"));
  context.locations.slice(1).forEach((location, index) => choices.getCell(index + 3, 2).value = scheduleOptionLabel(location.name, location.id, "locatie"));
  WEEKDAY_LABELS.slice(1).forEach((day, index) => choices.getCell(index + 3, 3).value = day);
  choices.getRow(1).font = { bold: true };
  choices.state = "hidden";

  const metadata = workbook.addWorksheet(SCHEDULE_METADATA_SHEET);
  metadata.getCell("A1").value = JSON.stringify({
    participantId: context.participantId,
    seasonId: context.seasonId,
    seasonName: context.seasonName,
    templateVersion: context.templateVersion,
    masterDataVersion: context.masterDataVersion,
  } satisfies ScheduleImportMetadata);
  metadata.state = "veryHidden";

  const validations = (schedule as unknown as { dataValidations: { add: (range: string, validation: Record<string, unknown>) => void } }).dataValidations;
  validations.add("B2:B1000", {
    type: "list",
    allowBlank: true,
    formulae: ["=Keuzes!$A$2:$A$1000"],
    showErrorMessage: true,
    errorTitle: "Kies een docent",
    error: "Gebruik een keuze uit de actuele docentenlijst of Geen (Zelf).",
  });
  validations.add("C2:C1000", {
    type: "list",
    allowBlank: false,
    formulae: ["=Keuzes!$B$2:$B$1000"],
    showErrorMessage: true,
    errorTitle: "Kies een locatie",
    error: "Gebruik een keuze uit de actuele locatielijst.",
  });
  validations.add("D2:D1000", {
    type: "list",
    allowBlank: false,
    formulae: ["=Keuzes!$C$2:$C$8"],
    showErrorMessage: true,
    errorTitle: "Kies een dag",
    error: "Gebruik een dag uit de keuzelijst.",
  });
  validations.add("E2:E1000", {
    type: "time",
    allowBlank: false,
    formulae: [0, 1],
    showErrorMessage: true,
    errorTitle: "Kies een tijd",
    error: "Gebruik een geldige tijd.",
  });
  validations.add("F2:F1000", {
    type: "whole",
    operator: "greaterThan",
    allowBlank: false,
    formulae: [0],
    showErrorMessage: true,
    errorTitle: "Vul minuten in",
    error: "De duur moet een positief geheel getal zijn.",
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function sheetRows(sheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  for (let index = 1; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const values: unknown[] = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) values.push(cellValue(row.getCell(column).value));
    rows.push(values);
  }
  return rows;
}

function rowsForSheet(workbook: ExcelJS.Workbook, sheetName: string) {
  const sheet = sheetByName(workbook, sheetName);
  if (!sheet) return { sheet: undefined, rows: [] as unknown[][] };
  return { sheet, rows: sheetRows(sheet) };
}

function validateHeaders(
  sheetName: string,
  rows: unknown[][],
  expected: string[],
  issues: ImportIssue[],
  compatibleHeaders: string[][] = [],
): boolean {
  const headers = rows[0] ?? [];
  const matches = (candidate: string[]) =>
    headers.length === candidate.length && candidate.every((header, index) => headers[index] === header);
  if (!matches(expected) && !compatibleHeaders.some(matches)) {
    issues.push({
      sheet: sheetName,
      row: 1,
      message: `De kolommen moeten exact zijn: ${expected.join(", ")}.`,
    });
    return false;
  }
  return true;
}

function requiredNumber(
  value: unknown,
  sheet: string,
  row: number,
  column: string,
  issues: ImportIssue[],
  integer = false,
): number | null {
  const result = numberValue(value);
  if (result == null) {
    issues.push({ sheet, row, column, message: "moet een getal zijn." });
    return null;
  }
  if (result < 0 || (integer && !Number.isInteger(result))) {
    issues.push({ sheet, row, column, message: integer ? "moet een geheel getal van 0 of hoger zijn." : "mag niet negatief zijn." });
    return null;
  }
  return result;
}

function positiveInteger(
  value: unknown,
  sheet: string,
  row: number,
  column: string,
  issues: ImportIssue[],
): number | null {
  const result = requiredNumber(value, sheet, row, column, issues, true);
  if (result === 0) {
    issues.push({ sheet, row, column, message: "moet groter zijn dan 0." });
    return null;
  }
  return result;
}

function optionalPositiveInteger(
  value: unknown,
  sheet: string,
  row: number,
  column: string,
  issues: ImportIssue[],
): number | null {
  if (isEmpty(value)) return null;
  return positiveInteger(value, sheet, row, column, issues);
}

function formPriceFromMonthlyPrice(
  monthlyPrice: number,
  payment: Exclude<SubscriptionImportRow["paymentFrequency"], "one_time">,
  durationMonths: number,
) {
  switch (payment) {
    case "monthly": return monthlyPrice;
    case "four_weekly": return monthlyPrice * 12 / 13;
    case "quarterly": return monthlyPrice * 3;
    case "half_yearly": return monthlyPrice * 6;
    case "yearly": return monthlyPrice * 12;
    case "installments": return monthlyPrice * durationMonths;
  }
}

export async function parseFinancialImport(buffer: Buffer, filename: string, kind: "teachers" | "subscriptions"): Promise<ParsedImport> {
  const issues: ImportIssue[] = [];
  if (!filename.toLocaleLowerCase().endsWith(".xlsx")) {
    return { kind, rows: [], issues: [{ message: "Het bestand moet een .xlsx-bestand zijn." }] };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { kind, rows: [], issues: [{ message: "Het .xlsx-bestand kan niet worden gelezen." }] };
  }

  if (kind === "teachers") {
    const sheet = sheetByName(workbook, "docenten");
    const sheetName = sheet?.name;
    if (!sheetName) return { kind, rows: [], issues: [{ sheet: "Docenten", message: "Het verplichte tabblad ontbreekt." }] };
    const rows = sheetRows(sheet);
    if (!validateHeaders(sheetName, rows, TEACHER_HEADERS, issues, [LEGACY_TEACHER_HEADERS])) {
      return { kind, rows: [], issues };
    }
    const result: TeacherImportRow[] = [];
    rows.slice(1).forEach((values, offset) => {
      const row = offset + 2;
      if (values.every(isEmpty)) return;
      const name = text(values[0]);
      if (!name) issues.push({ sheet: sheetName, row, column: TEACHER_HEADERS[0], message: "mag niet leeg zijn." });
      const hourlyRate = requiredNumber(values[1], sheetName, row, TEACHER_HEADERS[1], issues);
      const weeklyTravel = requiredNumber(values[2], sheetName, row, TEACHER_HEADERS[2], issues);
      if (name && hourlyRate != null && weeklyTravel != null) result.push({ name, hourlyRate, weeklyTravel });
    });
    return { kind, rows: result, issues };
  }

  const parsedRows: SubscriptionImportRow[] = [];
  let headersValid = true;
  for (const [sheetName, expectedHeaders, productType] of [
    ["Abonnementen", SUBSCRIPTION_HEADERS, "subscription"],
    ["Rittenkaarten", PUNCH_CARD_HEADERS, "punch_card"],
  ] as const) {
    const source = rowsForSheet(workbook, sheetName);
    if (!source.sheet) {
      issues.push({ sheet: sheetName, message: "Het verplichte tabblad ontbreekt." });
      continue;
    }
    const actualName = source.sheet.name;
    const sheetHeadersValid = validateHeaders(
      actualName,
      source.rows,
      expectedHeaders,
      issues,
      [productType === "subscription" ? LEGACY_SUBSCRIPTION_HEADERS : LEGACY_PUNCH_CARD_HEADERS],
    );
    headersValid = headersValid && sheetHeadersValid;
    if (!sheetHeadersValid) continue;
    source.rows.slice(1).forEach((values, offset) => {
      const row = offset + 2;
      if (values.every(isEmpty)) return;
      const name = text(values[0]);
      if (!name) issues.push({ sheet: actualName, row, column: expectedHeaders[0], message: "mag niet leeg zijn." });
      const audienceValue = text(values[1]);
      const audience = audienceValue === "Jeugd" ? "youth" : audienceValue === "Volwassen" ? "adult" : null;
      if (!audience) issues.push({ sheet: actualName, row, column: expectedHeaders[1], message: 'moet exact "Jeugd" of "Volwassen" zijn.' });
      if (productType === "subscription") {
        const payment = PAYMENT_FREQUENCIES[text(values[2])];
        if (!payment) issues.push({ sheet: actualName, row, column: expectedHeaders[2], message: "bevat een onbekende betaalwijze." });
        const price = requiredNumber(values[3], actualName, row, expectedHeaders[3], issues);
        const duration = positiveInteger(values[4], actualName, row, expectedHeaders[4], issues);
        const vat = VAT_RATES[text(values[5])];
        if (vat == null) issues.push({ sheet: actualName, row, column: expectedHeaders[5], message: "bevat een onbekend btw-tarief." });
        if (name && audience && payment && payment !== "one_time" && price != null && duration != null && vat != null) {
          parsedRows.push({
            name,
            audience,
            productType,
            paymentFrequency: payment,
            // Excel always asks for a monthly price. The existing form stores
            // the price for the selected payment period (or the total contract
            // price for installments), so convert at this boundary.
            price: formPriceFromMonthlyPrice(price, payment, duration),
            // The supplied template has no separate installment-count column.
            // For "In termijnen", its duration is therefore also the number of
            // monthly installments, matching the existing form's required data.
            installmentCount: payment === "installments" ? duration : null,
            durationMonths: duration,
            rideCount: null,
            validityMonths: null,
            vatRate: vat,
          });
        }
      } else {
        const price = requiredNumber(values[2], actualName, row, expectedHeaders[2], issues);
        const count = positiveInteger(values[3], actualName, row, expectedHeaders[3], issues);
        const validity = optionalPositiveInteger(values[4], actualName, row, expectedHeaders[4], issues);
        const vat = VAT_RATES[text(values[5])];
        if (vat == null) issues.push({ sheet: actualName, row, column: expectedHeaders[5], message: "bevat een onbekend btw-tarief." });
        if (name && audience && price != null && count != null && vat != null) {
          parsedRows.push({ name, audience, productType, paymentFrequency: "one_time", price, installmentCount: null, durationMonths: null, rideCount: count, validityMonths: validity, vatRate: vat });
        }
      }
    });
  }
  return { kind, rows: headersValid ? parsedRows : [], issues };
}

export async function parseScheduleImport(
  buffer: Buffer,
  filename: string,
  expected: ScheduleImportContext,
): Promise<Extract<ParsedImport, { kind: "schedule" }>> {
  const issues: ImportIssue[] = [];
  if (!filename.toLocaleLowerCase().endsWith(".xlsx")) {
    return { kind: "schedule", rows: [], issues: [{ message: "Het bestand moet een .xlsx-bestand zijn." }] };
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { kind: "schedule", rows: [], issues: [{ message: "Het .xlsx-bestand kan niet worden gelezen." }] };
  }

  const metadata = scheduleMetadataFromSheet(workbook, issues);
  if (metadata) {
    if (metadata.templateVersion !== expected.templateVersion) issues.push({ sheet: SCHEDULE_METADATA_SHEET, row: 1, column: "A", message: "Dit sjabloon is niet meer ondersteund. Download een nieuw sjabloon." });
    if (metadata.participantId !== expected.participantId || metadata.seasonId !== expected.seasonId || metadata.seasonName !== expected.seasonName) {
      issues.push({ sheet: SCHEDULE_METADATA_SHEET, row: 1, column: "A", message: "Dit sjabloon hoort niet bij de geselecteerde deelnemer en het geselecteerde seizoen." });
    }
    if (metadata.masterDataVersion !== expected.masterDataVersion) {
      issues.push({ sheet: SCHEDULE_METADATA_SHEET, row: 1, column: "A", message: "De stamgegevens zijn gewijzigd sinds dit sjabloon is gedownload. Download een nieuw sjabloon." });
    }
  }

  const sheet = sheetByName(workbook, "Rooster");
  if (!sheet) {
    issues.push({ sheet: "Rooster", message: "Het verplichte tabblad ontbreekt." });
    return { kind: "schedule", rows: [], issues, metadata: metadata ?? undefined };
  }
  const rows = sheetRows(sheet);
  validateHeaders(sheet.name, rows, SCHEDULE_HEADERS, issues);
  const teacherByLabel = new Map<string, ScheduleImportOption>();
  expected.teachers.forEach(teacher => teacherByLabel.set(scheduleOptionLabel(teacher.name, teacher.id, "docent"), teacher));
  const locationByLabel = new Map<string, ScheduleImportOption>();
  expected.locations.forEach(location => locationByLabel.set(scheduleOptionLabel(location.name, location.id, "locatie"), location));
  const example = [
    "Voorbeeldles",
    "Geen (Zelf)",
    expected.locations[0] ? scheduleOptionLabel(expected.locations[0].name, expected.locations[0].id, "locatie") : "",
    "Maandag",
    "18:00",
    60,
    expected.startDate,
    expected.endDate,
  ];
  const result: ScheduleImportRow[] = [];
  rows.slice(1).forEach((values, offset) => {
    const row = offset + 2;
    if (values.every(isEmpty)) return;
    if (values.length === example.length && values.every((value, index) => text(value) === text(example[index]))) return;
    const name = text(values[0]);
    const teacherValue = text(values[1]);
    const locationValue = text(values[2]);
    const weekdayValue = text(values[3]);
    if (!name) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[0], message: "mag niet leeg zijn." });
    const teacher = teacherValue === "Geen (Zelf)" ? null : teacherByLabel.get(teacherValue);
    if (teacherValue && teacherValue !== "Geen (Zelf)" && !teacher) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[1], message: "bevat geen actuele docentkeuze." });
    const location = locationByLabel.get(locationValue);
    if (!location) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[2], message: "bevat geen actuele locatiekeuze." });
    const weekday = WEEKDAY_LABELS.indexOf(weekdayValue as typeof WEEKDAY_LABELS[number]);
    if (weekday < 0) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[3], message: "moet een geldige dag uit de keuzelijst zijn." });
    const startTime = timeFromExcel(values[4]);
    if (!startTime) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[4], message: "moet een geldige tijd zijn (bijvoorbeeld 18:00)." });
    const duration = requiredNumber(values[5], sheet.name, row, SCHEDULE_HEADERS[5], issues, true);
    if (duration === 0) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[5], message: "moet groter zijn dan 0." });
    const activeFrom = dateFromExcel(values[6]);
    if (!activeFrom) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[6], message: "moet een geldige datum zijn." });
    const activeUntil = dateFromExcel(values[7]);
    if (!activeUntil) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[7], message: "moet een geldige datum zijn." });
    if (activeFrom && activeUntil && activeFrom > activeUntil) issues.push({ sheet: sheet.name, row, column: SCHEDULE_HEADERS[7], message: "moet op of na de startdatum liggen." });
    if (name && (teacherValue === "Geen (Zelf)" || teacher) && location && weekday >= 0 && startTime && duration != null && duration > 0 && activeFrom && activeUntil && activeFrom <= activeUntil) {
      result.push({
        name,
        teacherId: teacher?.id ?? null,
        teacherLabel: teacher ? scheduleOptionLabel(teacher.name, teacher.id, "docent") : "Geen (Zelf)",
        locationId: location.id,
        locationLabel: scheduleOptionLabel(location.name, location.id, "locatie"),
        weekday,
        weekdayLabel: WEEKDAY_LABELS[weekday],
        startTime,
        durationMinutes: duration,
        activeFrom,
        activeUntil,
      });
    }
  });
  if (result.length === 0 && issues.length === 0) {
    issues.push({ sheet: sheet.name, message: "Het rooster bevat geen lessen. Laat het rooster niet ongemerkt leeg worden; voeg een les toe." });
  }
  return { kind: "schedule", rows: result, issues, metadata: metadata ?? undefined };
}

export function formatImportIssues(issues: ImportIssue[]): string[] {
  return issues.map(issue => {
    const location = [issue.sheet, issue.row == null ? undefined : `rij ${issue.row}`, issue.column].filter(Boolean).join(", ");
    return `${location ? `${location}: ` : ""}${issue.message}`;
  });
}