import { CircleAlert } from 'lucide-react';
import type { ParticipantRecoveryStatus } from '@workspace/api-client-react';

export function ParticipantRecoveryWarning({
  status,
  statusUnavailable = false,
}: {
  status?: ParticipantRecoveryStatus;
  statusUnavailable?: boolean;
}) {
  if (statusUnavailable) {
    return (
      <section
        className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"
        aria-live="polite"
        data-testid="participant-recovery-status-error"
      >
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div>
            <h2 className="font-semibold text-primary">Herstelstatus tijdelijk niet beschikbaar</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              De herstelcontrole kon niet worden uitgevoerd. De status wordt automatisch opnieuw gecontroleerd.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!status || status.overdueCount === 0) return null;
  return (
    <section
      className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5"
      aria-live="polite"
      data-testid="participant-recovery-warning"
    >
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div>
          <h2 className="font-semibold text-primary">
            {status.overdueCount} {status.overdueCount === 1 ? 'accountherstel wacht' : 'accountherstellen wachten'} te lang
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Controleer deze interne herstelrecords. De status wordt automatisch ververst.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-primary">
            {status.records.map((record) => (
              <li key={record.releaseId}>
                Herstelrecord {record.releaseId} · deelnemer {record.participantId} · {record.waitingMinutes} minuten wachtend
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}