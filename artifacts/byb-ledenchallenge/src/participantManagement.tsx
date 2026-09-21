import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ApiError,
  getGetDashboardQueryKey,
  getGetLeaderboardQueryKey,
  getGetParticipantsQueryKey,
  ParticipantCountry,
  type Participant,
  type ParticipantImportPreview,
  useConfirmParticipantImport,
  useCreateParticipant,
  useDeleteParticipant,
  usePreviewParticipantImport,
  useUpdateParticipant,
} from '@workspace/api-client-react';
import {
  BarChart3,
  ClipboardCopy,
  Filter,
  Landmark,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { findEditableParticipant } from './editParticipant';

export const participantEmailConflictMessage = 'Er bestaat al een deelnemer met dit e-mailadres.';
export const participantVersionConflictMessage = 'Deze deelnemer is intussen door iemand anders gewijzigd. De actuele waarden zijn opnieuw geladen; controleer ze en sla daarna opnieuw op.';
export const participantInvalidEmailMessage = 'Vul een geldig e-mailadres in, bijvoorbeeld naam@domein.nl.';
const participantGeneralErrorMessage = 'Controleer de gegevens en probeer het opnieuw.';
const usableParticipantEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParticipantFormData = {
  schoolName: string;
  contactName: string;
  email: string;
  country: ParticipantCountry;
};

type ParticipantManagementFlowProps = {
  participants: Participant[];
  onOpenRegistration: (participant: Participant) => void;
  onOpenCoaching: (participantId: number) => void;
  onParticipantCreated: (participant: Participant) => void;
  onEditingChange?: (editingParticipantId: number | null) => void;
};

function mutationErrorMessage(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) return participantGeneralErrorMessage;
  if (
    error.data
    && typeof error.data === 'object'
    && 'currentParticipant' in error.data
  ) return participantVersionConflictMessage;
  return participantEmailConflictMessage;
}

export function ParticipantManagementFlow({
  participants,
  onOpenRegistration,
  onOpenCoaching,
  onParticipantCreated,
  onEditingChange,
}: ParticipantManagementFlowProps) {
  const [participantModal, setParticipantModal] = useState<Participant | 'new' | null>(null);
  const create = useCreateParticipant();
  const update = useUpdateParticipant();
  const remove = useDeleteParticipant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    onEditingChange?.(participantModal && participantModal !== 'new' ? participantModal.id : null);
  }, [onEditingChange, participantModal]);

  useEffect(() => {
    if (!participantModal || participantModal === 'new') return;
    if (!findEditableParticipant(participants, participantModal.id)) setParticipantModal(null);
  }, [participantModal, participants]);

  useEffect(() => {
    if (!create.error) return;
    toast({
      title: 'Deelnemer niet toegevoegd',
      description: mutationErrorMessage(create.error),
      variant: 'destructive',
    });
  }, [create.error, toast]);

  useEffect(() => {
    if (!update.error) return;
    toast({
      title: 'Deelnemer niet gewijzigd',
      description: mutationErrorMessage(update.error),
      variant: 'destructive',
    });
  }, [toast, update.error]);

  function invalidateParticipants() {
    void queryClient.invalidateQueries({ queryKey: getGetParticipantsQueryKey() });
  }

  function deleteParticipant(id: number) {
    if (!window.confirm('Deze deelnemer en het bijbehorende loginaccount definitief verwijderen?')) return;
    remove.mutate({ id }, {
      onSuccess: () => {
        invalidateParticipants();
        void queryClient.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
    });
  }

  function saveParticipant(data: ParticipantFormData) {
    if (participantModal === 'new') {
      create.mutate({ data }, {
        onSuccess: (participant) => {
          setParticipantModal(null);
          invalidateParticipants();
          toast({
            title: 'Deelnemer toegevoegd',
            description: 'De deelnemer kan nu zelf een account aanmaken met dit e-mailadres.',
          });
          onParticipantCreated(participant);
        },
      });
      return;
    }
    if (!participantModal) return;
    update.mutate({ id: participantModal.id, data: { ...data, revision: participantModal.revision } }, {
      onSuccess: () => {
        setParticipantModal(null);
        invalidateParticipants();
      },
      onError: (error) => {
        if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object' || !('currentParticipant' in error.data)) return;
        const currentParticipant = error.data.currentParticipant as Participant;
        setParticipantModal(currentParticipant);
        queryClient.setQueryData<Participant[]>(getGetParticipantsQueryKey(), (current = []) =>
          current.map((participant) => participant.id === currentParticipant.id ? currentParticipant : participant));
      },
    });
  }

  return (
    <>
      <ParticipantImportPanel onImported={invalidateParticipants} />
      <ParticipantsSection
        participants={participants}
        onAdd={() => setParticipantModal('new')}
        onEdit={setParticipantModal}
        onDelete={deleteParticipant}
        onOpenRegistration={onOpenRegistration}
        onOpenCoaching={onOpenCoaching}
      />
      {participantModal && (
        <ParticipantModal
          participant={participantModal === 'new' ? undefined : participantModal}
          onClose={() => setParticipantModal(null)}
          saving={create.isPending || update.isPending}
          onSave={saveParticipant}
        />
      )}
    </>
  );
}

