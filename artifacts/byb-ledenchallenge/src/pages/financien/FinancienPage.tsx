import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
  useGetFinancialSeasons,
  useGetDashboard,
  useGetAdminFinancialSeasons,
  getGetAdminFinancialSeasonsQueryKey,
  getGetFinancialFileSubmissionsQueryKey,
  useCreateFinancialFileSubmission,
  useGetFinancialFileSubmissions,
  useRequestFinancialFileSubmissionUpload,
  useGetProfilePreferences,
  useUpdateProfilePreferences,
  getGetProfilePreferencesQueryKey,
  type FinancialSeason,
} from '@workspace/api-client-react';
import { SeasonEditor } from './SeasonEditor';
import { MonthView } from './MonthView';
import { ArrowLeft, ChartNoAxesCombined, CheckCircle2, Download, FilePenLine, FileSpreadsheet, PencilLine, Plus, ReceiptText, Send, Settings, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLocation } from 'wouter';
import { useAuth } from '@clerk/react';
import { getBlockedInternalNavigationTarget } from './unsavedFinancialNavigation';
import {
  FINANCIAL_HISTORY_EXIT_DELTA,
  financialHistoryGuardStates,
  isFinancialHistoryGuardBase,
  isFinancialHistoryGuardTop,
} from './financialHistoryGuard';
import { financialTemplateFilenames, getFinancialTemplateUrls } from './financialTemplateUrls';

