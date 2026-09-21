import { useGetParticipants } from '@workspace/api-client-react';
import { Link, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { FinancienPage } from './FinancienPage';

/**
 * The admin route intentionally reuses the participant financial dashboard.
 * FinancienPage switches every financial hook to its participantId-scoped
 * admin counterpart when this prop is present.
 */
export function AdminFinancienPage() {
  const params = useParams();
  const participantId = Number(params.id);
  const participants = useGetParticipants();
  const participant = participants.data?.find(item => item.id === participantId);

  if (!Number.isInteger(participantId) || participantId <= 0) {
    return (
      <div className="page-in">
        <Link href="/beheer/financien" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ArrowLeft className="size-4" /> Terug naar financiën
        </Link>
        <p className="mt-8 text-destructive">Deze deelnemer kan niet worden gevonden.</p>
      </div>
    );
  }

  return (
    <FinancienPage
      adminParticipantId={participantId}
      adminParticipantName={participant?.schoolName}
      adminParticipantCountry={participant?.country}
    />
  );
}