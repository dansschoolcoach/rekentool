import { useState, useMemo, useEffect, useRef, type FormEvent } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  useGetFinancialSeason, 
  useUpdateFinancialSeason, 
  useCreateFinancialSeason,
  useGetAdminFinancialSeason,
  useUpdateAdminFinancialSeason,
  useCreateAdminFinancialSeason,
  getGetAdminFinancialSeasonQueryKey,
  getGetAdminFinancialSeasonsQueryKey,
  getGetFinancialSeasonQueryKey,
  getGetFinancialSeasonsQueryKey,
  type FinancialSeasonInput,
  type FinancialSeasonCountry,
  type FinancialSeasonDetail,
  type FinancialLessonInput,
  type FinancialTeacherInput,
  type FinancialLocationInput,
  type FinancialSubscriptionInput,
  type FinancialClosureInput,
  ApiError,
} from '@workspace/api-client-react';
import { AlertTriangle, Info, Plus, Trash2, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FinancialNumberInput } from './FinancialNumberInput';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { financialSaveError } from './financialSaveError';

const newClientId = () => crypto.randomUUID();
const SEASON_DRAFT_SAVE_DELAY_MS = 300;
const SEASON_FRESHNESS_CHECK_INTERVAL_MS = 60_000;
const relationValue = (id?: number | null, clientId?: string | null) =>
  id != null ? `id:${id}` : clientId ? `client:${clientId}` : '';

const paymentLabels: Record<FinancialSubscriptionInput['paymentFrequency'], string> = {
  monthly: 'Per maand',
  four_weekly: 'Per 4 weken',
  quarterly: 'Per kwartaal',
  half_yearly: 'Per halfjaar',
  yearly: 'Per jaar',
  installments: 'In termijnen',
  one_time: 'Eenmalig',
};

function SectionSaveButton({ label, saving, testId }: { label: string; saving: boolean; testId: string }) {
  return (
    <div className="flex justify-end pt-2">
      <button
        type="submit"
        disabled={saving}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary/20 bg-background px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
        data-testid={testId}
      >
        <Save className="size-4" />
        {saving ? 'Bezig met opslaan...' : `${label} opslaan`}
      </button>
    </div>
  );
}

function subscriptionPriceLabel(subscription: FinancialSubscriptionInput) {
  if (subscription.productType === 'punch_card') return 'Kaartprijs';
  if (subscription.paymentFrequency === 'installments') return 'Totale prijs';
  return `Prijs ${paymentLabels[subscription.paymentFrequency].toLowerCase()}`;
}

function lessonLocationLabel(
  location: FinancialLocationInput,
  index: number,
  locations: FinancialLocationInput[],
) {
  const name = location.name || 'Nieuwe locatie';
  const hasDuplicateName = location.name.trim() !== ''
    && locations.filter(candidate => candidate.name.trim() === location.name.trim()).length > 1;
  if (!hasDuplicateName) return name;
  return `${name} (${location.id != null ? `locatie ${location.id}` : `nieuwe locatie ${index + 1}`})`;
}

function lessonTeacherLabel(
  teacher: FinancialTeacherInput,
  index: number,
  teachers: FinancialTeacherInput[],
) {
  const name = teacher.name || 'Nieuwe docent';
  const hasDuplicateName = teacher.name.trim() !== ''
    && teachers.filter(candidate => candidate.name.trim() === teacher.name.trim()).length > 1;
  if (!hasDuplicateName) return name;
  return `${name} (${teacher.id != null ? `docent ${teacher.id}` : `nieuwe docent ${index + 1}`})`;
}

const euroFormatter = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });

export function createSeasonTemplate(
  source: FinancialSeasonDetail,
  createClientId: () => string = newClientId,
): FinancialSeasonInput {
  const teacherClientIds = new Map(source.teachers.map(teacher => [teacher.id, createClientId()]));
  const locationClientIds = new Map(source.locations.map(location => [location.id, createClientId()]));

  return {
    name: '',
    startDate: '',
    endDate: '',
    country: source.country,
    hasStarterDeduction: false,
    defaultSalary: source.defaultSalary,
    teachers: source.teachers.map(teacher => ({
      clientId: teacherClientIds.get(teacher.id)!,
      name: teacher.name,
      hourlyRate: teacher.hourlyRate,
      weeklyTravel: teacher.weeklyTravel,
    })),
    locations: source.locations.map(location => ({
      clientId: locationClientIds.get(location.id)!,
      name: location.name,
      rentFrequency: location.rentFrequency,
      rent: location.rent,
      rentTermCount: location.rentTermCount,
      sessionMinutes: location.sessionMinutes,
    })),
    subscriptions: source.subscriptions.map(subscription => ({
      name: subscription.name,
      audience: subscription.audience,
      productType: subscription.productType,
      paymentFrequency: subscription.paymentFrequency,
      price: subscription.price,
      installmentCount: subscription.installmentCount,
      durationMonths: subscription.durationMonths,
      rideCount: subscription.rideCount,
      validityMonths: subscription.validityMonths,
      vatRate: subscription.vatRate,
    })),
    lessons: source.lessons.map(lesson => ({
      name: lesson.name,
      teacherId: null,
      teacherClientId: lesson.teacherId == null ? null : teacherClientIds.get(lesson.teacherId) ?? null,
      locationId: null,
      locationClientId: lesson.locationId == null ? null : locationClientIds.get(lesson.locationId) ?? null,
      weekday: lesson.weekday,
      startTime: lesson.startTime,
      durationMinutes: lesson.durationMinutes,
      activeFrom: '',
      activeUntil: '',
    })),
    closures: [],
  };
}

type SeasonEditorProps = {
  seasonId?: number; 
  templateSeasonId?: number;
  defaultCountry?: string;
  initialFieldsOnly?: boolean;
  onSaved: (id: number) => void;
};

type SeasonEditorQuery = {
  data?: FinancialSeasonDetail;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<{ data?: FinancialSeasonDetail }>;
};

type SeasonEditorMutation = {
  isPending: boolean;
  mutate: (variables: any, options?: any) => void;
};

type SeasonEditorFormProps = SeasonEditorProps & {
  getSeason: SeasonEditorQuery;
  updateSeason: SeasonEditorMutation;
  createSeason: SeasonEditorMutation;
  seasonsQueryKey: readonly unknown[];
  seasonQueryKey: (seasonId: number) => readonly unknown[];
  adminParticipantId?: number;
  draftOwnerKey: string;
};

const SEASON_DRAFT_STORAGE_PREFIX = 'byb:financial-season-draft:v2';

type SeasonDraft = {
  form: FinancialSeasonInput;
  expectedUpdatedAt?: string;
  savedAt?: string;
  reason?: 'conflict';
};

function seasonDraftStorageKey(ownerKey: string, seasonId?: number, templateSeasonId?: number) {
  const seasonKey = seasonId != null
    ? `season:${seasonId}`
    : templateSeasonId != null
      ? `new-from:${templateSeasonId}`
      : 'new';
  return `${SEASON_DRAFT_STORAGE_PREFIX}:${ownerKey}:${seasonKey}`;
}

