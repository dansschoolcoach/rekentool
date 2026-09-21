import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getGetAdminFinancialFileSubmissionsQueryKey,
  getGetAdminFinancialSeasonQueryKey,
  getGetAdminFinancialSeasonsQueryKey,
  type FinancialSubscriptionImportPreview,
  type FinancialScheduleImportPreview,
  type FinancialTeacherImportPreview,
  type Participant,
  useConfirmAdminFinancialScheduleImport,
  useConfirmAdminFinancialSubscriptionsImport,
  useConfirmAdminFinancialTeachersImport,
  useGetAdminFinancialSeasons,
  useGetAdminFinancialFileSubmissions,
  usePreviewAdminFinancialScheduleImport,
  usePreviewAdminFinancialSubscriptionsImport,
  usePreviewAdminFinancialTeachersImport,
  useUpdateAdminFinancialFileSubmission,
} from "@workspace/api-client-react";

type ImportKind = "teachers" | "subscriptions" | "schedule";
type Preview = FinancialTeacherImportPreview | FinancialSubscriptionImportPreview | FinancialScheduleImportPreview;
type FlowState = { file: File | null; preview: Preview | null; error: string[]; success: string | null };

const emptyFlow = (): FlowState => ({ file: null, preview: null, error: [], success: null });
const paymentLabels: Record<string, string> = {
  monthly: "Per maand",
  four_weekly: "Per 4 weken",
  quarterly: "Per kwartaal",
  half_yearly: "Per halfjaar",
  yearly: "Per jaar",
  installments: "In termijnen",
  one_time: "Eenmalig",
};
const audienceLabels: Record<string, string> = { youth: "Jeugd", adult: "Volwassen" };
const submissionStatusLabels = { open: "Openstaand", in_progress: "In behandeling", processed: "Verwerkt" } as const;

function apiErrors(error: unknown): string[] {
  if (error instanceof ApiError && error.data && typeof error.data === "object" && "errors" in error.data) {
    const errors = (error.data as { errors?: unknown }).errors;
    if (Array.isArray(errors)) return errors.filter((item): item is string => typeof item === "string");
  }
  return [error instanceof Error ? error.message : "De preview kon niet worden gemaakt."];
}