function importPreviewFromError(error: unknown): ParticipantImportPreview | null {
  if (!(error instanceof ApiError) || error.status !== 422 || !error.data || typeof error.data !== 'object') return null;
  const data = error.data as Partial<ParticipantImportPreview>;
  return Array.isArray(data.rows) && Array.isArray(data.issues) && typeof data.valid === 'boolean'
    ? data as ParticipantImportPreview
    : null;
}

function ParticipantImportPanel({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParticipantImportPreview | null>(null);
  const previewImport = usePreviewParticipantImport();
  const confirmImport = useConfirmParticipantImport();
  const { toast } = useToast();
  const selectionGeneration = useRef(0);

  function selectFile(selected: File | null) {
    selectionGeneration.current += 1;
    setFile(selected);
    setPreview(null);
    previewImport.reset();
    confirmImport.reset();
  }

  function validateFile() {
    if (!file) return;
    const generation = selectionGeneration.current;
    previewImport.mutate({ data: { file } }, {
      onSuccess: (result) => {
        if (selectionGeneration.current === generation) setPreview(result);
      },
      onError: (error) => {
        if (selectionGeneration.current !== generation) return;
        const invalidPreview = importPreviewFromError(error);
        if (invalidPreview) {
          setPreview(invalidPreview);
          return;
        }
        toast({ title: 'Bestand niet gecontroleerd', description: participantGeneralErrorMessage, variant: 'destructive' });
      },
    });
  }

  function importFile() {
    if (!file || !preview?.valid) return;
    const generation = selectionGeneration.current;
    confirmImport.mutate({ data: { file } }, {
      onSuccess: ({ importedCount }) => {
        if (selectionGeneration.current !== generation) return;
        toast({
          title: 'Deelnemers geïmporteerd',
          description: `${importedCount} ${importedCount === 1 ? 'deelnemer is' : 'deelnemers zijn'} toegevoegd.`,
        });
        selectFile(null);
        onImported();
      },
      onError: (error) => {
        if (selectionGeneration.current !== generation) return;
        const invalidPreview = importPreviewFromError(error);
        if (invalidPreview) setPreview(invalidPreview);
        toast({
          title: 'Deelnemers niet geïmporteerd',
          description: error instanceof ApiError && error.status === 409
            ? 'Een e-mailadres uit het bestand bestaat intussen al. Controleer het bestand opnieuw.'
            : participantGeneralErrorMessage,
          variant: 'destructive',
        });
      },
    });
  }

  return (
    <section className="mb-5 rounded-xl border border-border/70 bg-card p-5 sm:p-6" aria-labelledby="participant-import-title">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Bulkimport</p>
          <h2 id="participant-import-title" className="serif mt-2 text-2xl text-primary">Deelnemerslijst importeren</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Gebruik een Excelbestand met de kolommen Dansschool, Contactpersoon, E-mailadres en Land. Controleer het bestand altijd voordat je importeert.
          </p>
        </div>
        <label className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-primary ${previewImport.isPending || confirmImport.isPending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-secondary'}`}>
          <Upload className="size-4" />
          {file ? 'Ander bestand' : 'Excelbestand kiezen'}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={previewImport.isPending || confirmImport.isPending}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            data-testid="input-participant-import"
          />
        </label>
      </div>
      {file && (
        <div className="mt-5 flex flex-col gap-3 rounded-lg bg-secondary/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-primary">{file.name}</p>
            <p className="text-xs text-muted-foreground">{new Intl.NumberFormat('nl-NL').format(file.size)} bytes</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={validateFile} disabled={previewImport.isPending || confirmImport.isPending} className="min-h-10 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-primary disabled:opacity-50" data-testid="button-preview-participant-import">
              {previewImport.isPending ? 'Controleren…' : 'Bestand controleren'}
            </button>
            {preview?.valid && (
              <button type="button" onClick={importFile} disabled={confirmImport.isPending} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-confirm-participant-import">
                {confirmImport.isPending ? 'Importeren…' : `${preview.rows.length} deelnemers importeren`}
              </button>
            )}
          </div>
        </div>
      )}
      {preview && (
        <div className="mt-5" aria-live="polite">
          <p className={`text-sm font-semibold ${preview.valid ? 'text-[#557b5b]' : 'text-destructive'}`}>
            {preview.valid
              ? `${preview.rows.length} ${preview.rows.length === 1 ? 'rij is' : 'rijen zijn'} klaar om te importeren.`
              : `${preview.issues.length} ${preview.issues.length === 1 ? 'probleem gevonden' : 'problemen gevonden'}; er is niets opgeslagen.`}
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border/70">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-3 py-2">Rij</th><th className="px-3 py-2">Dansschool</th><th className="px-3 py-2">Contactpersoon</th><th className="px-3 py-2">E-mailadres</th><th className="px-3 py-2">Land</th><th className="px-3 py-2">Controle</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {preview.rows.map((row) => {
                  const rowIssues = preview.issues.filter(issue => issue.row === row.row);
                  return (
                    <tr key={row.row} className={rowIssues.length ? 'bg-destructive/5' : ''}>
                      <td className="px-3 py-3 font-medium">{row.row}</td>
                      <td className="px-3 py-3">{row.schoolName || '—'}</td>
                      <td className="px-3 py-3">{row.contactName || '—'}</td>
                      <td className="px-3 py-3">{row.email || '—'}</td>
                      <td className="px-3 py-3">{row.country || '—'}</td>
                      <td className="px-3 py-3">{rowIssues.length ? rowIssues.map(item => item.message).join(' ') : 'Geldig'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.issues.some(issue => !preview.rows.some(row => row.row === issue.row)) && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive">
              {preview.issues.filter(issue => !preview.rows.some(row => row.row === issue.row)).map((item, index) => <li key={`${item.row}-${item.column}-${index}`}>{item.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

type ParticipantsSectionProps = {
  participants: Participant[];
  onAdd: () => void;
  onEdit: (participant: Participant) => void;
  onDelete: (id: number) => void;
  onOpenRegistration: (participant: Participant) => void;
  onOpenCoaching: (participantId: number) => void;
};

export function ParticipantsSection(props: ParticipantsSectionProps) {
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState<'Alle' | 'Nederland' | 'België'>('Alle');
  const filteredParticipants = useMemo(() => props.participants.filter((participant) => {
    const matchesSearch = `${participant.schoolName} ${participant.contactName} ${participant.email}`
      .toLowerCase()
      .includes(search.toLowerCase());
    return matchesSearch && (countryFilter === 'Alle' || participant.country === countryFilter);
  }), [countryFilter, props.participants, search]);

  return (
    <div className="rounded-xl border border-border/70 bg-card">
      <div className="flex flex-col justify-between gap-4 border-b border-border/70 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Deelnemers</p>
          <h2 className="serif mt-2 text-3xl text-primary">{props.participants.length} scholen</h2>
        </div>
        <button type="button" onClick={props.onAdd} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-foreground" data-testid="button-add-participant">
          <Plus className="size-4" /> Deelnemer toevoegen
        </button>
      </div>
      <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-accent" placeholder="Zoek op school, naam of e-mail" data-testid="input-search-participants" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value as typeof countryFilter)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="select-filter-country">
            <option value="Alle">Alle landen</option>
            <option value="Nederland">Nederland</option>
            <option value="België">België</option>
          </select>
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {filteredParticipants.length === 0 ? (
          <div className="p-5 text-center">
            <h3 className="text-sm font-semibold text-primary">Geen deelnemers gevonden</h3>
            <p className="mt-1 text-sm text-muted-foreground">Pas je zoekopdracht aan of voeg een nieuwe school toe.</p>
          </div>
        ) : (
          <div>
            <div className="hidden grid-cols-[2fr_90px_90px_90px_90px_90px_90px_132px] gap-3 border-b border-border/60 bg-secondary/45 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground lg:grid">
              <span>School</span><span className="text-right">Start</span><span className="text-right">Doel</span><span className="text-right">Proef</span><span className="text-right">Aanw</span><span className="text-right">Nieuw</span><span className="text-right">Groei</span><span className="text-right">Acties</span>
            </div>
            {filteredParticipants.map((participant) => (
              <ParticipantRow
                key={participant.id}
                participant={participant}
                onEdit={() => props.onEdit(participant)}
                onDelete={() => props.onDelete(participant.id)}
                onOpenRegistration={() => props.onOpenRegistration(participant)}
                onOpenCoaching={() => props.onOpenCoaching(participant.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ParticipantRow({ participant, onEdit, onDelete, onOpenRegistration, onOpenCoaching }: {
  participant: Participant;
  onEdit: () => void;
  onDelete: () => void;
  onOpenRegistration: () => void;
  onOpenCoaching: () => void;
}) {
  const growth = participant.scores?.growthPercent;
  const growthLabel = growth == null ? '—' : `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(growth)}%`;
  const initials = participant.schoolName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 transition-colors hover:bg-secondary/20 lg:grid lg:grid-cols-[2fr_90px_90px_90px_90px_90px_90px_132px] lg:items-center last:border-0">
      <div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">{initials}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-primary">{participant.schoolName}</p><p className="truncate text-xs text-muted-foreground">{participant.contactName} · {participant.email}</p></div></div>
      <ParticipantMetric mobileLabel="Startleden">{participant.startingMembers != null ? participant.startingMembers : <span className="text-muted-foreground italic">Nog niet</span>}</ParticipantMetric>
      <ParticipantMetric mobileLabel="Doel">{participant.targetNewMembers != null ? `+${participant.targetNewMembers}` : <span className="text-muted-foreground italic">Nog niet</span>}</ParticipantMetric>
      <ParticipantMetric mobileLabel="Proeflessen">{participant.totals?.signups ?? 0}</ParticipantMetric>
      <ParticipantMetric mobileLabel="Aanwezig">{participant.totals?.attendance ?? 0}</ParticipantMetric>
      <ParticipantMetric mobileLabel="Ingeschreven">{participant.totals?.enrolled ?? 0}</ParticipantMetric>
      <ParticipantMetric mobileLabel="Groei"><span className="font-semibold text-[#557b5b]">{participant.startingMembers != null ? growthLabel : '—'}</span></ParticipantMetric>
      <div className="flex justify-end gap-1 border-t border-border/60 pt-3 lg:border-0 lg:pt-0">
        <button onClick={onOpenRegistration} className="rounded-lg p-2 text-accent-foreground hover:bg-accent/15" aria-label={`Open registratie-instructie voor ${participant.schoolName}`} data-testid={`button-registration-instructions-${participant.id}`}><ClipboardCopy className="size-4" /></button>
        <button onClick={onOpenCoaching} className="rounded-lg p-2 text-accent hover:bg-accent/10" aria-label={`Coaching panel ${participant.schoolName}`} data-testid={`button-coach-${participant.id}`}><MessageSquare className="size-4" /></button>
        <Link href={`/beheer/financien/${participant.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`Coaching Financiën ${participant.schoolName}`} data-testid={`button-coach-financien-${participant.id}`}><Landmark className="size-4" /></Link>
        <Link href={`/beheer/deelnemer/${participant.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`Bekijk dashboard ${participant.schoolName}`} data-testid={`button-view-participant-${participant.id}`}><BarChart3 className="size-4" /></Link>
        <button onClick={onEdit} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`Bewerk ${participant.schoolName}`} data-testid={`button-edit-participant-${participant.id}`}><Pencil className="size-4" /></button>
        <button onClick={onDelete} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Verwijder ${participant.schoolName}`} data-testid={`button-delete-participant-${participant.id}`}><Trash2 className="size-4" /></button>
      </div>
    </div>
  );
}

function ParticipantMetric({ mobileLabel, children }: { mobileLabel: string; children: ReactNode }) {
  return <div className="flex justify-between lg:block lg:text-right"><span className="text-xs text-muted-foreground lg:hidden">{mobileLabel}</span><span className="text-sm text-primary">{children}</span></div>;
}

export function ParticipantModal({ participant, onClose, onSave, saving }: {
  participant?: Participant;
  onClose: () => void;
  onSave: (data: ParticipantFormData) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({ schoolName: participant?.schoolName ?? '', contactName: participant?.contactName ?? '', email: participant?.email ?? '', country: participant?.country ?? 'Nederland' });
  const [emailError, setEmailError] = useState('');
  useEffect(() => {
    if (!participant) return;
    setForm({ schoolName: participant.schoolName, contactName: participant.contactName, email: participant.email, country: participant.country });
    setEmailError('');
  }, [participant]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!usableParticipantEmail.test(form.email.trim())) {
      setEmailError(participantInvalidEmailMessage);
      return;
    }
    setEmailError('');
    onSave({ schoolName: form.schoolName, contactName: form.contactName, email: form.email, country: form.country as ParticipantCountry });
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-primary/30 p-4 backdrop-blur-sm"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-8" data-testid="form-participant-modal"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">{participant ? 'Deelnemer bewerken' : 'Nieuwe deelnemer'}</p><h2 className="serif mt-2 text-3xl text-primary">{participant ? participant.schoolName : 'Een school toevoegen'}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="Sluiten" data-testid="button-close-participant-modal"><X className="size-5" /></button></div><div className="mt-7 grid gap-4 sm:grid-cols-2"><label className="space-y-2 sm:col-span-2"><span className="text-xs font-semibold text-muted-foreground">Naam dansschool</span><input required value={form.schoolName} onChange={(event) => setForm({ ...form, schoolName: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-school-name" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">Contactpersoon</span><input required value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-contact-name" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">E-mailadres</span><input required type="email" value={form.email} onChange={(event) => { event.currentTarget.setCustomValidity(''); setEmailError(''); setForm({ ...form, email: event.target.value }); }} onInvalid={(event) => { event.currentTarget.setCustomValidity(participantInvalidEmailMessage); setEmailError(participantInvalidEmailMessage); }} aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? 'participant-email-error' : undefined} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-email" />{emailError && <span id="participant-email-error" role="alert" className="block text-xs leading-5 text-destructive">{emailError}</span>}</label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">Land</span><select required value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value as ParticipantCountry })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-country"><option value="Nederland">Nederland</option><option value="België">België</option></select></label></div><p className="mt-5 text-xs leading-5 text-muted-foreground">Het aantal startleden vult de deelnemer zelf in bij de eerste aanmelding.</p><div className="mt-8 flex justify-end gap-3"><button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-primary hover:bg-secondary" data-testid="button-cancel-participant">Annuleren</button><button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-participant"><Save className="size-4" /> {saving ? 'Opslaan…' : 'Opslaan'}</button></div></form></div>;
}