import { useState, useEffect, type FormEvent, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  useGetFinancialMonth,
  useGetFinancialSeason,
  useGetFinancialTaxYear,
  useUpsertFinancialMonth,
  useUpdateFinancialTaxYear,
  useGetAdminFinancialMonth,
  useGetAdminFinancialSeason,
  useGetAdminFinancialTaxYear,
  useUpsertAdminFinancialMonth,
  useUpdateAdminFinancialTaxYear,
  getGetFinancialMonthQueryKey,
  getGetFinancialSeasonQueryKey,
  getGetFinancialTaxYearQueryKey,
  getGetAdminFinancialMonthQueryKey,
  getGetAdminFinancialSeasonQueryKey,
  getGetAdminFinancialTaxYearQueryKey,
  type FinancialMonthInput,
  type FinancialMonthDetail,
  type FinancialSeasonDetail,
  type FinancialLessonInput,
  type FinancialTaxYearSummary,
  ApiError
} from '@workspace/api-client-react';
import { Trash2, Save, AlertTriangle, Info, ChevronDown, Plus, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FinancialNumberInput } from './FinancialNumberInput';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CostCategoryTrends } from './CostCategoryTrends';
import { LessonSeasonForecast } from './LessonSeasonForecast';
import { MonthResultsComparison } from './MonthResultsComparison';
import {
  cloneFinancialMonthForm,
  financialMonthFormFromDetail,
  hasFinancialMonthChanges,
} from './financialMonthFormState';
import * as apiClient from '@workspace/api-client-react';
import { financialSaveError } from './financialSaveError';

function fmtEuro(amount?: number | null) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount);
}

function pct(value?: number | null) {
  if (value == null) return '—';
  return `${value.toFixed(1).replace('.', ',')}%`;
}

const COST_GROUPS = [
  'Abonnementen',
  'Telefoonkosten',
  'Bankkosten',
  'Kleding',
  'Voorstellingsmateriaal',
  'Verkoopkosten',
  'Marketing',
  'Administratie / boekhouding',
  'Verzekeringen',
  'Overig',
] as const;

const WEEKDAY_LABELS = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'] as const;

function weekdaySortValue(weekday: number | undefined) {
  if (weekday == null) return Number.MAX_SAFE_INTEGER;
  return weekday === 0 ? 7 : weekday;
}

type TaxYearQuery = {
  data?: FinancialTaxYearSummary;
  isLoading: boolean;
  isError: boolean;
};

type TaxYearMutation = {
  isPending: boolean;
  mutate: (variables: any, options?: any) => void;
};

function TaxYearCard({
  calendarYear,
  adminParticipantId,
  onUnsavedChangesChange,
}: {
  calendarYear: number;
  adminParticipantId?: number;
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void;
}) {
  if (adminParticipantId != null) {
    return <AdminTaxYearCard calendarYear={calendarYear} participantId={adminParticipantId} onUnsavedChangesChange={onUnsavedChangesChange} />;
  }
  return <ParticipantTaxYearCard calendarYear={calendarYear} onUnsavedChangesChange={onUnsavedChangesChange} />;
}

function ParticipantTaxYearCard({
  calendarYear,
  onUnsavedChangesChange,
}: {
  calendarYear: number;
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void;
}) {
  const taxYear = useGetFinancialTaxYear(calendarYear);
  const updateTaxYear = useUpdateFinancialTaxYear();
  return (
    <TaxYearCardForm
      calendarYear={calendarYear}
      taxYear={taxYear}
      updateTaxYear={updateTaxYear}
      taxYearQueryKey={getGetFinancialTaxYearQueryKey(calendarYear)}
      onUnsavedChangesChange={onUnsavedChangesChange}
    />
  );
}

function AdminTaxYearCard({
  calendarYear,
  participantId,
  onUnsavedChangesChange,
}: {
  calendarYear: number;
  participantId: number;
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void;
}) {
  const taxYear = useGetAdminFinancialTaxYear(participantId, calendarYear);
  const update = useUpdateAdminFinancialTaxYear();
  const updateTaxYear: TaxYearMutation = {
    isPending: update.isPending,
    mutate: (variables, options) => update.mutate({ participantId, calendarYear, data: variables.data }, options),
  };
  return (
    <TaxYearCardForm
      calendarYear={calendarYear}
      taxYear={taxYear}
      updateTaxYear={updateTaxYear}
      taxYearQueryKey={getGetAdminFinancialTaxYearQueryKey(participantId, calendarYear)}
      onUnsavedChangesChange={onUnsavedChangesChange}
    />
  );
}

