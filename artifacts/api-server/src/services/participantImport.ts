import ExcelJS from "exceljs";
import { canonicalParticipantEmail } from "./participantAccess.ts";
import {
  validateParticipantImportRows,
  type ParticipantImportIssue,
  type ParticipantImportSourceRow,
} from "./participantImportValidation.ts";

export const PARTICIPANT_IMPORT_HEADERS = [
  "Dansschool",
  "Contactpersoon",
  "E-mailadres",
  "Land",
] as const;

export type ParsedParticipantImportRow = ParticipantImportSourceRow & {
  contactName: string;
  email: string;
  country: string;
};

export type ParticipantImportPreview = {
  valid: boolean;
  rows: ParsedParticipantImportRow[];
  issues: ParticipantImportIssue[];
};

function issue(row: ParsedParticipantImportRow, column: string, message: string): ParticipantImportIssue {
  const participant = row.schoolName.trim() || row.contactName.trim() || `rij ${row.row}`;
  return {
    row: row.row,
    column,
    participant,
    message: `Rij ${row.row} (${participant}): ${message}`,
  };
}

export async function parseParticipantImport(buffer: Buffer): Promise<ParticipantImportPreview> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return {
      valid: false,
      rows: [],
      issues: [{
        row: 1,
        column: "Bestand",
        participant: "bestand",
        message: "Het bestand is geen geldig Excelbestand.",
      }],
    };
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return {
      valid: false,
      rows: [],
      issues: [{
        row: 1,
        column: "Bestand",
        participant: "bestand",
        message: "Het Excelbestand bevat geen werkblad.",
      }],
    };
  }

  const headerValues = PARTICIPANT_IMPORT_HEADERS.map((_, index) => worksheet.getCell(1, index + 1).text.trim());
  const headerIssues = PARTICIPANT_IMPORT_HEADERS.flatMap((header, index): ParticipantImportIssue[] =>
    headerValues[index] === header ? [] : [{
      row: 1,
      column: header,
      participant: "kolomkoppen",
      message: `Kolom ${index + 1} moet "${header}" heten.`,
    }]);

  const rows: ParsedParticipantImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = PARTICIPANT_IMPORT_HEADERS.map((_, index) => worksheet.getCell(rowNumber, index + 1).text.trim());
    if (values.every(value => value === "")) continue;
    rows.push({
      row: rowNumber,
      schoolName: values[0],
      contactName: values[1],
      email: values[2],
      country: values[3],
    });
  }

  const issues = [
    ...headerIssues,
    ...validateParticipantImportRows(rows).issues,
    ...rows.flatMap((row): ParticipantImportIssue[] => [
      ...(row.schoolName ? [] : [issue(row, "Dansschool", "vul een dansschool in.")]),
      ...(row.contactName ? [] : [issue(row, "Contactpersoon", "vul een contactpersoon in.")]),
      ...(row.country === "Nederland" || row.country === "België"
        ? []
        : [issue(row, "Land", 'kies "Nederland" of "België".')]),
    ]),
  ];

  const firstRowByEmail = new Map<string, ParsedParticipantImportRow>();
  for (const row of rows) {
    const email = canonicalParticipantEmail(row.email);
    if (!email) continue;
    const first = firstRowByEmail.get(email);
    if (first) {
      issues.push(issue(row, "E-mailadres", `dit e-mailadres staat ook op rij ${first.row}.`));
    } else {
      firstRowByEmail.set(email, row);
    }
  }

  if (rows.length === 0 && headerIssues.length === 0) {
    issues.push({
      row: 1,
      column: "Bestand",
      participant: "bestand",
      message: "Het Excelbestand bevat geen deelnemers.",
    });
  }

  return { valid: issues.length === 0, rows, issues };
}