function ActionButton({ children, variant = 'primary', onClick, disabled, testId }: any) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline: 'border border-primary/20 bg-transparent text-primary hover:bg-primary/5',
    gold: 'bg-accent text-accent-foreground hover:bg-accent/85',
  } as any;
  return (
    <button onClick={onClick} disabled={disabled} data-testid={testId} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]}`}>
      {children}
    </button>
  );
}

type FinancialQuery<T> = {
  data?: T;
  isLoading: boolean;
  isError: boolean;
};

type FinancienPageProps = {
  adminParticipantId?: number;
  adminParticipantName?: string;
  adminParticipantCountry?: string;
};

type MasterDataRoute = 'manual' | 'excel';

const financialTemplateUrls = getFinancialTemplateUrls(import.meta.env.BASE_URL);
const masterDataRouteStoragePrefix = 'byb:master-data-route:v1:participant:';

function getStoredMasterDataRoute(participantUserId?: string): MasterDataRoute {
  if (!participantUserId) return 'manual';
  try {
    const storedRoute = localStorage.getItem(`${masterDataRouteStoragePrefix}${participantUserId}`);
    return storedRoute === 'excel' ? 'excel' : 'manual';
  } catch {
    return 'manual';
  }
}

function getProfilePreferencesQueryKey(participantUserId?: string) {
  return [...getGetProfilePreferencesQueryKey(), participantUserId ?? 'anonymous'];
}

function localStorageHasMasterDataRoute(participantUserId: string) {
  try {
    return localStorage.getItem(`${masterDataRouteStoragePrefix}${participantUserId}`) !== null;
  } catch {
    return false;
  }
}

function storeMasterDataRoute(participantUserId: string, route: MasterDataRoute) {
  try {
    localStorage.setItem(`${masterDataRouteStoragePrefix}${participantUserId}`, route);
  } catch {
    // The route remains usable in memory when browser storage is unavailable.
  }
}

function ParticipantMasterDataChoice({
  route,
  onRouteChange,
  routeSyncFailed,
  routeSyncPending,
  onRetryRouteSync,
  seasonId,
  children,
}: {
  route: MasterDataRoute;
  onRouteChange: (route: MasterDataRoute) => void;
  routeSyncFailed: boolean;
  routeSyncPending: boolean;
  onRetryRouteSync: () => void;
  seasonId: number | null;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-7 rounded-xl border border-border/70 bg-secondary/30 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4" data-testid="participant-master-data-choice">
        <div className="px-2 py-1">
          <p className="text-sm font-semibold text-primary">Hoe wil je je stamgegevens invullen?</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Je kunt op ieder moment wisselen.</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-background p-1 sm:mt-0 sm:min-w-[330px]" role="group" aria-label="Manier van stamgegevens invullen">
          <button type="button" onClick={() => onRouteChange('manual')} aria-pressed={route === 'manual'} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${route === 'manual' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-primary hover:bg-secondary'}`} data-testid="choose-master-data-manual">
            <FilePenLine className="size-4" /> Handmatig
          </button>
          <button type="button" onClick={() => onRouteChange('excel')} aria-pressed={route === 'excel'} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${route === 'excel' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-primary hover:bg-secondary'}`} data-testid="choose-master-data-excel">
            <FileSpreadsheet className="size-4" /> Via Excel
          </button>
        </div>
      </div>
      {routeSyncFailed && (
        <div className="-mt-4 mb-7 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between" role="status">
          <p>Je keuze werkt op dit apparaat, maar kon niet worden gesynchroniseerd. Op een ander apparaat zie je mogelijk nog je vorige keuze.</p>
          <button
            type="button"
            onClick={onRetryRouteSync}
            disabled={routeSyncPending}
            className="shrink-0 font-semibold underline underline-offset-4 disabled:cursor-wait disabled:opacity-60"
          >
            {routeSyncPending ? 'Opnieuw proberen…' : 'Synchronisatie opnieuw proberen'}
          </button>
        </div>
      )}

      {route === 'excel' ? (
        <section className="space-y-6" data-testid="participant-master-data-excel">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-accent-foreground">Via Excel aanleveren</p>
          <h2 className="serif mt-2 text-3xl text-primary">Download, vul in en lever veilig aan</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            Download de sjablonen die je nodig hebt en vul ze in. Kies daarna hieronder je ingevulde bestanden en lever ze rechtstreeks bij Ninny aan. Je bestanden worden niet automatisch geïmporteerd; Ninny controleert en verwerkt ze voor je.
          </p>
          <p className="mt-3 max-w-3xl rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm leading-6 text-primary">
            De Excelroute is bedoeld voor je docenten en je abonnementen en rittenkaarten. Algemene gegevens, locaties, lessen en sluitingsdagen vul je handmatig in de webapp in.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <a href={financialTemplateUrls.teachers} download={financialTemplateFilenames.teachers} className="group flex min-h-28 items-start gap-4 rounded-xl border border-primary/15 bg-background p-5 transition-colors hover:border-accent hover:bg-accent/5" data-testid="download-template-teachers">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><FileSpreadsheet className="size-5" /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-primary">Docenten</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">Naam, uurtarief en reiskosten per week.</span>
              <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground"><Download className="size-4" /> Excel-sjabloon downloaden</span>
            </span>
          </a>
          <a href={financialTemplateUrls.subscriptions} download={financialTemplateFilenames.subscriptions} className="group flex min-h-28 items-start gap-4 rounded-xl border border-primary/15 bg-background p-5 transition-colors hover:border-accent hover:bg-accent/5" data-testid="download-template-subscriptions">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><FileSpreadsheet className="size-5" /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-primary">Abonnementen & rittenkaarten</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">Prijzen, betaalwijze, looptijd, doelgroep en btw.</span>
              <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground"><Download className="size-4" /> Excel-sjabloon downloaden</span>
            </span>
          </a>
        </div>
        {seasonId == null ? (
          <>
            <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm leading-6 text-primary" data-testid="excel-save-season-notice">
              De sjablonen kun je nu al downloaden. Sla hieronder eerst je seizoen op; daarna kun je de ingevulde bestanden hier direct aanleveren.
            </div>
            <div className="border-t border-border/70 pt-7" data-testid="participant-master-data-new-season">
              {children}
            </div>
          </>
        ) : (
          <FinancialFileSubmissionForm seasonId={seasonId} />
        )}
      </section>
      ) : (
        <div data-testid="participant-master-data-manual">{children}</div>
      )}
    </div>
  );
}

