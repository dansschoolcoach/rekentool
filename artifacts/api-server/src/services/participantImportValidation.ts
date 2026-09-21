export type ParticipantImportSourceRow = {
  row: number;
  schoolName: string;
  contactName?: string | null;
  email?: string | null;
};

export type ParticipantImportIssue = {
  row: number;
  column: string;
  participant: string;
  message: string;
};

export type ParticipantImportValidationResult<T extends ParticipantImportSourceRow> = {
  rows: T[];
  issues: ParticipantImportIssue[];
};

const USABLE_PARTICIPANT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUsableParticipantEmail(email: string): boolean {
  return USABLE_PARTICIPANT_EMAIL.test(email.trim());
}

function participantLabel(row: ParticipantImportSourceRow): string {
  const schoolName = row.schoolName.trim();
  const contactName = row.contactName?.trim();
  return schoolName || contactName || `rij ${row.row}`;
}

/**
 * Validates source rows before a bulk import reaches database persistence.
 * Rows are deliberately returned unchanged so validation cannot silently
 * remove or normalize otherwise valid import data.
 */
export function validateParticipantImportRows<T extends ParticipantImportSourceRow>(
  rows: T[],
): ParticipantImportValidationResult<T> {
  const issues = rows.flatMap((row): ParticipantImportIssue[] => {
    const participant = participantLabel(row);
    if (!row.email?.trim()) {
      return [{
        row: row.row,
        column: "E-mailadres",
        participant,
        message: `Rij ${row.row} (${participant}): vul een e-mailadres in.`,
      }];
    }
    if (isUsableParticipantEmail(row.email)) return [];

    return [{
      row: row.row,
      column: "E-mailadres",
      participant,
      message: `Rij ${row.row} (${participant}): vul een geldig e-mailadres in.`,
    }];
  });

  return { rows, issues };
}