function PreviewRows({ kind, preview }: { kind: ImportKind; preview: Preview }) {
  if (kind === "teachers") {
    const rows = (preview as FinancialTeacherImportPreview).rows;
    return (
      <div className="mt-5 overflow-x-auto rounded-lg border border-border/70">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-secondary/45 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Naam docent</th><th className="px-4 py-3">Uurtarief (€ incl. btw indien van toepassing)</th><th className="px-4 py-3">Reiskosten per week (€ incl. btw)</th></tr></thead>
          <tbody className="divide-y divide-border/60">{rows.map((row, index) => <tr key={`${row.name}-${index}`}><td className="px-4 py-3 font-semibold text-primary">{row.name}</td><td className="px-4 py-3">{row.hourlyRate.toFixed(2)}</td><td className="px-4 py-3">{row.weeklyTravel.toFixed(2)}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (kind === "schedule") {
    const rows = (preview as FinancialScheduleImportPreview).rows;
    return (
      <div className="mt-5 overflow-x-auto rounded-lg border border-border/70">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="bg-secondary/45 text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-4 py-3">Naam les</th><th className="px-4 py-3">Docent</th><th className="px-4 py-3">Locatie</th><th className="px-4 py-3">Dag</th><th className="px-4 py-3">Tijd</th><th className="px-4 py-3">Minuten</th><th className="px-4 py-3">Actief</th></tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row, index) => <tr key={`${row.name}-${row.locationId}-${index}`}>
              <td className="px-4 py-3 font-semibold text-primary">{row.name}</td>
              <td className="px-4 py-3">{row.teacherLabel}</td>
              <td className="px-4 py-3">{row.locationLabel}</td>
              <td className="px-4 py-3">{row.weekdayLabel}</td>
              <td className="px-4 py-3">{row.startTime}</td>
              <td className="px-4 py-3">{row.durationMinutes}</td>
              <td className="px-4 py-3">{row.activeFrom} – {row.activeUntil}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    );
  }
  const rows = (preview as FinancialSubscriptionImportPreview).rows;
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full min-w-[1100px] text-left text-sm">
        <thead className="bg-secondary/45 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Naam</th><th className="px-4 py-3">Doelgroep</th><th className="px-4 py-3">Soort</th><th className="px-4 py-3">Betaalwijze</th><th className="px-4 py-3">Prijs (€ incl. btw)</th><th className="px-4 py-3">Termijnen</th><th className="px-4 py-3">Looptijd (mnd)</th><th className="px-4 py-3">Ritten</th><th className="px-4 py-3">Geldig (mnd)</th><th className="px-4 py-3">Btw</th></tr></thead>
        <tbody className="divide-y divide-border/60">{rows.map((row, index) => <tr key={`${row.name}-${index}`}><td className="px-4 py-3 font-semibold text-primary">{row.name}</td><td className="px-4 py-3">{audienceLabels[row.audience]}</td><td className="px-4 py-3">{row.productType === "subscription" ? "Abonnement" : "Rittenkaart"}</td><td className="px-4 py-3">{paymentLabels[row.paymentFrequency]}</td><td className="px-4 py-3">{row.price.toFixed(2)}</td><td className="px-4 py-3">{row.installmentCount ?? "—"}</td><td className="px-4 py-3">{row.durationMonths ?? "—"}</td><td className="px-4 py-3">{row.rideCount ?? "—"}</td><td className="px-4 py-3">{row.validityMonths ?? "Onbeperkt"}</td><td className="px-4 py-3">{row.vatRate}%</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function AdminFinancialImports({ participants }: { participants: Participant[] }) {
  const queryClient = useQueryClient();
  const [participantId, setParticipantId] = useState<number | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [flows, setFlows] = useState<Record<ImportKind, FlowState>>({ teachers: emptyFlow(), subscriptions: emptyFlow(), schedule: emptyFlow() });
  const requestGeneration = useRef<Record<ImportKind, number>>({ teachers: 0, subscriptions: 0, schedule: 0 });
  const seasons = useGetAdminFinancialSeasons(participantId ?? 0, { query: { enabled: participantId != null, queryKey: getGetAdminFinancialSeasonsQueryKey(participantId ?? 0) } });
  const previewTeachers = usePreviewAdminFinancialTeachersImport();
  const previewSubscriptions = usePreviewAdminFinancialSubscriptionsImport();
  const previewSchedule = usePreviewAdminFinancialScheduleImport();
  const confirmTeachers = useConfirmAdminFinancialTeachersImport();
  const confirmSubscriptions = useConfirmAdminFinancialSubscriptionsImport();
  const confirmSchedule = useConfirmAdminFinancialScheduleImport();
  const submissions = useGetAdminFinancialFileSubmissions({
    query: { queryKey: getGetAdminFinancialFileSubmissionsQueryKey(), refetchInterval: 30_000 },
  });
  const updateSubmission = useUpdateAdminFinancialFileSubmission();
  const [submissionFilter, setSubmissionFilter] = useState<"open" | "all">("open");

  useEffect(() => {
    if (participantId == null) return;
    requestGeneration.current.teachers += 1;
    requestGeneration.current.subscriptions += 1;
    requestGeneration.current.schedule += 1;
    setSeasonId(null);
    setFlows({ teachers: emptyFlow(), subscriptions: emptyFlow(), schedule: emptyFlow() });
  }, [participantId]);

  function setFlow(kind: ImportKind, patch: Partial<FlowState>) {
    setFlows(current => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  }
  function preview(kind: ImportKind) {
    const flow = flows[kind];
    if (!flow.file || participantId == null || seasonId == null) return;
    const data = { file: flow.file };
    const generation = ++requestGeneration.current[kind];
    const requestParticipantId = participantId;
    const requestSeasonId = seasonId;
    const requestFile = flow.file;
    const mutation = kind === "teachers" ? previewTeachers : kind === "subscriptions" ? previewSubscriptions : previewSchedule;
    mutation.mutate({ participantId, seasonId, data } as never, {
      onSuccess: result => {
        if (
          requestGeneration.current[kind] !== generation
          || requestParticipantId !== participantId
          || requestSeasonId !== seasonId
          || flows[kind].file !== requestFile
        ) return;
        setFlow(kind, { preview: result, error: [], success: null });
      },
      onError: error => {
        if (
          requestGeneration.current[kind] !== generation
          || requestParticipantId !== participantId
          || requestSeasonId !== seasonId
          || flows[kind].file !== requestFile
        ) return;
        const data = error instanceof ApiError ? error.data : null;
        if (data && typeof data === "object" && "rows" in data && "existingCount" in data && "errors" in data) {
          setFlow(kind, { preview: data as Preview, error: [], success: null });
        } else {
          setFlow(kind, { preview: null, error: apiErrors(error), success: null });
        }
      },
    });
  }
  function confirm(kind: ImportKind) {
    const flow = flows[kind];
    if (!flow.preview || !participantId || !seasonId) return;
    const data = kind === "schedule"
      ? {
        expectedUpdatedAt: flow.preview.expectedUpdatedAt,
        participantId,
        seasonId,
        templateVersion: (flow.preview as FinancialScheduleImportPreview).metadata.templateVersion,
        masterDataVersion: (flow.preview as FinancialScheduleImportPreview).metadata.masterDataVersion,
        rows: (flow.preview as FinancialScheduleImportPreview).rows,
      }
      : { expectedUpdatedAt: flow.preview.expectedUpdatedAt, rows: flow.preview.rows };
    const mutation = kind === "teachers" ? confirmTeachers : kind === "subscriptions" ? confirmSubscriptions : confirmSchedule;
    mutation.mutate({ participantId, seasonId, data } as never, {
      onSuccess: result => {
        setFlow(kind, { preview: null, file: null, error: [], success: `${result.importedCount} records geïmporteerd.` });
        void queryClient.invalidateQueries({ queryKey: getGetAdminFinancialSeasonsQueryKey(participantId) });
        void queryClient.invalidateQueries({ queryKey: getGetAdminFinancialSeasonQueryKey(participantId, seasonId) });
      },
      onError: error => setFlow(kind, {
        ...(error instanceof ApiError && error.status === 409 ? { preview: null } : {}),
        error: apiErrors(error),
      }),
    });
  }
  function cancel(kind: ImportKind) {
    requestGeneration.current[kind] += 1;
    setFlow(kind, emptyFlow());
  }

  const selectedSeason = seasons.data?.find(season => season.id === seasonId);
  const selectedParticipant = participants.find(participant => participant.id === participantId);
  const visibleSubmissions = submissions.data?.filter(item => submissionFilter === "all" || item.status !== "processed");
  return (
    <>
    <section className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-7" data-testid="section-financial-submission-queue">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-accent-foreground">Veilige aanleveringen</p>
        <h2 className="serif mt-2 text-3xl text-primary">Wachtrij voor Ninny</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">Deze bestanden zijn alleen aangeleverd. Er is niets automatisch geïmporteerd of gewijzigd in de financiële gegevens.</p>
      </div>
      <label className="mt-5 inline-grid gap-2 text-sm font-semibold text-primary">
        Toon
        <select value={submissionFilter} onChange={event => setSubmissionFilter(event.target.value as "open" | "all")} className="h-10 rounded-lg border border-input bg-background px-3 font-normal" data-testid="select-submission-filter">
          <option value="open">Openstaande aanleveringen</option>
          <option value="all">Alle aanleveringen</option>
        </select>
      </label>
      {submissions.isLoading && <p className="mt-5 text-sm text-muted-foreground">Wachtrij laden…</p>}
      {submissions.isError && <p className="mt-5 text-sm text-destructive" role="alert">De wachtrij kon niet worden geladen.</p>}
      {updateSubmission.error && <p className="mt-5 text-sm text-destructive" role="alert">{apiErrors(updateSubmission.error).join(" ")}</p>}
      {submissions.data?.length === 0 && <p className="mt-5 rounded-lg border border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">Er zijn nog geen bestanden aangeleverd.</p>}
      {!!submissions.data?.length && visibleSubmissions?.length === 0 && <p className="mt-5 rounded-lg border border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">Er zijn geen openstaande aanleveringen.</p>}
      {!!visibleSubmissions?.length && (
        <div className="mt-5 overflow-x-auto rounded-lg border border-border/70">
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="bg-secondary/45 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">School</th><th className="px-4 py-3">Seizoen</th><th className="px-4 py-3">Bestandstype</th><th className="px-4 py-3">Aangeleverd</th><th className="px-4 py-3">Bestand</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Melding</th><th className="px-4 py-3">Laatste statuswijziging</th></tr></thead>
            <tbody className="divide-y divide-border/60">{visibleSubmissions.map(item => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-semibold text-primary">{item.schoolName}</td>
                <td className="px-4 py-3">{item.seasonName}</td>
                <td className="px-4 py-3">{item.fileType === 'teachers' ? 'Docenten' : 'Abonnementen & rittenkaarten'}</td>
                <td className="px-4 py-3">{new Date(item.submittedAt).toLocaleString('nl-NL')}</td>
                <td className="px-4 py-3"><a href={item.downloadUrl} className="font-semibold text-primary underline underline-offset-4">{item.filename}</a></td>
                <td className="px-4 py-3">
                  <select
                    value={item.status}
                    disabled={updateSubmission.isPending}
                    aria-label={`Status van ${item.filename}`}
                    onChange={event => updateSubmission.mutate({ submissionId: item.id, data: { status: event.target.value as typeof item.status } }, {
                      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetAdminFinancialFileSubmissionsQueryKey() }),
                    })}
                    className="h-10 rounded-lg border border-input bg-background px-3"
                  >
                    {Object.entries(submissionStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.notificationError
                    ? <span className="font-semibold text-destructive" role="status">Niet verstuurd: {item.notificationError}</span>
                    : item.notificationSentAt
                      ? <>Verstuurd<br />{new Date(item.notificationSentAt).toLocaleString("nl-NL")}</>
                      : item.notificationAttemptedAt
                        ? "Wordt verstuurd…"
                        : "Nog niet van toepassing"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.statusChangedAt && item.statusChangedBy
                    ? <><span className="font-semibold text-primary">{item.statusChangedBy}</span><br />{new Date(item.statusChangedAt).toLocaleString("nl-NL")}</>
                    : "Nog niet gewijzigd"}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
    <section className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-7" data-testid="section-financial-imports">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Stamgegevens importeren</p><h2 className="serif mt-2 text-3xl text-primary">Excel voor financiële stamgegevens</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Kies eerst de school en daarna een bestaand seizoen. Elke import is los van de andere en vervangt uitsluitend de gekozen lijst.</p></div>
      <div className="mt-6 grid gap-4 rounded-xl border border-border/60 bg-secondary/20 p-4 sm:grid-cols-2">
        <label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">School</span><select value={participantId ?? ""} onChange={event => setParticipantId(event.target.value ? Number(event.target.value) : null)} className="h-11 rounded-lg border border-input bg-background px-3 text-sm text-primary outline-none focus:border-accent" data-testid="select-import-school"><option value="">Kies een school</option>{participants.map(participant => <option key={participant.id} value={participant.id}>{participant.schoolName}</option>)}</select></label>
         <label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bestaand financieel seizoen</span><select value={seasonId ?? ""} disabled={participantId == null || seasons.isLoading} onChange={event => { requestGeneration.current.teachers += 1; requestGeneration.current.subscriptions += 1; requestGeneration.current.schedule += 1; setSeasonId(event.target.value ? Number(event.target.value) : null); setFlows({ teachers: emptyFlow(), subscriptions: emptyFlow(), schedule: emptyFlow() }); }} className="h-11 rounded-lg border border-input bg-background px-3 text-sm text-primary outline-none focus:border-accent disabled:opacity-50" data-testid="select-import-season"><option value="">{seasons.isLoading ? "Seizoenen laden…" : "Kies een seizoen"}</option>{seasons.data?.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
      </div>
      {seasons.isError && <p className="mt-3 text-sm text-destructive" role="alert">De seizoenen van deze school konden niet worden geladen.</p>}
       {selectedSeason && <div className="mt-6 grid gap-5 xl:grid-cols-3">{(["teachers", "subscriptions", "schedule"] as const).map(kind => <ImportCard key={kind} kind={kind} seasonName={selectedSeason.name} participantName={selectedParticipant?.schoolName ?? `deelnemer ${participantId}`} participantId={participantId!} seasonId={seasonId!} flow={flows[kind]} pendingPreview={kind === "teachers" ? previewTeachers.isPending : kind === "subscriptions" ? previewSubscriptions.isPending : previewSchedule.isPending} pendingConfirm={kind === "teachers" ? confirmTeachers.isPending : kind === "subscriptions" ? confirmSubscriptions.isPending : confirmSchedule.isPending} onFile={file => { requestGeneration.current[kind] += 1; setFlow(kind, { file, preview: null, error: [], success: null }); }} onPreview={() => preview(kind)} onConfirm={() => confirm(kind)} onCancel={() => cancel(kind)} />)}</div>}
    </section>
    </>
  );
}

function ImportCard({ kind, seasonName, participantName, participantId, seasonId, flow, pendingPreview, pendingConfirm, onFile, onPreview, onConfirm, onCancel }: { kind: ImportKind; seasonName: string; participantName: string; participantId: number; seasonId: number; flow: FlowState; pendingPreview: boolean; pendingConfirm: boolean; onFile: (file: File | null) => void; onPreview: () => void; onConfirm: () => void; onCancel: () => void }) {
  const title = kind === "teachers" ? "Docenten importeren" : kind === "subscriptions" ? "Abonnementen & rittenkaarten importeren" : "Rooster importeren";
  const templateUrl = `/api/admin/financial/participants/${participantId}/seasons/${seasonId}/imports/schedule/template`;
  const ready = Boolean(flow.preview?.valid);
  return <article className="rounded-xl border border-border/70 bg-background p-5" data-testid={`card-import-${kind}`}><h3 className="text-xl font-semibold text-primary">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Deelnemer: <strong>{participantName}</strong> (#{participantId}) · Seizoen: <strong>{seasonName}</strong></p>{kind === "schedule" && <a href={templateUrl} download className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-accent/60 bg-accent/5 px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/10" data-testid="download-template-schedule">Roostersjabloon downloaden</a>}<p className="mt-2 text-sm leading-6 text-muted-foreground">{kind === "schedule" ? "Download eerst het actuele sjabloon. Een seizoen zonder locatie kan geen roostersjabloon maken." : "Alleen .xlsx. Kies een bestand, bekijk de volledige preview en bevestig daarna de vervanging."}</p><label className="mt-5 grid gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Excel-bestand</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => onFile(event.target.files?.[0] ?? null)} className="block w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-primary file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground" data-testid={`input-file-${kind}`} /></label>
    {flow.file && !flow.preview && <button type="button" onClick={onPreview} disabled={pendingPreview} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid={`button-preview-${kind}`}>{pendingPreview ? "Bestand controleren…" : "Preview maken"}</button>}
    {flow.error.length > 0 && <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert"><p className="font-semibold">Los alle gevonden problemen op:</p><ul className="mt-2 list-disc space-y-1 pl-5">{flow.error.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></div>}
    {flow.success && <p className="mt-4 rounded-lg border border-[#557b5b]/30 bg-[#557b5b]/10 p-4 text-sm font-semibold text-[#557b5b]" role="status">{flow.success}</p>}
     {flow.preview && <><div className="mt-5 rounded-lg border border-accent/60 bg-accent/15 p-4 text-sm text-primary"><p className="font-bold">{kind === "schedule" ? "Let op: bevestigen vervangt het volledige rooster van dit seizoen." : "Let op: deze actie vervangt de volledige bestaande lijst."}</p><p className="mt-1">Nu aanwezig: <strong>{flow.preview.existingCount}</strong> · Nieuwe records: <strong>{flow.preview.newCount}</strong></p></div>{flow.preview.errors.length > 0 && <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"><ul className="list-disc space-y-1 pl-5">{flow.preview.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></div>}{ready && <PreviewRows kind={kind} preview={flow.preview} />}<div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" onClick={onCancel} className="inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold text-primary hover:bg-secondary" data-testid={`button-cancel-${kind}`}>Annuleren</button>{ready && <button type="button" onClick={onConfirm} disabled={pendingConfirm} className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50" data-testid={`button-confirm-${kind}`}>{pendingConfirm ? "Vervangen…" : "Ja, vervang de lijst"}</button>}</div></>}
  </article>;
}