function readSeasonDraft(key: string): SeasonDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value?.form
      && typeof value.form === 'object'
      && Array.isArray(value.form.teachers)
      && Array.isArray(value.form.locations)
      ? value as SeasonDraft
      : null;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // The editor remains usable when browser storage is unavailable.
    }
    return null;
  }
}

function writeSeasonDraft(key: string, draft: SeasonDraft) {
  const savedDraft = {
    ...draft,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(savedDraft));
    return savedDraft;
  } catch {
    // Saving to the server must remain available when local storage is blocked or full.
    return null;
  }
}

function formatDraftTimestamp(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function removeSeasonDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

function seasonDetailToInput(season: FinancialSeasonDetail): FinancialSeasonInput {
  return {
    name: season.name,
    startDate: season.startDate.slice(0, 10),
    endDate: season.endDate.slice(0, 10),
    country: season.country,
    hasStarterDeduction: season.hasStarterDeduction,
    defaultSalary: season.defaultSalary,
    teachers: season.teachers.map(teacher => ({ ...teacher })),
    locations: season.locations.map(location => ({ ...location })),
    subscriptions: season.subscriptions.map(subscription => ({ ...subscription })),
    lessons: season.lessons.map(lesson => ({
      ...lesson,
      activeFrom: lesson.activeFrom.slice(0, 10),
      activeUntil: lesson.activeUntil.slice(0, 10),
    })),
    closures: season.closures.map(closure => ({
      ...closure,
      startDate: closure.startDate.slice(0, 10),
      endDate: closure.endDate.slice(0, 10),
    })),
  };
}

function initialSeasonFields(form: FinancialSeasonInput): FinancialSeasonInput {
  return {
    ...structuredClone(form),
    hasStarterDeduction: false,
    defaultSalary: 0,
    teachers: [],
    locations: [],
    subscriptions: [],
    lessons: [],
    closures: [],
  };
}

/**
 * The admin page deliberately has its own hook branch. Keeping the branch
 * outside the form means an admin render never even creates a participant
 * mutation hook (and therefore cannot accidentally call that endpoint).
 */
export function SeasonEditor(props: SeasonEditorProps & { adminParticipantId?: number }) {
  if (props.adminParticipantId != null) {
    return <AdminSeasonEditor {...props} participantId={props.adminParticipantId} />;
  }
  return <ParticipantSeasonEditor {...props} />;
}

function ParticipantSeasonEditor(props: SeasonEditorProps) {
  const { userId } = useAuth();
  const getSeason = useGetFinancialSeason(props.seasonId ?? props.templateSeasonId!, {
    query: {
      enabled: props.seasonId != null || props.templateSeasonId != null,
      queryKey: getGetFinancialSeasonQueryKey(props.seasonId ?? props.templateSeasonId!),
    },
  });
  const update = useUpdateFinancialSeason();
  const create = useCreateFinancialSeason();
  return (
    <SeasonEditorForm
      {...props}
      getSeason={getSeason}
      updateSeason={update}
      createSeason={create}
      seasonsQueryKey={getGetFinancialSeasonsQueryKey()}
      seasonQueryKey={getGetFinancialSeasonQueryKey}
      draftOwnerKey={`participant:${userId ?? 'signed-out'}`}
    />
  );
}

function AdminSeasonEditor({ participantId, ...props }: SeasonEditorProps & { participantId: number }) {
  const sourceSeasonId = props.seasonId ?? props.templateSeasonId;
  const getSeason = useGetAdminFinancialSeason(participantId, sourceSeasonId!, {
    query: {
      enabled: sourceSeasonId != null,
      queryKey: getGetAdminFinancialSeasonQueryKey(participantId, sourceSeasonId!),
    },
  });
  const update = useUpdateAdminFinancialSeason();
  const create = useCreateAdminFinancialSeason();
  const updateSeason: SeasonEditorMutation = {
    isPending: update.isPending,
    mutate: (variables, options) => update.mutate({
      participantId,
      seasonId: variables.seasonId,
      data: variables.data,
    }, options),
  };
  const createSeason: SeasonEditorMutation = {
    isPending: create.isPending,
    mutate: (variables, options) => create.mutate({ participantId, data: variables.data }, options),
  };
  return (
    <SeasonEditorForm
      {...props}
      getSeason={getSeason}
      updateSeason={updateSeason}
      createSeason={createSeason}
      seasonsQueryKey={getGetAdminFinancialSeasonsQueryKey(participantId)}
      seasonQueryKey={seasonId => getGetAdminFinancialSeasonQueryKey(participantId, seasonId)}
      adminParticipantId={participantId}
      draftOwnerKey={`admin-participant:${participantId}`}
    />
  );
}

function SeasonEditorForm({
  seasonId,
  templateSeasonId,
  defaultCountry,
  onSaved,
  getSeason,
  updateSeason,
  createSeason,
  seasonsQueryKey,
  seasonQueryKey,
  adminParticipantId,
  draftOwnerKey,
  initialFieldsOnly = false,
}: SeasonEditorFormProps) {
  const isNew = !seasonId;
  const sourceSeasonId = seasonId ?? templateSeasonId;
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setStoredForm] = useState<FinancialSeasonInput>({
    name: '',
    startDate: '',
    endDate: '',
    country: (defaultCountry === 'België' ? 'België' : 'Nederland') as any,
    hasStarterDeduction: false,
    defaultSalary: 0,
    teachers: [],
    locations: [],
    subscriptions: [],
    lessons: [],
    closures: []
  });
  const [confirmRentConflicts, setConfirmRentConflicts] = useState(false);
  const [availableDraft, setAvailableDraft] = useState<SeasonDraft | null>(null);
  const [latestServerSeason, setLatestServerSeason] = useState<FinancialSeasonDetail | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'idle' | 'waiting' | 'saved' | 'error'>('idle');

  const initializedForId = useRef<number | null | string>(null);
  const initializedFormJson = useRef('');
  const hasUserEditedForm = useRef(false);
  const draftExpectedUpdatedAt = useRef<string | undefined>(undefined);
  const pendingDraftSave = useRef<{ key: string; draft: SeasonDraft } | null>(null);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestForm = useRef(form);
  latestForm.current = form;
  const draftStorageKey = useMemo(
    () => seasonDraftStorageKey(draftOwnerKey, seasonId, templateSeasonId),
    [draftOwnerKey, seasonId, templateSeasonId],
  );

  function initializeForm(nextForm: FinancialSeasonInput, expectedUpdatedAt?: string) {
    initializedFormJson.current = JSON.stringify(nextForm);
    hasUserEditedForm.current = false;
    draftExpectedUpdatedAt.current = expectedUpdatedAt;
    setStoredForm(nextForm);
    setAvailableDraft(readSeasonDraft(draftStorageKey));
    setDraftSaveStatus('idle');
  }

  function setForm(nextForm: FinancialSeasonInput) {
    hasUserEditedForm.current = true;
    setStoredForm(nextForm);
  }

  function cancelPendingDraftSave() {
    if (draftSaveTimer.current != null) {
      clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    pendingDraftSave.current = null;
  }

  function flushPendingDraftSave() {
    if (draftSaveTimer.current != null) {
      clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    const pending = pendingDraftSave.current;
    if (!pending) return;
    pendingDraftSave.current = null;
    const saved = writeSeasonDraft(pending.key, pending.draft);
    setDraftSaveStatus(saved ? 'saved' : 'error');
  }
  
  useEffect(() => {
    if (isNew) {
      const initializationKey = templateSeasonId == null
        ? `new:${adminParticipantId ?? 'participant'}`
        : `new:${adminParticipantId ?? 'participant'}:${templateSeasonId}`;
      if (templateSeasonId != null && !getSeason.data) return;
      if (initializedForId.current !== initializationKey) {
        initializedForId.current = initializationKey;
        if (getSeason.data) {
          initializeForm(createSeasonTemplate(getSeason.data), getSeason.data.updatedAt);
          return;
        }
        initializeForm({
          name: '',
          startDate: '',
          endDate: '',
          country: (defaultCountry === 'België' ? 'België' : 'Nederland') as any,
          hasStarterDeduction: false,
          defaultSalary: 0,
          teachers: [],
          locations: [],
          subscriptions: [],
          lessons: [],
          closures: []
        });
      }
    } else if (getSeason.data && initializedForId.current !== `${adminParticipantId ?? 'participant'}:${seasonId}`) {
      initializedForId.current = `${adminParticipantId ?? 'participant'}:${seasonId}`;
      setLatestServerSeason(getSeason.data);
      initializeForm(seasonDetailToInput(getSeason.data), getSeason.data.updatedAt);
    }
  }, [isNew, getSeason.data, seasonId, templateSeasonId, defaultCountry, adminParticipantId, draftStorageKey]);

  useEffect(() => {
    if (isNew || seasonId == null) return;
    let freshnessCheckPending = false;

    const checkFreshness = async () => {
      if (freshnessCheckPending) return;
      freshnessCheckPending = true;
      try {
        const result = await getSeason.refetch();
        const refreshedSeason = result.data;
        const editorRevision = draftExpectedUpdatedAt.current;
        if (!refreshedSeason?.updatedAt || !editorRevision || refreshedSeason.updatedAt === editorRevision) return;

        setLatestServerSeason(refreshedSeason);
        const localDraft = {
          form: structuredClone(latestForm.current),
          expectedUpdatedAt: editorRevision,
        };
        cancelPendingDraftSave();
        const savedDraft = writeSeasonDraft(draftStorageKey, localDraft);
        setDraftSaveStatus(savedDraft ? 'saved' : 'error');
        if (savedDraft) setAvailableDraft(savedDraft);
      } finally {
        freshnessCheckPending = false;
      }
    };
    const checkOnFocus = () => void checkFreshness();
    const interval = window.setInterval(checkFreshness, SEASON_FRESHNESS_CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkOnFocus);
    };
  }, [draftStorageKey, getSeason, isNew, seasonId]);

  useEffect(() => {
    if (!initializedFormJson.current || !hasUserEditedForm.current) return;
    if (JSON.stringify(form) === initializedFormJson.current) {
      cancelPendingDraftSave();
      removeSeasonDraft(draftStorageKey);
      setDraftSaveStatus('idle');
      return;
    }
    if (draftSaveTimer.current != null) clearTimeout(draftSaveTimer.current);
    pendingDraftSave.current = {
      key: draftStorageKey,
      draft: {
        form,
        expectedUpdatedAt: draftExpectedUpdatedAt.current,
      },
    };
    setDraftSaveStatus('waiting');
    draftSaveTimer.current = setTimeout(flushPendingDraftSave, SEASON_DRAFT_SAVE_DELAY_MS);
  }, [draftStorageKey, form]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushPendingDraftSave();
    };
    window.addEventListener('pagehide', flushPendingDraftSave);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flushPendingDraftSave);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      flushPendingDraftSave();
    };
  }, []);

  const rentConflicts = useMemo(() => {
    if (isNew || !getSeason.data) return [];
    const historicalRentByLocation = new Map(
      getSeason.data.lessonSeasonForecast.locationRentBreakdowns.map(location => [
        location.locationId,
        location.previouslyAllocatedCost,
      ]),
    );
    return form.locations.flatMap(location => {
      if (location.id == null || location.rentFrequency !== 'month' || location.rentTermCount == null) return [];
      const previouslyAllocatedCost = historicalRentByLocation.get(location.id) ?? 0;
      const contractTotal = Math.round(location.rent * location.rentTermCount * 100) / 100;
      return previouslyAllocatedCost > contractTotal
        ? [{ locationId: location.id, locationName: location.name, previouslyAllocatedCost, contractTotal }]
        : [];
    });
  }, [form.locations, getSeason.data, isNew]);

  const disappearingMonthlyRentConflicts = useMemo(() => {
    if (isNew || !getSeason.data) return [];
    const currentLocationsById = new Map(
      form.locations.flatMap(location => location.id == null ? [] : [[location.id, location] as const]),
    );
    const historicalRentByLocation = new Map(
      getSeason.data.lessonSeasonForecast.locationRentBreakdowns.map(location => [
        location.locationId,
        location.previouslyAllocatedCost,
      ]),
    );

    return getSeason.data.locations.flatMap(location => {
      if (location.id == null || location.rentFrequency !== 'month') return [];
      const previouslyAllocatedCost = historicalRentByLocation.get(location.id) ?? 0;
      if (previouslyAllocatedCost <= 0) return [];
      const currentLocation = currentLocationsById.get(location.id);
      if (currentLocation?.rentFrequency === 'month') return [];

      return [{
        locationId: location.id,
        locationName: currentLocation?.name ?? location.name,
        previouslyAllocatedCost,
        change: currentLocation == null ? 'removed' as const : 'frequency' as const,
      }];
    });
  }, [form.locations, getSeason.data, isNew]);

  const hasRentConflicts = rentConflicts.length > 0 || disappearingMonthlyRentConflicts.length > 0;

  useEffect(() => {
    setConfirmRentConflicts(false);
  }, [form.locations]);

  if (sourceSeasonId != null && getSeason.isLoading) {
    return <div className="p-10 text-center text-muted-foreground animate-pulse">Stamgegevens laden...</div>;
  }

  if (sourceSeasonId != null && getSeason.isError) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-6">
        <p className="font-semibold text-destructive">De stamgegevens van het vorige seizoen konden niet worden geladen.</p>
        <p className="mt-2 text-sm text-muted-foreground">Er is nog niets overgenomen. Probeer het opnieuw voordat je het nieuwe seizoen inricht.</p>
        <button type="button" onClick={() => void getSeason.refetch()} className="mt-4 text-sm font-semibold text-primary underline underline-offset-4">
          Opnieuw proberen
        </button>
      </div>
    );
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (hasRentConflicts && !confirmRentConflicts) {
      setConfirmRentConflicts(true);
      return;
    }
    setConfirmRentConflicts(false);
    const submittedForm = isNew && initialFieldsOnly
      ? initialSeasonFields(form)
      : structuredClone(form);

    const acceptSuccessfulSave = (updatedAt?: string, nextDraftStorageKey = draftStorageKey) => {
      const nextExpectedUpdatedAt = updatedAt ?? draftExpectedUpdatedAt.current;
      cancelPendingDraftSave();
      removeSeasonDraft(draftStorageKey);
      initializedFormJson.current = JSON.stringify(submittedForm);
      draftExpectedUpdatedAt.current = nextExpectedUpdatedAt;
      const latestComparableForm = isNew && initialFieldsOnly
        ? initialSeasonFields(latestForm.current)
        : latestForm.current;
      hasUserEditedForm.current = JSON.stringify(latestComparableForm) !== initializedFormJson.current;
      if (hasUserEditedForm.current) {
        writeSeasonDraft(nextDraftStorageKey, {
          form: structuredClone(latestComparableForm),
          expectedUpdatedAt: nextExpectedUpdatedAt,
        });
      }
    };

    if (isNew) {
      createSeason.mutate({ data: submittedForm }, {
         onSuccess: (res: { id: number; updatedAt?: string }) => {
           acceptSuccessfulSave(
             res.updatedAt,
             seasonDraftStorageKey(draftOwnerKey, res.id),
           );
          qc.invalidateQueries({ queryKey: seasonsQueryKey });
          toast({ title: 'Seizoen aangemaakt', description: 'De stamgegevens zijn opgeslagen.' });
          onSaved(res.id);
        },
        onError: (error: unknown) => toast({ ...financialSaveError(error, 'de seizoenstamgegevens'), variant: 'destructive' })
      });
    } else {
      if (!getSeason.data) return;
      const loadedSeason = getSeason.data;
      updateSeason.mutate({ seasonId: seasonId!, data: { ...submittedForm, expectedUpdatedAt: draftExpectedUpdatedAt.current ?? loadedSeason.updatedAt } }, {
        onSuccess: (res?: { updatedAt?: string }) => {
           acceptSuccessfulSave(res?.updatedAt);
           qc.invalidateQueries({ queryKey: seasonsQueryKey });
           qc.invalidateQueries({ queryKey: seasonQueryKey(seasonId!) });
          toast({ title: 'Seizoen bijgewerkt', description: 'De stamgegevens zijn succesvol opgeslagen.' });
          onSaved(seasonId!);
        },
        onError: (error: unknown) => {
          if (error instanceof ApiError && error.status === 409) {
            const rejectedDraft = {
              form: structuredClone(submittedForm),
              expectedUpdatedAt: draftExpectedUpdatedAt.current ?? loadedSeason.updatedAt,
              reason: 'conflict' as const,
            };
            void getSeason.refetch()
              .then(result => {
                const refreshedSeason = result.data;
                const savedDraft = writeSeasonDraft(draftStorageKey, {
                  ...rejectedDraft,
                  expectedUpdatedAt: refreshedSeason?.updatedAt ?? rejectedDraft.expectedUpdatedAt,
                });

                if (refreshedSeason) {
                  setLatestServerSeason(refreshedSeason);
                  initializeForm(seasonDetailToInput(refreshedSeason), refreshedSeason.updatedAt);
                }
                setAvailableDraft(savedDraft);
                setDraftSaveStatus(savedDraft ? 'saved' : 'error');
              })
              .catch(() => {
                const savedDraft = writeSeasonDraft(draftStorageKey, rejectedDraft);
                setAvailableDraft(savedDraft);
                setDraftSaveStatus(savedDraft ? 'saved' : 'error');
              });
            toast({
              title: 'Seizoen intussen gewijzigd',
              description: 'De nieuwste stamgegevens worden geladen. Je afgewezen invoer blijft als concept bewaard; controleer de wijzigingen en probeer opnieuw.',
              variant: 'destructive',
            });
            return;
          }
          toast({ ...financialSaveError(error, 'de seizoenstamgegevens'), variant: 'destructive' });
        }
      });
    }
  }

  const saving = createSeason.isPending || updateSeason.isPending;
  const draftIsStale = availableDraft?.expectedUpdatedAt != null
    && latestServerSeason?.updatedAt != null
    && availableDraft.expectedUpdatedAt !== latestServerSeason.updatedAt;
  const draftSavedAtLabel = formatDraftTimestamp(availableDraft?.savedAt);
  const serverUpdatedAtLabel = formatDraftTimestamp(latestServerSeason?.updatedAt);

  return (
    <form onSubmit={handleSave} className="space-y-12">
      {draftSaveStatus !== 'idle' && (
        <p
          role="status"
          className={draftSaveStatus === 'error'
            ? 'text-xs text-destructive'
            : 'text-xs text-muted-foreground'}
          data-testid="season-draft-save-status"
        >
          {draftSaveStatus === 'waiting'
            ? 'Wijzigingen wachten om automatisch te worden bewaard.'
            : draftSaveStatus === 'saved'
              ? 'Concept automatisch bewaard in deze browser.'
              : 'Concept kon niet in deze browser worden bewaard. Je kunt de stamgegevens wel handmatig opslaan.'}
        </p>
      )}
      {availableDraft && (
        <div
          role="alert"
          className={draftIsStale
            ? 'rounded-xl border border-destructive/40 bg-destructive/10 p-4'
            : 'rounded-xl border border-accent/40 bg-accent/10 p-4'}
          data-testid="season-draft-notice"
        >
          <p className={draftIsStale ? 'font-semibold text-destructive' : 'font-semibold text-primary'}>
            {availableDraft.reason === 'conflict'
              ? 'Je afgewezen seizoenbewerking is bewaard'
              : draftIsStale
                ? 'Dit lokale concept is mogelijk verouderd'
                : 'Er staat nog een lokaal concept klaar'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {availableDraft.reason === 'conflict'
              ? 'De nieuwste opgeslagen stamgegevens staan in het formulier. Controleer welke toevoegingen en verwijderingen je opnieuw wilt toepassen, of herstel de afgewezen invoer om die opnieuw te bewerken.'
              : draftIsStale
                ? 'De opgeslagen stamgegevens zijn gewijzigd sinds dit concept is gemaakt. Je kunt het concept bewust bekijken en herstellen, of verwijderen om met de nieuwste opgeslagen gegevens verder te gaan.'
                : 'Herstel je onafgemaakte stamgegevens of verwijder het concept om met de laatst opgeslagen gegevens verder te gaan.'}
          </p>
          {draftIsStale && (
            <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
              <div>
                <dt className="inline font-medium text-foreground">Lokaal concept: </dt>
                <dd className="inline">
                  {draftSavedAtLabel
                    ? `bewaard op ${draftSavedAtLabel}`
                    : 'opslagtijd niet beschikbaar (ouder concept)'}
                </dd>
              </div>
              {serverUpdatedAtLabel && (
                <div>
                  <dt className="inline font-medium text-foreground">Opgeslagen gegevens: </dt>
                  <dd className="inline">gewijzigd op {serverUpdatedAtLabel}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                draftExpectedUpdatedAt.current = availableDraft.expectedUpdatedAt;
                setForm(availableDraft.form);
                setAvailableDraft(null);
              }}
              className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
              data-testid="button-restore-season-draft"
            >
              {availableDraft.reason === 'conflict' ? 'Afgewezen invoer herstellen' : 'Concept herstellen'}
            </button>
            <button
              type="button"
              onClick={() => {
                removeSeasonDraft(draftStorageKey);
                if (draftIsStale && latestServerSeason) {
                  initializeForm(seasonDetailToInput(latestServerSeason), latestServerSeason.updatedAt);
                } else {
                  setAvailableDraft(null);
                }
              }}
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-primary"
              data-testid="button-delete-season-draft"
            >
              Concept verwijderen
            </button>
          </div>
        </div>
      )}
      {isNew && templateSeasonId != null && !initialFieldsOnly && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm leading-6 text-primary" data-testid="season-template-notice">
          Docenten, locaties, abonnementen, tarieven en het lesrooster zijn overgenomen. Vul de nieuwe seizoensnaam en datums in en controleer de gegevens voordat je opslaat. Vakanties, sluitingsdagen en de keuze voor startersaftrek zijn niet overgenomen.
        </div>
      )}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-primary">Algemeen</h2>
          <p className="text-sm text-muted-foreground mt-1">De basisgegevens van dit financiële seizoen.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Naam seizoen</span>
            <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Bijv. 2025/2026" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Land</span>
            <select required value={form.country} onChange={e => setForm({...form, country: e.target.value as any})} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
              <option value="Nederland">Nederland</option>
              <option value="België">België</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Startdatum</span>
            <input required type="date" value={form.startDate} onChange={e => {
              const startDate = e.target.value;
              setForm({ ...form, startDate, lessons: form.lessons.map(lesson => !lesson.activeFrom || lesson.activeFrom === form.startDate ? { ...lesson, activeFrom: startDate } : lesson) });
            }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Einddatum</span>
            <input required type="date" value={form.endDate} onChange={e => {
              const endDate = e.target.value;
              setForm({ ...form, endDate, lessons: form.lessons.map(lesson => !lesson.activeUntil || lesson.activeUntil === form.endDate ? { ...lesson, activeUntil: endDate } : lesson) });
            }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
          </label>
          {!initialFieldsOnly && (
            <label className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bruto standaard maandsalaris (€)</span>
              <FinancialNumberInput required min="0" step="0.01" value={form.defaultSalary} onValueChange={defaultSalary => setForm({...form, defaultSalary})} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
            </label>
          )}
          {!initialFieldsOnly && form.country === 'Nederland' && (
            <div className="flex flex-row items-center gap-3 space-y-0 rounded-lg border p-4 bg-card mt-6">
              <input
                id="startersaftrek-checkbox"
                type="checkbox"
                checked={form.hasStarterDeduction}
                onChange={e => setForm({...form, hasStarterDeduction: e.target.checked})}
                className="size-4"
              />
              <label htmlFor="startersaftrek-checkbox" className="flex-1 cursor-pointer space-y-1">
                <p className="text-sm font-semibold text-primary">Startersaftrek toepassen</p>
                <p className="text-xs text-muted-foreground">Vink aan als je recht hebt op startersaftrek voor een lagere belastingreservering.</p>
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Meer informatie over startersaftrek"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="size-4" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  aria-label="Informatie over startersaftrek"
                  className="w-80 max-w-[calc(100vw-2rem)] text-sm leading-5"
                >
                  <p>Startersaftrek is een extra aftrekpost op je Nederlandse inkomstenbelasting. Je kunt deze meestal alleen toepassen als je aan het urencriterium voldoet, in ten minste één van de vijf voorafgaande jaren geen ondernemer was en de zelfstandigenaftrek in die vijf jaren niet meer dan twee keer hebt gebruikt.</p>
                  <p className="mt-2">Dit is geen definitieve beoordeling van je recht. Weet je het niet zeker? Laat de keuze uit en stem af met je accountant.</p>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
        <SectionSaveButton label="Algemeen" saving={saving} testId="button-save-season-general" />
      </div>

      {!initialFieldsOnly && (
        <>
      <div className="space-y-6 pt-6 border-t border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-primary">Docenten</h3>
            <p className="text-sm text-muted-foreground mt-1">Beheer uurtarieven en reiskosten.</p>
          </div>
          <button type="button" onClick={() => setForm({...form, teachers: [...form.teachers, { clientId: newClientId(), name: '', hourlyRate: 0, weeklyTravel: 0 }]})} className="inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground hover:underline"><Plus className="size-4" /> Toevoegen</button>
        </div>
        {form.teachers.length === 0 ? <p className="text-sm text-muted-foreground italic">Nog geen docenten toegevoegd.</p> : (
          <div className="grid gap-3">
            {form.teachers.map((teacher, i) => {
              const clientId = 'clientId' in teacher && typeof teacher.clientId === 'string' ? teacher.clientId : null;
              const fieldId = teacher.id != null ? `id-${teacher.id}` : clientId ? `client-${clientId}` : `index-${i}`;
              return (
              <div key={fieldId} className="grid gap-3 rounded-xl border border-border/60 bg-card/40 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_12rem_auto] sm:items-end">
                <label htmlFor={`teacher-name-${fieldId}`} className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Naam docent</span>
                  <input id={`teacher-name-${fieldId}`} required value={teacher.name} onChange={e => { const copy = [...form.teachers]; copy[i].name = e.target.value; setForm({...form, teachers: copy}); }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Bijv. Ninny" />
                </label>
                <label htmlFor={`teacher-rate-${fieldId}`} className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Uurtarief (€ incl. btw indien van toepassing)</span>
                  <FinancialNumberInput id={`teacher-rate-${fieldId}`} required min="0" step="0.5" value={teacher.hourlyRate} onValueChange={hourlyRate => { const copy = [...form.teachers]; copy[i].hourlyRate = hourlyRate; setForm({...form, teachers: copy}); }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                </label>
                <label htmlFor={`teacher-travel-${fieldId}`} className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Reiskosten per week (€ incl. btw)</span>
                  <FinancialNumberInput id={`teacher-travel-${fieldId}`} required min="0" step="0.5" value={teacher.weeklyTravel} onValueChange={weeklyTravel => { const copy = [...form.teachers]; copy[i].weeklyTravel = weeklyTravel; setForm({...form, teachers: copy}); }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                </label>
                <button type="button" onClick={() => {
                  const copy = [...form.teachers]; const [removed] = copy.splice(i, 1);
                  const lessons = form.lessons.map(lesson => lesson.teacherId === removed.id || lesson.teacherClientId === removed.clientId ? { ...lesson, teacherId: null, teacherClientId: null } : lesson);
                  setForm({...form, teachers: copy, lessons});
                }} className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10" aria-label={`Verwijder docent ${teacher.name || i + 1}`} title="Docent verwijderen"><Trash2 className="size-4" /></button>
              </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => setForm({...form, teachers: [...form.teachers, { clientId: newClientId(), name: '', hourlyRate: 0, weeklyTravel: 0 }]})}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-dashed border-accent/60 bg-accent/5 px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/10"
          data-testid="button-add-teacher-bottom"
        >
          <Plus className="size-4" /> Nieuwe docent toevoegen
        </button>
        <SectionSaveButton label="Docenten" saving={saving} testId="button-save-season-teachers" />
      </div>

      <div className="space-y-6 pt-6 border-t border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-primary">Locaties</h3>
            <p className="text-sm text-muted-foreground mt-1">Beheer huurkosten van je danszalen.</p>
          </div>
          <button type="button" onClick={() => setForm({...form, locations: [...form.locations, { clientId: newClientId(), name: '', rentFrequency: 'hour', rent: 0, rentTermCount: null, sessionMinutes: null }]})} className="inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground hover:underline"><Plus className="size-4" /> Toevoegen</button>
        </div>
        {form.locations.length === 0 ? <p className="text-sm text-muted-foreground italic">Nog geen locaties toegevoegd.</p> : (
          <div className="grid gap-3">
            {form.locations.map((loc, i) => {
              const clientId = 'clientId' in loc && typeof loc.clientId === 'string' ? loc.clientId : null;
              const fieldId = loc.id != null ? `id-${loc.id}` : clientId ? `client-${clientId}` : `index-${i}`;
              const hasDuplicateName = loc.name.trim() !== ''
                && form.locations.filter(location => location.name.trim() === loc.name.trim()).length > 1;
              const locationQualifier = hasDuplicateName
                ? ` (${loc.id != null ? `locatie ${loc.id}` : `nieuwe locatie ${i + 1}`})`
                : '';
              return (
                <div key={fieldId} className="grid gap-3 rounded-xl border border-border/60 bg-card/40 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_auto] lg:items-end">
                  <label htmlFor={`location-name-${fieldId}`} className="grid gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">Naam locatie{locationQualifier}</span>
                    <input id={`location-name-${fieldId}`} required value={loc.name} onChange={e => { const copy = [...form.locations]; copy[i].name = e.target.value; setForm({...form, locations: copy}); }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Bijv. Grote zaal" />
                  </label>
                  <label htmlFor={`location-frequency-${fieldId}`} className="grid gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">Huurfrequentie{locationQualifier}</span>
                    <select id={`location-frequency-${fieldId}`} required value={loc.rentFrequency} onChange={e => {
                      const rentFrequency = e.target.value as FinancialLocationInput['rentFrequency'];
                      const copy = [...form.locations];
                      copy[i] = {
                        ...copy[i],
                        rentFrequency,
                        rentTermCount: rentFrequency === 'month' ? copy[i].rentTermCount ?? 12 : null,
                        sessionMinutes: rentFrequency === 'session' ? copy[i].sessionMinutes : null,
                      };
                      setForm({...form, locations: copy});
                    }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
                      <option value="hour">Per uur</option>
                      <option value="month">Per maand</option>
                      <option value="session">Per sessie</option>
                    </select>
                  </label>
                  <label htmlFor={`location-rent-${fieldId}`} className="grid gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">Huurtarief (€ incl. btw){locationQualifier}</span>
                    <FinancialNumberInput id={`location-rent-${fieldId}`} required min="0" step="0.5" value={loc.rent} onValueChange={rent => { const copy = [...form.locations]; copy[i].rent = rent; setForm({...form, locations: copy}); }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                  </label>
                  {loc.rentFrequency === 'month' && (
                    <label htmlFor={`location-terms-${fieldId}`} className="grid gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Aantal huurtermijnen{locationQualifier}</span>
                      <input id={`location-terms-${fieldId}`} required type="number" min="1" step="1" value={loc.rentTermCount ?? ''} onChange={e => {
                        const copy = [...form.locations];
                        copy[i].rentTermCount = e.target.value ? Number(e.target.value) : null;
                        setForm({...form, locations: copy});
                      }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                    </label>
                  )}
                  {loc.rentFrequency === 'session' && (
                    <label htmlFor={`location-session-${fieldId}`} className="grid gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Sessieduur (minuten)</span>
                      <input id={`location-session-${fieldId}`} required type="number" min="1" value={loc.sessionMinutes || ''} onChange={e => { const copy = [...form.locations]; copy[i].sessionMinutes = parseInt(e.target.value) || null; setForm({...form, locations: copy}); }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                    </label>
                  )}
                  <button type="button" onClick={() => {
                    const copy = [...form.locations]; const [removed] = copy.splice(i, 1);
                    const lessons = form.lessons.map(lesson => lesson.locationId === removed.id || lesson.locationClientId === removed.clientId ? { ...lesson, locationId: null, locationClientId: null } : lesson);
                    setForm({...form, locations: copy, lessons});
                  }} className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10" aria-label={`Verwijder locatie ${loc.name || i + 1}${locationQualifier}`} title="Locatie verwijderen"><Trash2 className="size-4" /></button>
                </div>
              );
            })}
          </div>
        )}
        {rentConflicts.length > 0 && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="space-y-2">
                <p className="text-sm font-semibold">Het nieuwe huurcontract is lager dan de al opgeslagen zaalhuur.</p>
                <ul className="space-y-1 text-sm">
                  {rentConflicts.map(conflict => (
                    <li key={conflict.locationId}>
                      {conflict.locationName} (locatie {conflict.locationId}): {euroFormatter.format(conflict.previouslyAllocatedCost)} opgeslagen,
                      terwijl het nieuwe contract {euroFormatter.format(conflict.contractTotal)} bedraagt.
                    </li>
                  ))}
                </ul>
                <p className="text-xs">Opgeslagen maanden blijven ongewijzigd. Bij opslaan vragen we je om deze wijziging te bevestigen.</p>
              </div>
            </div>
          </div>
        )}
        {disappearingMonthlyRentConflicts.length > 0 && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="space-y-2">
                <p className="text-sm font-semibold">Historische maandhuur verdwijnt uit het huurcontract.</p>
                <ul className="space-y-1 text-sm">
                  {disappearingMonthlyRentConflicts.map(conflict => (
                    <li key={conflict.locationId}>
                      {conflict.locationName} (locatie {conflict.locationId}): {euroFormatter.format(conflict.previouslyAllocatedCost)} opgeslagen;
                      {conflict.change === 'removed'
                        ? ' de locatie wordt verwijderd.'
                        : ' de huurfrequentie wordt gewijzigd.'}
                    </li>
                  ))}
                </ul>
                <p className="text-xs">Opgeslagen maanden blijven ongewijzigd. De prognose gebruikt na opslaan de nieuwe locaties en huurfrequenties.</p>
              </div>
            </div>
          </div>
        )}
        <SectionSaveButton label="Locaties" saving={saving} testId="button-save-season-locations" />
      </div>

      <div className="space-y-6 pt-6 border-t border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-primary">Abonnementen & rittenkaarten</h3>
            <p className="text-sm text-muted-foreground mt-1">Leg het aanbod en betaalritme vast. De werkelijk ontvangen contributie vul je per maand in.</p>
          </div>
          <button type="button" onClick={() => setForm({...form, subscriptions: [...form.subscriptions, {
            name: '',
            audience: 'youth',
            productType: 'subscription',
            paymentFrequency: 'monthly',
            price: 0,
            installmentCount: null,
            durationMonths: null,
            rideCount: null,
            validityMonths: null,
            vatRate: 9,
          }]})} className="inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground hover:underline"><Plus className="size-4" /> Toevoegen</button>
        </div>
        {form.subscriptions.length === 0 ? <p className="text-sm text-muted-foreground italic">Nog geen abonnementen of rittenkaarten toegevoegd.</p> : (
          <div className="grid gap-3">
            {form.subscriptions.map((sub, i) => {
              const fieldId = sub.id != null ? `id-${sub.id}` : `index-${i}`;
              const updateSubscription = (changes: Partial<FinancialSubscriptionInput>) => {
                const copy = [...form.subscriptions];
                copy[i] = { ...copy[i], ...changes };
                setForm({ ...form, subscriptions: copy });
              };
              return (
                <div key={fieldId} className="rounded-xl border border-border/60 bg-card/40 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-primary">{sub.name || (sub.productType === 'punch_card' ? 'Nieuwe rittenkaart' : 'Nieuw abonnement')}</p>
                    <button type="button" onClick={() => { const copy = [...form.subscriptions]; copy.splice(i, 1); setForm({...form, subscriptions: copy}); }} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10" aria-label={`Verwijder ${sub.name || `aanbod ${i + 1}`}`} title="Aanbod verwijderen"><Trash2 className="size-4" /></button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label htmlFor={`subscription-name-${fieldId}`} className="grid gap-1.5 lg:col-span-2">
                      <span className="text-xs font-semibold text-muted-foreground">Naam</span>
                      <input id={`subscription-name-${fieldId}`} required value={sub.name} onChange={e => updateSubscription({ name: e.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Bijv. Jaarabonnement jeugd" />
                    </label>
                    <label htmlFor={`subscription-type-${fieldId}`} className="grid gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Soort</span>
                      <select id={`subscription-type-${fieldId}`} required value={sub.productType} onChange={e => {
                        const productType = e.target.value as FinancialSubscriptionInput['productType'];
                        updateSubscription(productType === 'punch_card'
                          ? { productType, paymentFrequency: 'one_time', installmentCount: null, durationMonths: null, rideCount: sub.rideCount ?? 10 }
                          : { productType, paymentFrequency: 'monthly', installmentCount: null, rideCount: null, validityMonths: null });
                      }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
                        <option value="subscription">Abonnement</option>
                        <option value="punch_card">Rittenkaart</option>
                      </select>
                    </label>
                    <label htmlFor={`subscription-audience-${fieldId}`} className="grid gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Doelgroep</span>
                      <select id={`subscription-audience-${fieldId}`} required value={sub.audience} onChange={e => updateSubscription({ audience: e.target.value as FinancialSubscriptionInput['audience'] })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
                        <option value="youth">Jeugd</option>
                        <option value="adult">Volwassen</option>
                      </select>
                    </label>

                    {sub.productType === 'subscription' && (
                      <label htmlFor={`subscription-frequency-${fieldId}`} className="grid gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">Betaalwijze</span>
                        <select id={`subscription-frequency-${fieldId}`} required value={sub.paymentFrequency} onChange={e => {
                          const paymentFrequency = e.target.value as FinancialSubscriptionInput['paymentFrequency'];
                          updateSubscription({
                            paymentFrequency,
                            installmentCount: paymentFrequency === 'installments' ? sub.installmentCount ?? 3 : null,
                          });
                        }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
                          {Object.entries(paymentLabels).filter(([value]) => value !== 'one_time').map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label htmlFor={`subscription-price-${fieldId}`} className="grid gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">{subscriptionPriceLabel(sub)} (€ incl. btw)</span>
                      <FinancialNumberInput id={`subscription-price-${fieldId}`} required min="0" step="0.5" value={sub.price} onValueChange={price => updateSubscription({ price })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                    </label>
                    {sub.productType === 'subscription' && sub.paymentFrequency === 'installments' && (
                      <label htmlFor={`subscription-installments-${fieldId}`} className="grid gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">Aantal termijnen</span>
                        <input id={`subscription-installments-${fieldId}`} required type="number" min="1" step="1" value={sub.installmentCount ?? ''} onChange={e => updateSubscription({ installmentCount: e.target.value ? Number(e.target.value) : null })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                      </label>
                    )}
                    {sub.productType === 'subscription' && (
                      <label htmlFor={`subscription-duration-${fieldId}`} className="grid gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">Looptijd in maanden</span>
                        <input id={`subscription-duration-${fieldId}`} type="number" min="1" step="1" value={sub.durationMonths ?? ''} onChange={e => updateSubscription({ durationMonths: e.target.value ? Number(e.target.value) : null })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Leeg = doorlopend" />
                      </label>
                    )}
                    {sub.productType === 'punch_card' && (
                      <label htmlFor={`subscription-rides-${fieldId}`} className="grid gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">Aantal ritten</span>
                        <input id={`subscription-rides-${fieldId}`} required type="number" min="1" step="1" value={sub.rideCount ?? ''} onChange={e => updateSubscription({ rideCount: e.target.value ? Number(e.target.value) : null })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                      </label>
                    )}
                    {sub.productType === 'punch_card' && (
                      <label htmlFor={`subscription-validity-${fieldId}`} className="grid gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">Geldig in maanden</span>
                        <input id={`subscription-validity-${fieldId}`} type="number" min="1" step="1" value={sub.validityMonths ?? ''} onChange={e => updateSubscription({ validityMonths: e.target.value ? Number(e.target.value) : null })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Leeg = onbeperkt" />
                      </label>
                    )}
                    <label htmlFor={`subscription-vat-${fieldId}`} className="grid gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Btw-tarief</span>
                      <select id={`subscription-vat-${fieldId}`} required value={sub.vatRate} onChange={e => updateSubscription({ vatRate: parseFloat(e.target.value) || 0 })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
                        <option value={0}>0% btw</option>
                        <option value={9}>9% btw</option>
                        <option value={21}>21% btw</option>
                      </select>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => setForm({...form, subscriptions: [...form.subscriptions, {
            name: '',
            audience: 'youth',
            productType: 'subscription',
            paymentFrequency: 'monthly',
            price: 0,
            installmentCount: null,
            durationMonths: null,
            rideCount: null,
            validityMonths: null,
            vatRate: 9,
          }]})}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-dashed border-accent/60 bg-accent/5 px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/10"
          data-testid="button-add-subscription-bottom"
        >
          <Plus className="size-4" /> Nieuw abonnement of rittenkaart toevoegen
        </button>
        <SectionSaveButton label="Aanbod" saving={saving} testId="button-save-season-subscriptions" />
      </div>

      <div className="space-y-6 pt-6 border-t border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-primary">Sluitingsweken</h3>
            <p className="text-sm text-muted-foreground mt-1">Geef aan wanneer er geen lessen zijn (bijv. vakanties).</p>
          </div>
          <button type="button" onClick={() => setForm({...form, closures: [...form.closures, { name: '', startDate: '', endDate: '' }]})} className="inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground hover:underline"><Plus className="size-4" /> Toevoegen</button>
        </div>
        {form.closures.length === 0 ? <p className="text-sm text-muted-foreground italic">Nog geen sluitingen toegevoegd.</p> : (
          <div className="grid gap-3">
            {form.closures.map((closure, i) => (
              <div key={i} className="flex gap-3 items-start flex-wrap sm:flex-nowrap">
                <input required value={closure.name} onChange={e => { const copy = [...form.closures]; copy[i].name = e.target.value; setForm({...form, closures: copy}); }} className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent min-w-[150px]" placeholder="Naam vakantie" />
                <input required type="date" value={closure.startDate} onChange={e => { const copy = [...form.closures]; copy[i].startDate = e.target.value; setForm({...form, closures: copy}); }} className="h-10 w-40 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                <input required type="date" value={closure.endDate} onChange={e => { const copy = [...form.closures]; copy[i].endDate = e.target.value; setForm({...form, closures: copy}); }} className="h-10 w-40 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                <button type="button" onClick={() => { const copy = [...form.closures]; copy.splice(i, 1); setForm({...form, closures: copy}); }} className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
        )}
        <SectionSaveButton label="Sluitingsweken" saving={saving} testId="button-save-season-closures" />
      </div>

      <div className="space-y-6 pt-6 border-t border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-primary">Lessen</h3>
            <p className="text-sm text-muted-foreground mt-1">Het lesrooster voor dit seizoen.</p>
          </div>
          <button type="button" onClick={() => setForm({...form, lessons: [...form.lessons, { name: '', teacherId: null, locationId: null, weekday: 1, startTime: '18:00', durationMinutes: 60, activeFrom: form.startDate || '', activeUntil: form.endDate || '' }]})} className="inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground hover:underline"><Plus className="size-4" /> Toevoegen</button>
        </div>
        {form.lessons.length === 0 ? <p className="text-sm text-muted-foreground italic">Nog geen lessen toegevoegd.</p> : (
          <div className="grid gap-4">
            {form.lessons.map((lesson, i) => (
              <div key={i} className="rounded-xl border bg-secondary/20 p-4 space-y-4">
                <div className="flex gap-3">
                  <input required value={lesson.name} onChange={e => { const copy = [...form.lessons]; copy[i].name = e.target.value; setForm({...form, lessons: copy}); }} className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" placeholder="Naam les (bijv. Hiphop 12+)" />
                  <button type="button" onClick={() => { const copy = [...form.lessons]; copy.splice(i, 1); setForm({...form, lessons: copy}); }} className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Docent</span>
                    <select value={relationValue(lesson.teacherId, lesson.teacherClientId)} onChange={e => {
                      const copy = [...form.lessons]; const value = e.target.value;
                      copy[i] = { ...copy[i], teacherId: value.startsWith('id:') ? Number(value.slice(3)) : null, teacherClientId: value.startsWith('client:') ? value.slice(7) : null };
                      setForm({...form, lessons: copy});
                    }} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-accent">
                      <option value="">Geen (Zelf)</option>
                      {form.teachers.map((teacher, teacherIndex) => (
                        <option key={relationValue(teacher.id, teacher.clientId)} value={relationValue(teacher.id, teacher.clientId)}>
                          {lessonTeacherLabel(teacher, teacherIndex, form.teachers)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Locatie</span>
                    <select value={relationValue(lesson.locationId, lesson.locationClientId)} onChange={e => {
                      const copy = [...form.lessons]; const value = e.target.value;
                      copy[i] = { ...copy[i], locationId: value.startsWith('id:') ? Number(value.slice(3)) : null, locationClientId: value.startsWith('client:') ? value.slice(7) : null };
                      setForm({...form, lessons: copy});
                    }} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-accent">
                      <option value="">Kies locatie</option>
                      {form.locations.map((location, locationIndex) => (
                        <option
                          key={relationValue(location.id, location.clientId)}
                          value={relationValue(location.id, location.clientId)}
                        >
                          {lessonLocationLabel(location, locationIndex, form.locations)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Dag</span>
                    <select value={lesson.weekday} onChange={e => { const copy = [...form.lessons]; copy[i].weekday = parseInt(e.target.value); setForm({...form, lessons: copy}); }} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-accent">
                      <option value={0}>Zondag</option>
                      <option value={1}>Maandag</option>
                      <option value={2}>Dinsdag</option>
                      <option value={3}>Woensdag</option>
                      <option value={4}>Donderdag</option>
                      <option value={5}>Vrijdag</option>
                      <option value={6}>Zaterdag</option>
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <label className="space-y-1 flex-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tijd</span>
                      <input type="time" required value={lesson.startTime} onChange={e => { const copy = [...form.lessons]; copy[i].startTime = e.target.value; setForm({...form, lessons: copy}); }} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-accent" />
                    </label>
                    <label className="space-y-1 w-20">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Minuten</span>
                      <input type="number" required min="1" value={lesson.durationMinutes} onChange={e => { const copy = [...form.lessons]; copy[i].durationMinutes = parseInt(e.target.value) || 60; setForm({...form, lessons: copy}); }} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-accent" />
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Actief vanaf</span>
                    <input type="date" required value={lesson.activeFrom} onChange={e => { const copy = [...form.lessons]; copy[i].activeFrom = e.target.value; setForm({...form, lessons: copy}); }} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-accent" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Actief tot</span>
                    <input type="date" required value={lesson.activeUntil} onChange={e => { const copy = [...form.lessons]; copy[i].activeUntil = e.target.value; setForm({...form, lessons: copy}); }} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-accent" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setForm({...form, lessons: [...form.lessons, { name: '', teacherId: null, locationId: null, weekday: 1, startTime: '18:00', durationMinutes: 60, activeFrom: form.startDate || '', activeUntil: form.endDate || '' }]})}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-dashed border-accent/60 bg-accent/5 px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/10"
          data-testid="button-add-lesson-bottom"
        >
          <Plus className="size-4" /> Nieuwe les toevoegen
        </button>
        <SectionSaveButton label="Lessen" saving={saving} testId="button-save-season-lessons" />
      </div>

      <div className="flex justify-end pt-8 border-t border-border/60">
        {confirmRentConflicts && hasRentConflicts ? (
          <div className="flex w-full flex-col items-end gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">
              {disappearingMonthlyRentConflicts.length > 0
                ? 'Wil je ondanks de verdwenen historische maandhuur doorgaan?'
                : 'Wil je ondanks de lagere contractwaarde doorgaan?'}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmRentConflicts(false)} className="inline-flex min-h-11 items-center rounded-lg border border-input bg-background px-4 text-sm font-semibold text-primary">
                Annuleren
              </button>
              <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                <Save className="size-4" /> {saving ? 'Bezig met opslaan...' : 'Toch opslaan'}
              </button>
            </div>
          </div>
        ) : (
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-50">
            <Save className="size-4" /> {saving ? 'Bezig met opslaan...' : 'Stamgegevens opslaan'}
          </button>
        )}
      </div>
        </>
      )}
    </form>
  );
}