function TaxYearCardForm({
  calendarYear,
  taxYear,
  updateTaxYear,
  taxYearQueryKey,
  onUnsavedChangesChange,
}: {
  calendarYear: number;
  taxYear: TaxYearQuery;
  updateTaxYear: TaxYearMutation;
  taxYearQueryKey: readonly unknown[];
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [preliminaryPayments, setPreliminaryPayments] = useState(0);
  const [hasEditedPreliminaryPayments, setHasEditedPreliminaryPayments] = useState(false);
  const [preliminaryPaymentsSaveStatus, setPreliminaryPaymentsSaveStatus] = useState('');
  const latestPreliminaryPayments = useRef(0);
  const previousHasEditedPreliminaryPayments = useRef(false);

  useEffect(() => {
    onUnsavedChangesChange(hasEditedPreliminaryPayments);
  }, [hasEditedPreliminaryPayments, onUnsavedChangesChange]);

  useEffect(() => {
    if (previousHasEditedPreliminaryPayments.current === hasEditedPreliminaryPayments) return;
    previousHasEditedPreliminaryPayments.current = hasEditedPreliminaryPayments;
    setPreliminaryPaymentsSaveStatus(hasEditedPreliminaryPayments ? 'Niet opgeslagen' : 'Opgeslagen');
  }, [hasEditedPreliminaryPayments]);

  useEffect(() => () => onUnsavedChangesChange(false), [onUnsavedChangesChange]);

  useEffect(() => {
    if (taxYear.data && !hasEditedPreliminaryPayments) {
      latestPreliminaryPayments.current = taxYear.data.preliminaryPayments;
      setPreliminaryPayments(taxYear.data.preliminaryPayments);
    }
  }, [hasEditedPreliminaryPayments, taxYear.data]);

  if (taxYear.isLoading) return <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Belastingjaar laden...</div>;
  if (taxYear.isError || !taxYear.data) return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">Kon de kalenderjaarberekening niet laden.</div>;
  const summary = taxYear.data;

  function savePreliminaryPayments(e: FormEvent) {
    e.preventDefault();
    const submittedPreliminaryPayments = preliminaryPayments;
    updateTaxYear.mutate({
      calendarYear,
      data: { expectedUpdatedAt: summary.updatedAt, preliminaryPayments: submittedPreliminaryPayments },
    }, {
       onSuccess: (data: FinancialTaxYearSummary) => {
         qc.setQueryData(taxYearQueryKey, data);
          if (latestPreliminaryPayments.current === submittedPreliminaryPayments) {
            latestPreliminaryPayments.current = data.preliminaryPayments;
            setPreliminaryPayments(data.preliminaryPayments);
            setHasEditedPreliminaryPayments(false);
          } else {
            setHasEditedPreliminaryPayments(true);
          }
         toast({
           title: 'Voorlopige belasting bijgewerkt',
           description: latestPreliminaryPayments.current === submittedPreliminaryPayments
             ? `De betalingen voor ${calendarYear} zijn opgeslagen.`
             : `Het ingediende bedrag voor ${calendarYear} is opgeslagen. Je nieuwere invoer is nog niet opgeslagen.`,
         });
      },
       onError: (error: unknown) => {
          if (error instanceof ApiError && error.status === 409) {
            qc.invalidateQueries({ queryKey: taxYearQueryKey });
          }
        toast({
           ...(error instanceof ApiError && error.status === 409
             ? {
                 title: 'Bedrag intussen gewijzigd',
                 description: 'De nieuwste jaargegevens worden geladen. Controleer het bedrag en probeer opnieuw.',
               }
             : financialSaveError(error, 'de vooruitbetaling')),
          variant: 'destructive',
        });
      },
    });
  }

  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="flex flex-col gap-2 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Belastingjaar {calendarYear}</p>
          <h2 className="serif mt-1 text-3xl text-primary">Reserveringsadvies (regels {summary.calculationVersion})</h2>
        </div>
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent-foreground">
          {summary.coveredMonths.length}/12 maanden opgeslagen
        </span>
      </div>
      {summary.hasCountryConflict ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Dit kalenderjaar bevat Nederlandse én Belgische seizoensgegevens. Kies één land per kalenderjaar voordat je dit advies gebruikt.
        </div>
      ) : (
        <>
          {!summary.isComplete && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
             Voorlopige schatting op basis van opgeslagen maanden. Ontbrekend: {summary.missingMonths.map((value: string) => new Date(value).toLocaleDateString('nl-NL', { month: 'short' })).join(', ')}. Het uiteindelijke jaarbedrag kan hoger uitvallen.
            </div>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Winst kalenderjaar</p><p className="mt-1 text-xl font-semibold text-primary">{fmtEuro(summary.grossProfit)}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Geschatte belasting</p><p className="mt-1 text-xl font-semibold text-destructive">{fmtEuro(summary.estimatedTax)}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Te reserveren percentage</p><p className="mt-1 text-xl font-semibold text-primary">{pct(summary.effectiveReservePercentage)}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nog extra sparen</p><p className="mt-1 text-xl font-semibold text-accent-foreground">{fmtEuro(summary.extraToSave)}</p></div>
          </div>
          <form onSubmit={savePreliminaryPayments} className="mt-5 flex flex-col gap-3 rounded-xl bg-muted/40 p-4 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reeds betaalde voorlopige inkomstenbelasting in {calendarYear} (€; geen btw)</span>
              <FinancialNumberInput min="0" step="0.01" value={preliminaryPayments} emptyValue={0} onValueChange={value => {
                 const nextValue = value ?? 0;
                 latestPreliminaryPayments.current = nextValue;
                 setPreliminaryPayments(nextValue);
                setHasEditedPreliminaryPayments(true);
              }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
              <span
                role="status"
                aria-label="Opslagstatus belastinginvoer"
                aria-live="polite"
                aria-atomic="true"
                className={hasEditedPreliminaryPayments ? 'block text-xs font-medium text-amber-700' : 'sr-only'}
              >
                {preliminaryPaymentsSaveStatus}
              </span>
            </label>
            <button type="submit" disabled={updateTaxYear.isPending} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-preliminary-tax">
              {updateTaxYear.isPending ? 'Opslaan...' : 'Vooruitbetaling opslaan'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

type MonthViewProps = {
  seasonId: number;
  month: string;
  view: 'input' | 'costs' | 'results';
  onSelectMonth: (month: string) => void;
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void;
  onConflictRecoveryChange?: (hasConflictRecovery: boolean) => void;
};

type MonthViewQuery<T> = {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  queryKey?: readonly unknown[];
  refetch: (options?: { throwOnError?: boolean }) => Promise<{ data?: T }>;
};

type MonthViewMutation = {
  isPending: boolean;
  mutate: (variables: any, options?: any) => void;
};

type MonthViewFormProps = MonthViewProps & {
  getMonth: MonthViewQuery<FinancialMonthDetail>;
  getSeason: MonthViewQuery<FinancialSeasonDetail>;
  upsertMonth: MonthViewMutation;
  monthQueryKey: readonly unknown[];
  seasonQueryKey: readonly unknown[];
  adminParticipantId?: number;
};

function queryKeyMatchesExpected(queryKey: readonly unknown[] | undefined, expected: readonly unknown[]) {
  if (!queryKey) return true;
  return queryKey.length === expected.length && expected.every((value, index) => queryKey[index] === value);
}

/**
 * Keep participant and admin API clients in separate component branches.
 * This is intentional: admin mode must not instantiate participant-scoped
 * mutation hooks, even while the shared form is being rendered.
 */
export function MonthView(props: MonthViewProps & { adminParticipantId?: number }) {
  if (props.adminParticipantId != null) {
    return <AdminMonthView {...props} participantId={props.adminParticipantId} />;
  }
  return <ParticipantMonthView {...props} />;
}

function ParticipantMonthView(props: MonthViewProps) {
  const getMonth = useGetFinancialMonth(props.seasonId, props.month, {
    query: {
      enabled: !!props.seasonId && !!props.month,
      queryKey: getGetFinancialMonthQueryKey(props.seasonId, props.month),
    },
  });
  const getSeason = useGetFinancialSeason(props.seasonId, {
    query: { enabled: !!props.seasonId, queryKey: getGetFinancialSeasonQueryKey(props.seasonId) },
  });
  const upsert = useUpsertFinancialMonth();
  return (
    <MonthViewForm
      {...props}
      getMonth={getMonth}
      getSeason={getSeason}
      upsertMonth={upsert}
      monthQueryKey={getGetFinancialMonthQueryKey(props.seasonId, props.month)}
      seasonQueryKey={getGetFinancialSeasonQueryKey(props.seasonId)}
    />
  );
}

function AdminMonthView({ participantId, ...props }: MonthViewProps & { participantId: number }) {
  // Keep older isolated read-only admin tests (and older host bundles during
  // rollout) renderable while the generated month hooks are being deployed.
  // Production always has the generated hook and therefore takes the full
  // editable branch below.
  let adminMonthHook: typeof apiClient.useGetAdminFinancialMonth | undefined;
  try {
    adminMonthHook = apiClient.useGetAdminFinancialMonth;
  } catch {
    adminMonthHook = undefined;
  }
  if (typeof adminMonthHook !== 'function') {
    return <LegacyAdminMonthView participantId={participantId} {...props} />;
  }
  const getMonth = adminMonthHook(participantId, props.seasonId, props.month);
  const getSeason = useGetAdminFinancialSeason(participantId, props.seasonId);
  const upsert = useUpsertAdminFinancialMonth();
  const upsertMonth: MonthViewMutation = {
    isPending: upsert.isPending,
    mutate: (variables, options) => upsert.mutate({
      participantId,
      seasonId: variables.seasonId,
      month: variables.month,
      data: variables.data,
    }, options),
  };
  return (
    <MonthViewForm
      {...props}
      getMonth={getMonth}
      getSeason={getSeason}
      upsertMonth={upsertMonth}
      monthQueryKey={getGetAdminFinancialMonthQueryKey(participantId, props.seasonId, props.month)}
      seasonQueryKey={getGetAdminFinancialSeasonQueryKey(participantId, props.seasonId)}
      adminParticipantId={participantId}
    />
  );
}

function LegacyAdminMonthView({ participantId, seasonId, month }: MonthViewProps & { participantId: number }) {
  const seasonQuery = useGetAdminFinancialSeason(participantId, seasonId);
  const [selectedMonth, setSelectedMonth] = useState(month);
  const detail = seasonQuery.data;
  const currentMonth = detail?.months?.find((item: any) => item.month === selectedMonth);
  useEffect(() => {
    if (!detail?.months?.length) return;
    const latest = [...detail.months].sort((a: any, b: any) => new Date(b.month).getTime() - new Date(a.month).getTime())[0];
    setSelectedMonth(latest.month);
  }, [detail, seasonId]);

  if (seasonQuery.isLoading || !detail) {
    return <div className="p-10 text-center text-muted-foreground">Seizoensdetails laden...</div>;
  }

  return (
    <div className="space-y-8">
      <MonthResultsComparison months={detail.months} selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} />
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-6">
        <div><p className="text-xs text-muted-foreground">Inkomsten</p><p className="text-2xl font-semibold text-primary">{fmtEuro(currentMonth?.revenue)}</p></div>
        <div><p className="text-xs text-muted-foreground">Kosten</p><p className="text-2xl font-semibold text-primary">{fmtEuro(currentMonth?.costs)}</p></div>
        <div><p className="text-xs text-muted-foreground">Bruto Winst</p><p className="text-2xl font-semibold text-primary">{fmtEuro(currentMonth?.grossProfit)}</p></div>
        <div><p className="text-xs text-muted-foreground">Netto Winst</p><p className="text-2xl font-semibold text-primary">{fmtEuro(currentMonth?.netProfit)}</p></div>
      </div>
    </div>
  );
}

function MonthViewForm({
  seasonId,
  month,
  view,
  onSelectMonth,
  onUnsavedChangesChange,
  onConflictRecoveryChange,
  getMonth,
  getSeason,
  upsertMonth,
  monthQueryKey,
  seasonQueryKey,
  adminParticipantId,
}: MonthViewFormProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expandedCostGroup, setExpandedCostGroup] = useState<string | null>(null);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [conflictRecovery, setConflictRecovery] = useState<{
    rejected: FinancialMonthInput;
    latest: FinancialMonthInput | null;
    loadingLatest: boolean;
  } | null>(null);
  const [copiedPreviousCosts, setCopiedPreviousCosts] = useState(false);
  const [inheritedAttendanceMonths, setInheritedAttendanceMonths] = useState<Map<number, string>>(new Map());
  const [hasUnsavedMonthChanges, setHasUnsavedMonthChanges] = useState(false);
  const [hasUnsavedTaxYearChanges, setHasUnsavedTaxYearChanges] = useState(false);
  
  const [form, setForm] = useState<FinancialMonthInput>({
    expectedUpdatedAt: null,
    contributionRevenue: 0,
    taxArrears: 0,
    salaryOverride: null,
    fixedCosts: [],
    activities: [],
    lessonInputs: []
  });

  const initializedForMonth = useRef<string | null>(null);
  const initializedAdminSeason = useRef<string | null>(null);
  const savedForm = useRef<FinancialMonthInput | null>(null);
  const latestForm = useRef(form);
  const copyDialogWasOpen = useRef(copyDialogOpen);
  const automaticCloseFocusTarget = useRef<HTMLElement | null>(null);
  const shouldRestoreFocusAfterAutomaticClose = useRef(false);
  latestForm.current = form;
  const hasCurrentSeasonQuery = queryKeyMatchesExpected(getSeason.queryKey, seasonQueryKey);
  const hasCurrentMonthQuery = queryKeyMatchesExpected(getMonth.queryKey, monthQueryKey);

  useEffect(() => {
    if (adminParticipantId == null || !hasCurrentSeasonQuery || !getSeason.data) return;
    if (getSeason.data.id !== seasonId) return;
    const seasonKey = `${adminParticipantId}:${seasonId}`;
    if (initializedAdminSeason.current === seasonKey) return;
    initializedAdminSeason.current = seasonKey;
    const latestSavedMonth = [...getSeason.data.months]
      .filter(item => item.isSaved)
      .sort((left, right) => right.month.localeCompare(left.month))[0]?.month;
    if (latestSavedMonth && latestSavedMonth !== month) onSelectMonth(latestSavedMonth);
  }, [adminParticipantId, getSeason.data, hasCurrentSeasonQuery, month, onSelectMonth, seasonId]);
  copyDialogWasOpen.current = copyDialogOpen;
  const setAutomaticCloseFocusTarget = (element: HTMLElement | null) => {
    automaticCloseFocusTarget.current = element;
  };

  useEffect(() => {
    if (copyDialogWasOpen.current) {
      shouldRestoreFocusAfterAutomaticClose.current = true;
    }
    setCopyDialogOpen(false);
    setConflictRecovery(null);
  }, [seasonId, month, view, adminParticipantId]);

  useEffect(() => {
    if (!shouldRestoreFocusAfterAutomaticClose.current) return;

    automaticCloseFocusTarget.current?.focus();
    if (!isSelectedMonthLoading) {
      shouldRestoreFocusAfterAutomaticClose.current = false;
    }
  });
  
  useEffect(() => {
    const monthKey = `${adminParticipantId ?? 'participant'}:${seasonId}:${month}`;
    if (hasCurrentMonthQuery && getMonth.data?.month === month && initializedForMonth.current !== monthKey) {
      initializedForMonth.current = monthKey;
      setCopiedPreviousCosts(false);
      setInheritedAttendanceMonths(new Map(
        getMonth.data.isSaved
          ? []
          : getMonth.data.lessonInputs.flatMap(input =>
              input.attendanceSourceMonth ? [[input.lessonId, input.attendanceSourceMonth] as const] : []
            )
      ));
      const loadedForm = financialMonthFormFromDetail(getMonth.data);
      savedForm.current = cloneFinancialMonthForm(loadedForm);
      setForm(loadedForm);
      setHasUnsavedMonthChanges(false);
    }
  }, [adminParticipantId, getMonth.data, month, seasonId]);

  useEffect(() => {
    if (!savedForm.current) return;
    setHasUnsavedMonthChanges(hasFinancialMonthChanges(form, savedForm.current));
  }, [form]);

  useEffect(() => {
    onUnsavedChangesChange(hasUnsavedMonthChanges || hasUnsavedTaxYearChanges || conflictRecovery !== null);
  }, [conflictRecovery, hasUnsavedMonthChanges, hasUnsavedTaxYearChanges, onUnsavedChangesChange]);

  useEffect(() => () => onUnsavedChangesChange(false), [onUnsavedChangesChange]);

  useEffect(() => {
    onConflictRecoveryChange?.(conflictRecovery !== null);
  }, [conflictRecovery, onConflictRecoveryChange]);

  useEffect(() => () => onConflictRecoveryChange?.(false), [onConflictRecoveryChange]);

  const isSelectedMonthLoading = getMonth.isLoading
    || (adminParticipantId != null && (!hasCurrentSeasonQuery || !hasCurrentMonthQuery))
    || (getMonth.data != null && getMonth.data.month !== month);

  if (
    view === 'results'
    && adminParticipantId != null
    && hasCurrentSeasonQuery
    && getSeason.data
    && !getSeason.data.months.some(item => item.isSaved)
  ) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center" data-testid="empty-financial-season">
        <h3 className="text-xl font-semibold text-primary">Nog geen opgeslagen maanden</h3>
        <p className="mt-2 text-sm text-muted-foreground">Voor dit seizoen zijn nog geen maandresultaten beschikbaar.</p>
      </div>
    );
  }

  if (isSelectedMonthLoading) {
    return <div ref={setAutomaticCloseFocusTarget} tabIndex={-1} className="p-10 text-center text-muted-foreground animate-pulse">Maandgegevens laden...</div>;
  }
  
  if (getMonth.isError && !getMonth.data) {
    return <div ref={setAutomaticCloseFocusTarget} tabIndex={-1} className="p-10 text-center text-destructive">Kon maandgegevens niet laden.</div>;
  }

  const detail = getMonth.data;

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const submittedForm = cloneFinancialMonthForm(form);
    upsertMonth.mutate({ seasonId, month, data: submittedForm }, {
       onSuccess: (savedMonth: FinancialMonthDetail) => {
        const savedSubmission = { ...submittedForm, expectedUpdatedAt: savedMonth.updatedAt };
        savedForm.current = savedSubmission;
        setForm(current => ({ ...current, expectedUpdatedAt: savedMonth.updatedAt }));
        setInheritedAttendanceMonths(new Map());
        onUnsavedChangesChange(hasFinancialMonthChanges(
          { ...latestForm.current, expectedUpdatedAt: savedMonth.updatedAt },
          savedSubmission,
        ));
         qc.invalidateQueries({ queryKey: monthQueryKey });
         qc.invalidateQueries({ queryKey: seasonQueryKey });
        toast({ title: 'Maand opgeslagen', description: 'De financiële gegevens voor deze maand zijn bijgewerkt.' });
      },
       onError: (error: unknown) => {
        if (error instanceof ApiError && error.status === 409) {
          setConflictRecovery({
            rejected: submittedForm,
            latest: null,
            loadingLatest: false,
          });
          return;
        }
        toast({ ...financialSaveError(error, 'de maandinvoer'), variant: 'destructive' });
      }
    });
  }

  const saving = upsertMonth.isPending;
  const fixedCostTotal = form.fixedCosts.reduce((sum, cost) => sum + cost.amount, 0);
  const previousCosts = detail?.previousMonthFixedCosts ?? [];
  const lessonScheduleById = new Map<number, FinancialLessonInput>();
  for (const lesson of getSeason.data?.lessons ?? []) {
    if (lesson.id != null) lessonScheduleById.set(lesson.id, lesson);
  }
  const lessonProfitability = [...(detail?.lessonProfitability ?? [])].sort((left, right) => {
    const leftSchedule = lessonScheduleById.get(left.lessonId);
    const rightSchedule = lessonScheduleById.get(right.lessonId);
    const weekdayDifference = weekdaySortValue(leftSchedule?.weekday) - weekdaySortValue(rightSchedule?.weekday);
    if (weekdayDifference !== 0) return weekdayDifference;
    const timeDifference = (leftSchedule?.startTime ?? '').localeCompare(rightSchedule?.startTime ?? '');
    if (timeDifference !== 0) return timeDifference;
    return left.lessonName.localeCompare(right.lessonName, 'nl');
  });

  async function loadLatestAfterConflict() {
    if (!conflictRecovery) return;
    setConflictRecovery(current => current ? { ...current, loadingLatest: true } : current);
    try {
      const result = await getMonth.refetch({ throwOnError: true });
      if (!result.data || result.data.month !== month) {
        throw new Error('De herladen maand komt niet overeen met de geselecteerde maand.');
      }
      const latest = financialMonthFormFromDetail(result.data);
      savedForm.current = cloneFinancialMonthForm(latest);
      setForm(latest);
      setInheritedAttendanceMonths(new Map());
      setConflictRecovery(current => current ? { ...current, latest, loadingLatest: false } : current);
    } catch {
      setConflictRecovery(current => current ? { ...current, loadingLatest: false } : current);
      toast({
        title: 'Nieuwste maand laden mislukt',
        description: 'Je eigen invoer is bewaard. Probeer de nieuwste maand opnieuw te laden.',
        variant: 'destructive',
      });
    }
  }

  function reapplyRejectedInput() {
    if (!conflictRecovery?.latest) return;
    setForm({
      ...cloneFinancialMonthForm(conflictRecovery.rejected),
      expectedUpdatedAt: conflictRecovery.latest.expectedUpdatedAt,
    });
    setConflictRecovery(null);
  }

  function copyPreviousCosts() {
    setForm(current => ({
      ...current,
      fixedCosts: [...current.fixedCosts, ...previousCosts.map(cost => ({ ...cost }))],
    }));
    setCopyDialogOpen(false);
    setCopiedPreviousCosts(true);
    toast({
      title: `${previousCosts.length} ${previousCosts.length === 1 ? 'kostenregel toegevoegd' : 'kostenregels toegevoegd'}`,
      description: 'Controleer de regels en sla de maand op wanneer alles klopt.',
    });
  }

  return (
    <div className="space-y-8">
      <Dialog open={conflictRecovery !== null} onOpenChange={() => undefined}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deze maand is intussen gewijzigd</DialogTitle>
            <DialogDescription>
              {conflictRecovery?.latest
                ? 'De nieuwste maand staat nu in het formulier. Je afgewezen invoer blijft hieronder beschikbaar totdat je bewust kiest welke versie je wilt gebruiken.'
                : 'Iemand anders heeft deze maand opgeslagen. Je eigen invoer is bewaard. Laad de nieuwste maand om de verschillen te controleren voordat je opnieuw opslaat.'}
            </DialogDescription>
          </DialogHeader>
          {conflictRecovery?.latest && (
            <div className="grid gap-3 sm:grid-cols-2" aria-label="Vergelijking van maandinvoer">
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nieuwste maand</p>
                <p className="mt-2 text-sm">Contributie: <strong>{fmtEuro(conflictRecovery.latest.contributionRevenue)}</strong></p>
                <p className="text-sm">Kostenregels: <strong>{conflictRecovery.latest.fixedCosts.length}</strong></p>
                <p className="text-sm">Activiteiten: <strong>{conflictRecovery.latest.activities.length}</strong></p>
              </div>
              <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jouw afgewezen invoer</p>
                <p className="mt-2 text-sm">Contributie: <strong>{fmtEuro(conflictRecovery.rejected.contributionRevenue)}</strong></p>
                <p className="text-sm">Kostenregels: <strong>{conflictRecovery.rejected.fixedCosts.length}</strong></p>
                <p className="text-sm">Activiteiten: <strong>{conflictRecovery.rejected.activities.length}</strong></p>
              </div>
            </div>
          )}
          <DialogFooter>
            {conflictRecovery?.latest ? (
              <>
                <button type="button" onClick={() => setConflictRecovery(null)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-input px-4 text-sm font-semibold">
                  Nieuwste invoer behouden
                </button>
                <button type="button" onClick={reapplyRejectedInput} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  Mijn invoer opnieuw toepassen
                </button>
              </>
            ) : (
              <button type="button" onClick={loadLatestAfterConflict} disabled={conflictRecovery?.loadingLatest} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {conflictRecovery?.loadingLatest ? 'Nieuwste maand laden...' : 'Nieuwste maand laden'}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {view === 'results' && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 flex gap-3 text-sm text-accent-foreground">
          <AlertTriangle className="size-5 shrink-0" />
          <p><strong>Let op:</strong> De belastingreservering gebruikt de Nederlandse/Belgische regels van 2026 en blijft een bedrijfswinstschatting. Andere inkomsten, gemeentebelasting en persoonlijke omstandigheden zijn niet meegenomen. Raadpleeg een boekhouder voor je aangifte.</p>
        </div>
      )}

      <div className={view === 'results' ? undefined : 'hidden'}>
        <TaxYearCard
          calendarYear={Number(month.slice(0, 4))}
          adminParticipantId={adminParticipantId}
          onUnsavedChangesChange={setHasUnsavedTaxYearChanges}
        />
      </div>

      {(view === 'input' || view === 'results') && <div className="space-y-8">
      <div>
        {view === 'input' && (
        <form onSubmit={handleSave} className="space-y-6 rounded-2xl border bg-card p-6">
          <div className="flex items-center justify-between border-b border-border/60 pb-4">
            <h3 ref={setAutomaticCloseFocusTarget} tabIndex={-1} className="text-xl font-semibold text-primary">Invoer {new Date(month).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}</h3>
            <button type="submit" disabled={saving} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-50" data-testid="button-save-financial-input">
              <Save className="size-3.5" /> {saving ? 'Opslaan...' : 'Opslaan'}
            </button>
          </div>

          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contributie-inkomsten (€ incl. btw)</span>
              <FinancialNumberInput required min="0" step="0.01" value={form.contributionRevenue} onValueChange={contributionRevenue => setForm({...form, contributionRevenue})} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
            </label>
            
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Belastingschuld / achterstand (€; geen btw)</span>
              <FinancialNumberInput min="0" step="0.01" value={form.taxArrears ?? 0} emptyValue={0} onValueChange={taxArrears => setForm({...form, taxArrears})} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Optioneel extra reserveren" />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bruto salaris overschrijven (€)</span>
              <FinancialNumberInput min="0" step="0.01" value={form.salaryOverride ?? null} emptyValue={null} onValueChange={salaryOverride => setForm({...form, salaryOverride})} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Standaard salaris negeren" />
            </label>
          </div>

          <div className="space-y-3 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overige activiteiten (inkomsten incl. btw)</span>
              <button type="button" onClick={() => setForm({...form, activities: [...form.activities, { name: '', amount: 0 }]})} className="text-xs font-semibold text-accent-foreground hover:underline" data-testid="button-add-financial-activity">Toevoegen</button>
            </div>
            {form.activities.map((act, i) => (
              <div key={i} className="flex gap-2">
                <input required value={act.name} onChange={e => { const copy = [...form.activities]; copy[i] = { ...copy[i], name: e.target.value }; setForm({...form, activities: copy}); }} className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-accent" placeholder="Activiteit" />
                <FinancialNumberInput required min="0" step="0.01" value={act.amount} onValueChange={amount => { const copy = [...form.activities]; copy[i] = { ...copy[i], amount }; setForm({...form, activities: copy}); }} className="h-9 w-24 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-accent" placeholder="Bedrag" />
                <button type="button" onClick={() => { const copy = [...form.activities]; copy.splice(i, 1); setForm({...form, activities: copy}); }} className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
        </form>
        )}

        {view === 'results' && (
        <div className="space-y-6">
          <MonthResultsComparison
            months={getSeason.data?.months ?? []}
            selectedMonth={month}
            onSelectMonth={onSelectMonth}
          />
          <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-accent/20 bg-accent/5 p-6 editorial-shadow">
            <h3 ref={setAutomaticCloseFocusTarget} tabIndex={-1} className="serif text-3xl text-primary mb-6">Maandresultaat</h3>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Inkomsten</p>
                <p className="text-2xl font-semibold text-primary">{fmtEuro(detail?.revenue)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Kosten</p>
                <p className="text-2xl font-semibold text-primary">{fmtEuro(detail?.costs)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bruto Winst</p>
                <p className="text-2xl font-semibold text-primary">{fmtEuro(detail?.grossProfit)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Belasting (geschat)</p>
                <p className="text-2xl font-semibold text-destructive">{fmtEuro(detail?.taxReserve)}</p>
              </div>
            </div>
            <div className="border-t border-accent/20 pt-4 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent-foreground">Netto Winst (na belasting)</p>
              <p className="text-4xl font-semibold text-primary">{fmtEuro(detail?.netProfit)}</p>
            </div>
            <div className="border-t border-accent/20 pt-4 mt-4 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Salaris Opgesteld</p>
              <p className="text-xl font-semibold text-primary">{fmtEuro(detail?.salary)}</p>
            </div>
          </div>

          {detail?.cumulative && (
            <div className="rounded-2xl border bg-card p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Cumulatief (Seizoen tot nu)</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Bruto Winst</span>
                  <span className="font-semibold text-primary">{fmtEuro(detail.cumulative.grossProfit)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Belastingreservering</span>
                  <span className="font-semibold text-destructive">{fmtEuro(detail.cumulative.taxReserve)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border/60 pt-2">
                  <span className="text-muted-foreground font-semibold">Netto Winst</span>
                  <span className="font-semibold text-primary">{fmtEuro(detail.cumulative.netProfit)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border/60 pt-2 mt-2">
                  <span className="text-muted-foreground font-semibold text-accent-foreground">Bankbalans (geschat)</span>
                  <span className="font-semibold text-accent-foreground">{fmtEuro(detail.cumulative.bankBalance)}</span>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
        )}
      </div>

      <div className="space-y-6">
        {view === 'input' && (
        <div className="rounded-2xl border bg-card p-6">
          <h3 className="serif text-3xl text-primary mb-2">Lessen & ingeschreven leden</h3>
          <p className="text-sm text-muted-foreground mb-6">Vul per les in hoeveel leden ervoor staan ingeschreven. Dit is de vaste lesbezetting, niet de daadwerkelijke opkomst per lesmoment. Het exacte aantal gegeven lessen kun je optioneel aanpassen.</p>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <th className="pb-3 font-semibold">Rooster en les</th>
                  <th className="pb-3 font-semibold text-right">Ingeschreven leden</th>
                  <th className="pb-3 font-semibold text-right">Aantal lessen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {lessonProfitability.map((lp) => {
                  const inputIdx = form.lessonInputs.findIndex(i => i.lessonId === lp.lessonId);
                  const input = inputIdx >= 0 ? form.lessonInputs[inputIdx] : { lessonId: lp.lessonId, attendance: null, lessonCountOverride: null };
                  const attendanceSourceMonth = inheritedAttendanceMonths.get(lp.lessonId);
                  const schedule = lessonScheduleById.get(lp.lessonId);
                  
                  return (
                    <tr key={lp.lessonId} className="transition-colors">
                      <td className="py-3 font-medium text-primary">
                        {schedule ? (
                          <div className="space-y-0.5">
                            <div className="font-semibold">{WEEKDAY_LABELS[schedule.weekday] ?? 'Onbekende dag'} · {schedule.startTime}</div>
                            <div className="text-sm font-normal text-muted-foreground">{lp.lessonName}</div>
                          </div>
                        ) : lp.lessonName}
                      </td>
                      <td className="py-3 text-right align-top">
                        <input type="number" min="0" placeholder="Aantal leden" aria-label={`Ingeschreven leden voor ${lp.lessonName}`} value={input.attendance ?? ''} onChange={e => {
                          const copy = [...form.lessonInputs];
                          if (inputIdx >= 0) copy[inputIdx] = { ...copy[inputIdx], attendance: e.target.value ? parseInt(e.target.value) : null };
                          else copy.push({ ...input, attendance: e.target.value ? parseInt(e.target.value) : null });
                          setForm({...form, lessonInputs: copy});
                          setInheritedAttendanceMonths(current => {
                            const next = new Map(current);
                            next.delete(lp.lessonId);
                            return next;
                          });
                        }} className={`h-8 w-24 rounded border px-2 text-xs outline-none ml-auto ${attendanceSourceMonth ? 'border-accent/50 bg-accent/5 focus:border-accent' : 'border-input bg-background focus:border-accent'}`} data-testid={`input-attendance-${lp.lessonId}`} />
                        {attendanceSourceMonth && (
                          <span className="mt-1 block text-[10px] leading-tight text-muted-foreground">
                            Overgenomen uit {new Date(attendanceSourceMonth).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <input type="number" min="0" placeholder={`Std: ${lp.autoCount}`} value={input.lessonCountOverride ?? ''} onChange={e => {
                          const copy = [...form.lessonInputs];
                          if (inputIdx >= 0) copy[inputIdx] = { ...copy[inputIdx], lessonCountOverride: e.target.value ? parseInt(e.target.value) : null };
                          else copy.push({ ...input, lessonCountOverride: e.target.value ? parseInt(e.target.value) : null });
                          setForm({...form, lessonInputs: copy});
                        }} className="h-8 w-24 rounded border border-input bg-background px-2 text-xs outline-none focus:border-accent ml-auto" data-testid={`input-override-${lp.lessonId}`} />
                      </td>
                    </tr>
                  );
                })}
                {(!detail?.lessonProfitability || detail.lessonProfitability.length === 0) && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-muted-foreground italic">Geen lessen actief in deze maand.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
             <button onClick={handleSave} disabled={saving} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-50">
               <Save className="size-3.5" /> Opslaan
             </button>
          </div>
        </div>
        )}

        {view === 'results' && getSeason.data?.lessonSeasonForecast && (
          <LessonSeasonForecast
            forecast={getSeason.data.lessonSeasonForecast}
            selectedMonth={month}
            lessons={getSeason.data.lessons}
            onSelectMonth={onSelectMonth}
          />
        )}
        {view === 'results' && <CostCategoryTrends trends={getSeason.data?.costTrends ?? []} />}
      </div>
      </div>
      }

      {view === 'costs' && (
        <form onSubmit={handleSave} className="space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 ref={setAutomaticCloseFocusTarget} tabIndex={-1} className="serif text-3xl text-primary">Kosten {new Date(month).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Voeg kostenregels inclusief btw toe en geef aan hoe vaak ze terugkomen.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {previousCosts.length > 0 && !copiedPreviousCosts && (
                <button type="button" onClick={() => setCopyDialogOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-input bg-background px-4 text-xs font-semibold text-primary hover:bg-secondary/30">
                  <Copy className="size-3.5" /> Vorige maand overnemen
                </button>
              )}
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Totaal</p>
                <p className="text-xl font-semibold text-primary">{fmtEuro(fixedCostTotal)}</p>
              </div>
              <button type="submit" disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-financial-costs">
                <Save className="size-3.5" /> {saving ? 'Opslaan...' : 'Opslaan'}
              </button>
            </div>
          </div>

          <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Kosten uit vorige maand overnemen?</DialogTitle>
                <DialogDescription>
                  De maandelijkse regels uit {detail?.previousMonth ? new Date(detail.previousMonth).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }) : 'de vorige maand'} worden toegevoegd. Eenmalige en jaarlijkse kosten worden niet meegenomen. Je huidige {form.fixedCosts.length === 1 ? 'regel blijft' : `${form.fixedCosts.length} regels blijven`} ongewijzigd.
                </DialogDescription>
              </DialogHeader>
              <div className="divide-y rounded-lg border">
                {previousCosts.map((cost, index) => (
                  <div key={`${cost.group}-${cost.description}-${index}`} className="flex items-start justify-between gap-4 p-3 text-sm">
                    <div>
                      <p className="font-medium text-primary">{cost.description}</p>
                      <p className="text-xs text-muted-foreground">{cost.group}</p>
                    </div>
                    <span className="shrink-0 font-semibold text-primary">{fmtEuro(cost.amount)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Na het toevoegen kun je elke gekopieerde regel aanpassen of verwijderen voordat je opslaat.</p>
              <DialogFooter>
                <button type="button" onClick={() => setCopyDialogOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-input px-4 text-sm font-semibold">Annuleren</button>
                <button type="button" onClick={copyPreviousCosts} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  <Copy className="size-4" /> {previousCosts.length} {previousCosts.length === 1 ? 'regel toevoegen' : 'regels toevoegen'}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="grid gap-3">
            {COST_GROUPS.map((group) => {
              const rows = form.fixedCosts.map((cost, index) => ({ cost, index })).filter(({ cost }) => cost.group === group);
              const subtotal = rows.reduce((sum, { cost }) => sum + cost.amount, 0);
              const isOpen = expandedCostGroup === group || rows.length > 0;
              return (
                <section key={group} className="overflow-hidden rounded-xl border bg-card">
                  <button type="button" onClick={() => setExpandedCostGroup(expandedCostGroup === group ? null : group)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-secondary/20" data-testid={`button-cost-group-${group}`}>
                    <span className="flex items-center gap-3">
                      <ChevronDown className={`size-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      <span>
                        <span className="block text-sm font-semibold text-primary">{group}</span>
                        <span className="block text-xs text-muted-foreground">{rows.length === 0 ? 'Geen regels' : `${rows.length} ${rows.length === 1 ? 'regel' : 'regels'}`}</span>
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-primary">{fmtEuro(subtotal)}</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 border-t border-border/60 p-4">
                      {rows.map(({ cost, index }) => (
                        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto]">
                          <input required value={cost.description} onChange={e => { const copy = [...form.fixedCosts]; copy[index] = { ...copy[index], description: e.target.value }; setForm({...form, fixedCosts: copy}); }} className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Omschrijving, bijv. Spotify" />
                          <select value={cost.frequency} onChange={e => { const copy = [...form.fixedCosts]; copy[index] = { ...copy[index], frequency: e.target.value as typeof cost.frequency }; setForm({...form, fixedCosts: copy}); }} className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" aria-label={`Frequentie van ${cost.description || group}`}>
                            <option value="monthly">Maandelijks</option>
                            <option value="yearly">Jaarlijks</option>
                            <option value="one_time">Eenmalig</option>
                          </select>
                          <FinancialNumberInput required min="0" step="0.01" value={cost.amount} onValueChange={amount => { const copy = [...form.fixedCosts]; copy[index] = { ...copy[index], amount }; setForm({...form, fixedCosts: copy}); }} className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Bedrag incl. btw" aria-label={`Bedrag inclusief btw van ${cost.description || group}`} />
                          <button type="button" onClick={() => { const copy = [...form.fixedCosts]; copy.splice(index, 1); setForm({...form, fixedCosts: copy}); }} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10" aria-label={`Verwijder kostenregel ${cost.description || group}`}><Trash2 className="size-4" /></button>
                        </div>
                      ))}
                      <button type="button" onClick={() => { setForm({...form, fixedCosts: [...form.fixedCosts, { group, description: '', frequency: 'one_time', amount: 0 }]}); setExpandedCostGroup(group); }} className="inline-flex items-center gap-2 text-xs font-semibold text-accent-foreground hover:underline">
                        <Plus className="size-3.5" /> Regel toevoegen
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </form>
      )}
    </div>
  );
}