type SubmissionKind = 'teachers' | 'subscriptions';
const submissionLabels: Record<SubmissionKind, string> = {
  teachers: 'Docenten',
  subscriptions: 'Abonnementen & rittenkaarten',
};
const submissionStatusLabels = { open: 'Openstaand', in_progress: 'In behandeling', processed: 'Verwerkt' } as const;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function FinancialFileSubmissionForm({ seasonId }: { seasonId: number }) {
  const queryClient = useQueryClient();
  const requestUpload = useRequestFinancialFileSubmissionUpload();
  const confirmUpload = useCreateFinancialFileSubmission();
  const submissions = useGetFinancialFileSubmissions(seasonId);
  const [files, setFiles] = useState<Record<SubmissionKind, File | null>>({ teachers: null, subscriptions: null });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const pending = requestUpload.isPending || confirmUpload.isPending;

  function chooseFile(kind: SubmissionKind, file: File | null) {
    setError(null);
    setSuccess(null);
    if (file && (!file.name.toLocaleLowerCase().endsWith('.xlsx') || file.size > 10 * 1024 * 1024)) {
      setFiles(current => ({ ...current, [kind]: null }));
      setError('Kies alleen .xlsx-bestanden van maximaal 10 MB.');
      return;
    }
    setFiles(current => ({ ...current, [kind]: file }));
  }

  async function submit() {
    const selected = (Object.entries(files) as Array<[SubmissionKind, File | null]>).filter((entry): entry is [SubmissionKind, File] => entry[1] != null);
    if (selected.length === 0) return;
    setError(null);
    setSuccess(null);
    try {
      for (const [fileType, file] of selected) {
        const upload = await requestUpload.mutateAsync({
          seasonId,
          data: { fileType, filename: file.name, sizeBytes: file.size },
        });
        const uploadResponse = await fetch(upload.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': XLSX_TYPE },
          body: file,
        });
        if (!uploadResponse.ok) throw new Error('Het bestand kon niet veilig worden opgeslagen.');
        await confirmUpload.mutateAsync({
          seasonId,
          data: { fileType, filename: file.name, sizeBytes: file.size, objectPath: upload.objectPath },
        });
      }
      setFiles({ teachers: null, subscriptions: null });
      setSuccess(selected.length === 1 ? 'Je bestand staat veilig in de wachtrij voor Ninny.' : 'Je bestanden staan veilig in de wachtrij voor Ninny.');
      await queryClient.invalidateQueries({ queryKey: getGetFinancialFileSubmissionsQueryKey(seasonId) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Aanleveren is niet gelukt. Probeer het opnieuw.');
    }
  }

  return (
    <div className="rounded-xl border border-primary/15 bg-secondary/20 p-5 sm:p-6" data-testid="financial-file-submission-form">
      <h3 className="text-xl font-semibold text-primary">Ingevulde bestanden aanleveren</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Kies één of beide bestanden. Je ziet je keuze eerst terug voordat je verzendt.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {(Object.keys(submissionLabels) as SubmissionKind[]).map(kind => (
          <label key={kind} className="grid gap-2 rounded-lg border border-border/70 bg-background p-4">
            <span className="text-sm font-semibold text-primary">{submissionLabels[kind]}</span>
            <input
              key={files[kind]?.name ?? 'empty'}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending}
              onChange={event => chooseFile(kind, event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground"
              data-testid={`input-submit-${kind}`}
            />
            {files[kind] && (
              <span className="flex items-center justify-between gap-3 rounded-md bg-accent/10 px-3 py-2 text-sm text-primary">
                <span className="min-w-0 truncate"><FileSpreadsheet className="mr-2 inline size-4" />{files[kind]!.name}</span>
                <button type="button" onClick={() => chooseFile(kind, null)} disabled={pending} aria-label={`${submissionLabels[kind]} verwijderen`}><X className="size-4" /></button>
              </span>
            )}
          </label>
        ))}
      </div>
      {error && <p className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {success && <p className="mt-4 flex items-center gap-2 rounded-lg border border-[#557b5b]/30 bg-[#557b5b]/10 p-3 text-sm font-semibold text-[#557b5b]" role="status"><CheckCircle2 className="size-4" />{success}</p>}
      <button type="button" onClick={() => void submit()} disabled={pending || !files.teachers && !files.subscriptions} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-submit-financial-files">
        <Send className="size-4" /> {pending ? 'Veilig aanleveren…' : 'Aanleveren bij Ninny'}
      </button>
      <div className="mt-6 border-t border-border/70 pt-5">
        <h4 className="text-sm font-semibold text-primary">Eerder aangeleverd voor dit seizoen</h4>
        {submissions.isLoading && <p className="mt-2 text-sm text-muted-foreground">Aanleveringen laden…</p>}
        {submissions.isError && <p className="mt-2 text-sm text-destructive">Eerdere aanleveringen konden niet worden geladen.</p>}
        {submissions.data?.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Er zijn nog geen bestanden aangeleverd.</p>}
        {!!submissions.data?.length && <ul className="mt-3 space-y-2">{submissions.data.map(item => (
          <li key={item.id} className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-background px-4 py-3 text-sm sm:flex-row sm:items-center">
            <span><strong className="text-primary">{submissionLabels[item.fileType]}</strong><span className="block text-muted-foreground">{item.filename} · {new Date(item.submittedAt).toLocaleString('nl-NL')}</span><span className="mt-1 block font-semibold text-primary">Status: {submissionStatusLabels[item.status]}</span></span>
            <a href={item.downloadUrl} className="font-semibold text-primary underline underline-offset-4">Download</a>
          </li>
        ))}</ul>}
      </div>
    </div>
  );
}

export function FinancienPage(props: FinancienPageProps = {}) {
  if (props.adminParticipantId != null) {
    return <AdminFinancienDashboard {...props} participantId={props.adminParticipantId} />;
  }
  return <ParticipantFinancienDashboard />;
}

function ParticipantFinancienDashboard() {
  const [, setLocation] = useLocation();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const seasonsQuery = useGetFinancialSeasons();
  const dashboard = useGetDashboard(); 
  const profilePreferencesQueryKey = getProfilePreferencesQueryKey(userId ?? undefined);
  const preferences = useGetProfilePreferences({
    query: {
      enabled: !!userId,
      queryKey: profilePreferencesQueryKey,
    },
  });
  const updatePreferences = useUpdateProfilePreferences({
    mutation: {
      onSuccess: (saved) => {
        queryClient.setQueryData(profilePreferencesQueryKey, saved);
      },
    },
  });
  const saveMasterDataRoute = useCallback((
    route: MasterDataRoute,
    callbacks: { onSuccess: () => void; onError: () => void },
  ) => {
    updatePreferences.mutate(
      { data: { masterDataRoute: route } },
      callbacks,
    );
  }, [updatePreferences.mutate]);
  return (
    <FinancialDashboard
      seasonsQuery={seasonsQuery}
      defaultCountry={dashboard.data?.participant?.country || 'Nederland'}
      setLocation={setLocation}
      participantUserId={userId ?? undefined}
      serverMasterDataRoute={preferences.data?.masterDataRoute}
      preferencesLoaded={preferences.isSuccess}
      saveMasterDataRoute={saveMasterDataRoute}
    />
  );
}

function AdminFinancienDashboard({
  participantId,
  adminParticipantName,
  adminParticipantCountry,
}: FinancienPageProps & { participantId: number }) {
  // Admin navigation also works in embedded/test contexts where only the
  // participant route's wouter adapter is mounted.
  const setLocation = (to: string) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const seasonsQuery = useGetAdminFinancialSeasons(participantId, {
    query: {
      enabled: !!participantId,
      queryKey: getGetAdminFinancialSeasonsQueryKey(participantId),
    },
  });
  return (
    <FinancialDashboard
      seasonsQuery={seasonsQuery}
      defaultCountry={adminParticipantCountry || 'Nederland'}
      setLocation={setLocation}
      adminParticipantId={participantId}
      adminParticipantName={adminParticipantName}
    />
  );
}

function FinancialDashboard({
  seasonsQuery,
  defaultCountry,
  setLocation,
  adminParticipantId,
  adminParticipantName,
  participantUserId,
  serverMasterDataRoute,
  preferencesLoaded = false,
  saveMasterDataRoute,
}: {
  seasonsQuery: FinancialQuery<FinancialSeason[]>;
  defaultCountry: string;
  setLocation: (to: string) => void;
  adminParticipantId?: number;
  adminParticipantName?: string;
  participantUserId?: string;
  serverMasterDataRoute?: MasterDataRoute | null;
  preferencesLoaded?: boolean;
  saveMasterDataRoute?: (
    route: MasterDataRoute,
    callbacks: { onSuccess: () => void; onError: () => void },
  ) => void;
}) {
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | 'new' | null>(null);
  const [templateSeasonId, setTemplateSeasonId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'input' | 'costs' | 'results' | 'stamgegevens'>(adminParticipantId ? 'results' : 'input');
  const [masterDataRoute, setMasterDataRoute] = useState<MasterDataRoute>(() => getStoredMasterDataRoute(participantUserId));
  const [routeSyncStatus, setRouteSyncStatus] = useState<'idle' | 'pending' | 'failed'>('idle');
  
  const today = new Date();
  const defaultMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonthStr);
  const [hasUnsavedMonthChanges, setHasUnsavedMonthChanges] = useState(false);
  const [hasConflictRecovery, setHasConflictRecovery] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<null | (() => void)>(null);
  const skipHistoryGuardCleanup = useRef(false);
  const migratedPreferenceForParticipant = useRef<string | null>(null);
  const routeSyncRequestId = useRef(0);

  // A route can remain mounted while its :id changes. Never carry a season,
  // month, pending navigation, or dirty flag across participants.
  useEffect(() => {
    setSelectedSeasonId(null);
    setTemplateSeasonId(null);
    setSelectedMonth(defaultMonthStr);
    setActiveTab(adminParticipantId ? 'results' : 'input');
    setMasterDataRoute(getStoredMasterDataRoute(participantUserId));
    setRouteSyncStatus('idle');
    setHasUnsavedMonthChanges(false);
    setHasConflictRecovery(false);
    setPendingNavigation(null);
    migratedPreferenceForParticipant.current = null;
    routeSyncRequestId.current += 1;
  }, [adminParticipantId, participantUserId]);

  useEffect(() => {
    if (!participantUserId || !preferencesLoaded) return;
    if (serverMasterDataRoute) {
      setMasterDataRoute(serverMasterDataRoute);
      storeMasterDataRoute(participantUserId, serverMasterDataRoute);
      return;
    }
    const localRoute = getStoredMasterDataRoute(participantUserId);
    setMasterDataRoute(localRoute);
    if (
      localStorageHasMasterDataRoute(participantUserId)
      && migratedPreferenceForParticipant.current !== participantUserId
    ) {
      migratedPreferenceForParticipant.current = participantUserId;
      synchronizeMasterDataRoute(localRoute);
    }
  }, [participantUserId, preferencesLoaded, serverMasterDataRoute, saveMasterDataRoute]);

  function synchronizeMasterDataRoute(route: MasterDataRoute) {
    if (!saveMasterDataRoute) return;
    const requestId = ++routeSyncRequestId.current;
    setRouteSyncStatus('pending');
    saveMasterDataRoute(route, {
      onSuccess: () => {
        if (routeSyncRequestId.current === requestId) setRouteSyncStatus('idle');
      },
      onError: () => {
        if (routeSyncRequestId.current === requestId) setRouteSyncStatus('failed');
      },
    });
  }

  function changeMasterDataRoute(route: MasterDataRoute) {
    setMasterDataRoute(route);
    if (participantUserId) {
      storeMasterDataRoute(participantUserId, route);
      synchronizeMasterDataRoute(route);
    }
  }

  function requestNavigation(navigate: () => void) {
    if (hasUnsavedMonthChanges) {
      setPendingNavigation(() => navigate);
      return;
    }
    navigate();
  }

  function requestViewNavigation(view: typeof activeTab) {
    if (hasConflictRecovery) {
      requestNavigation(() => setActiveTab(view));
      return;
    }
    setActiveTab(view);
  }

  function discardChangesAndContinue() {
    setHasUnsavedMonthChanges(false);
    setHasConflictRecovery(false);
    const navigate = pendingNavigation;
    setPendingNavigation(null);
    navigate?.();
  }

  useEffect(() => {
    if (!hasUnsavedMonthChanges) return;

    function handleDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const nextLocation = getBlockedInternalNavigationTarget(anchor.href, window.location.href, true);
      if (!nextLocation) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(() => () => {
        skipHistoryGuardCleanup.current = true;
        setLocation(nextLocation);
      });
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedMonthChanges, setLocation]);

  useEffect(() => {
    if (!hasUnsavedMonthChanges) return;

    const guardId = `${Date.now()}`;
    const originalState = window.history.state;
    const currentUrl = window.location.href;
    const guardStates = financialHistoryGuardStates(originalState, guardId);
    let restoringGuardTop = false;

    window.history.replaceState(guardStates.base, '', currentUrl);
    window.history.pushState(guardStates.top, '', currentUrl);

    function handlePopState(event: PopStateEvent) {
      if (restoringGuardTop) {
        event.stopImmediatePropagation();
        restoringGuardTop = false;
        return;
      }
      if (!isFinancialHistoryGuardBase(event.state, guardId)) return;

      event.stopImmediatePropagation();
      restoringGuardTop = true;
      window.history.forward();
      setPendingNavigation(() => () => {
        skipHistoryGuardCleanup.current = true;
        window.removeEventListener('popstate', handlePopState, true);
        window.history.go(FINANCIAL_HISTORY_EXIT_DELTA);
      });
    }

    window.addEventListener('popstate', handlePopState, true);
    return () => {
      window.removeEventListener('popstate', handlePopState, true);
      if (skipHistoryGuardCleanup.current) {
        skipHistoryGuardCleanup.current = false;
        return;
      }

      if (isFinancialHistoryGuardTop(window.history.state, guardId)) {
        const collapseGuard = (event: PopStateEvent) => {
          if (!isFinancialHistoryGuardBase(event.state, guardId)) return;
          window.removeEventListener('popstate', collapseGuard, true);
          window.history.replaceState(originalState, '', currentUrl);
        };
        window.addEventListener('popstate', collapseGuard, true);
        window.history.back();
      } else if (isFinancialHistoryGuardBase(window.history.state, guardId)) {
        window.history.replaceState(originalState, '', currentUrl);
      }
    };
  }, [hasUnsavedMonthChanges]);

  useEffect(() => {
    if (seasonsQuery.data && seasonsQuery.data.length > 0 && selectedSeasonId === null) {
      const latest = [...seasonsQuery.data].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
      setSelectedSeasonId(latest.id);
    } else if (seasonsQuery.data && seasonsQuery.data.length === 0 && selectedSeasonId === null) {
      setSelectedSeasonId('new');
    }
  }, [seasonsQuery.data, selectedSeasonId]);

  useEffect(() => {
    if (selectedSeasonId && selectedSeasonId !== 'new' && seasonsQuery.data) {
      const season = seasonsQuery.data.find(s => s.id === selectedSeasonId);
      if (season && (selectedMonth || adminParticipantId == null)) {
        const seasonStart = season.startDate.slice(0, 7);
        const seasonEnd = season.endDate.slice(0, 7);
        const currentM = selectedMonth.slice(0, 7);
        
        if (currentM < seasonStart || currentM > seasonEnd) {
          setSelectedMonth(`${seasonStart}-01`);
        }
      }
    }
  }, [adminParticipantId, selectedSeasonId, seasonsQuery.data, selectedMonth]);

  if (seasonsQuery.isLoading) {
    return (
      <div className="page-in">
        {adminParticipantId != null && <AdminFinancialBanner participantName={adminParticipantName} />}
        <div className="grid min-h-[50vh] place-items-center text-muted-foreground animate-pulse">Financiën laden...</div>
      </div>
    );
  }

  if (seasonsQuery.isError) {
    return (
      <div className="page-in">
        {adminParticipantId != null && <AdminFinancialBanner participantName={adminParticipantName} />}
        <div className="grid min-h-[50vh] place-items-center text-destructive">Kon gegevens niet ophalen. Probeer het opnieuw.</div>
      </div>
    );
  }

  const seasons = seasonsQuery.data || [];
  return (
    <div className="page-in">
      {adminParticipantId != null && <AdminFinancialBanner participantName={adminParticipantName} />}
      <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.22em] text-muted-foreground">
            <span className="gold-rule" style={{ height: '2px', background: 'hsl(var(--accent))', width: '42px' }} />Jouw financiën
          </div>
          <h1 className="serif text-5xl leading-none tracking-[-.02em] text-primary lg:text-6xl" data-testid="title-financien">
            Financieel dashboard
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            Maak van een complex jaaroverzicht een rustig, helder maandelijks ritueel.
          </p>
        </div>
        {selectedSeasonId !== 'new' && (
          <ActionButton onClick={() => requestNavigation(() => {
            setTemplateSeasonId(selectedSeasonId);
            setSelectedSeasonId('new');
          })} testId="btn-new-season">
            <Plus className="size-4" /> Nieuw seizoen
          </ActionButton>
        )}
      </div>

      {selectedSeasonId === 'new' ? (
        <div className="rounded-xl border border-border/70 bg-card p-6 sm:p-8">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="serif text-3xl text-primary">Nieuw seizoen inrichten</h2>
            {seasons.length > 0 && (
              <button onClick={() => setSelectedSeasonId(templateSeasonId ?? seasons[0].id)} className="text-sm font-semibold text-accent-foreground hover:underline">Annuleren</button>
            )}
          </div>
          {adminParticipantId != null ? (
            <SeasonEditor templateSeasonId={templateSeasonId ?? undefined} defaultCountry={defaultCountry} adminParticipantId={adminParticipantId} onSaved={(id) => {
              setSelectedSeasonId(id);
              setSelectedMonth('');
              setTemplateSeasonId(null);
              setActiveTab('input');
            }} />
          ) : (
            <ParticipantMasterDataChoice
              route={masterDataRoute}
              onRouteChange={changeMasterDataRoute}
              routeSyncFailed={routeSyncStatus === 'failed'}
              routeSyncPending={routeSyncStatus === 'pending'}
              onRetryRouteSync={() => synchronizeMasterDataRoute(masterDataRoute)}
              seasonId={null}
            >
              <SeasonEditor
                templateSeasonId={templateSeasonId ?? undefined}
                defaultCountry={defaultCountry}
                initialFieldsOnly={masterDataRoute === 'excel'}
                onSaved={(id) => {
                setSelectedSeasonId(id);
                setTemplateSeasonId(null);
                setActiveTab('stamgegevens');
                }}
              />
            </ParticipantMasterDataChoice>
          )}
        </div>
      ) : selectedSeasonId ? (
        <>
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted-foreground">Seizoen:</span>
                <select 
                  value={selectedSeasonId} 
                  onChange={e => {
                    const nextSeasonId = Number(e.target.value);
                    requestNavigation(() => {
                      setSelectedSeasonId(nextSeasonId);
                      if (adminParticipantId != null) setSelectedMonth('');
                    });
                  }}
                  data-testid="select-season"
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm font-medium outline-none focus:border-accent shadow-sm"
                >
                  {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              {activeTab !== 'stamgegevens' && (
                <label className="flex items-center gap-2 border-l border-border/60 pl-4">
                  <span className="text-sm font-semibold text-muted-foreground">Maand:</span>
                  <input 
                    type="month" 
                    value={selectedMonth.slice(0, 7)} 
                    data-testid="input-month"
                    onChange={e => {
                        if (e.target.value) {
                          const nextMonth = `${e.target.value}-01`;
                          requestNavigation(() => setSelectedMonth(nextMonth));
                        }
                    }}
                    className="h-10 rounded-lg border border-input bg-card px-3 text-sm font-medium outline-none focus:border-accent shadow-sm" 
                  />
                </label>
              )}
            </div>
            
             <div
               className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-secondary/50 p-1"
               role="group"
               aria-label="Financiële weergave"
             >
              <button 
                onClick={() => requestViewNavigation('input')}
                 aria-pressed={activeTab === 'input'}
                data-testid="tab-input"
                 className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${activeTab === 'input' ? 'bg-background text-primary shadow-sm' : 'text-primary hover:bg-background/60'}`}
              >
                <PencilLine className="size-4" /> Invoer
              </button>
              <button
                onClick={() => requestViewNavigation('costs')}
                 aria-pressed={activeTab === 'costs'}
                data-testid="tab-costs"
                 className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${activeTab === 'costs' ? 'bg-background text-primary shadow-sm' : 'text-primary hover:bg-background/60'}`}
              >
                <ReceiptText className="size-4" /> Kosten
              </button>
              <button
                onClick={() => requestViewNavigation('results')}
                 aria-pressed={activeTab === 'results'}
                data-testid="tab-results"
                 className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${activeTab === 'results' ? 'bg-background text-primary shadow-sm' : 'text-primary hover:bg-background/60'}`}
              >
                <ChartNoAxesCombined className="size-4" /> Resultaten
              </button>
              <button 
                onClick={() => requestViewNavigation('stamgegevens')}
                 aria-pressed={activeTab === 'stamgegevens'}
                data-testid="tab-stamgegevens"
                 className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${activeTab === 'stamgegevens' ? 'bg-background text-primary shadow-sm' : 'text-primary hover:bg-background/60'}`}
              >
                <Settings className="size-4" /> Stamgegevens
              </button>
            </div>
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {activeTab === 'stamgegevens' && (
              <div className="rounded-xl border border-border/70 bg-card p-6 sm:p-8">
                {adminParticipantId != null ? (
                  <SeasonEditor
                    seasonId={selectedSeasonId as number}
                    defaultCountry={defaultCountry}
                    adminParticipantId={adminParticipantId}
                    onSaved={() => {}}
                  />
                ) : (
                  <ParticipantMasterDataChoice
                    route={masterDataRoute}
                    onRouteChange={changeMasterDataRoute}
                    routeSyncFailed={routeSyncStatus === 'failed'}
                    routeSyncPending={routeSyncStatus === 'pending'}
                    onRetryRouteSync={() => synchronizeMasterDataRoute(masterDataRoute)}
                    seasonId={selectedSeasonId as number}
                  >
                    <SeasonEditor
                      seasonId={selectedSeasonId as number}
                      defaultCountry={defaultCountry}
                      onSaved={() => {}}
                    />
                  </ParticipantMasterDataChoice>
                )}
              </div>
            )}
            <div className={activeTab === 'stamgegevens' ? 'hidden' : undefined}>
              <MonthView
                seasonId={selectedSeasonId as number}
                month={selectedMonth}
                view={activeTab === 'stamgegevens' ? 'input' : activeTab}
                onSelectMonth={(nextMonth) => requestNavigation(() => setSelectedMonth(nextMonth))}
                onUnsavedChangesChange={setHasUnsavedMonthChanges}
                onConflictRecoveryChange={setHasConflictRecovery}
                adminParticipantId={adminParticipantId}
              />
            </div>
          </div>
        </>
      ) : null}

      <Dialog open={pendingNavigation !== null} onOpenChange={(open) => {
        if (!open) setPendingNavigation(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasConflictRecovery ? 'Conflictherstel verlaten?' : 'Niet-opgeslagen wijzigingen verwerpen?'}</DialogTitle>
            <DialogDescription>
              {hasConflictRecovery
                ? 'Je afgewezen maandinvoer is tijdelijk bewaard voor conflictherstel. Als je doorgaat, verlaat je deze invoer en kan die niet meer opnieuw worden toegepast.'
                : 'Je hebt financiële wijzigingen die nog niet zijn opgeslagen. Als je doorgaat, gaan deze wijzigingen verloren.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingNavigation(null)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-input px-4 text-sm font-semibold"
            >
              {hasConflictRecovery ? 'Conflictherstel behouden' : 'Blijven bewerken'}
            </button>
            <button
              type="button"
              onClick={discardChangesAndContinue}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground"
              data-testid="confirm-discard-financial-month"
            >
              {hasConflictRecovery ? 'Invoer verlaten en doorgaan' : 'Wijzigingen verwerpen'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminFinancialBanner({ participantName }: { participantName?: string }) {
  return (
    <div
      className="mb-7 flex flex-col gap-3 rounded-xl border-2 border-accent bg-accent/15 px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      role="status"
      data-testid="admin-financial-banner"
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-accent-foreground">Beheren namens deelnemer</p>
        <p className="mt-1 text-lg font-semibold text-primary">{participantName || 'Deelnemer laden...'}</p>
      </div>
      <a href="/beheer/financien" className="inline-flex items-center text-sm font-semibold text-primary underline underline-offset-4">Terug naar financiën</a>
    </div>
  );
}
