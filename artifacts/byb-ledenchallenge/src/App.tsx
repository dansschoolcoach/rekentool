import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { experimental__simple } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, ArrowUpRight, BarChart3, CalendarCheck, CalendarDays, Check,
  ChevronDown, CircleAlert, CircleHelp, ClipboardCopy, Clock3, Crown, FilePenLine, LockKeyhole,
  FileSpreadsheet, LogOut, Medal, Menu, Pencil, Plus, RefreshCcw, Save, Search, Settings, ShieldCheck,
  Target, Trash2, TrendingUp, Trophy, UserRound, X, MapPin, Users, Filter,
  MessageSquare, BellRing, Send, Landmark
} from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ApiError, getGetChallengeQueryKey, getGetDashboardQueryKey, getGetParticipantsQueryKey, getGetWeeklyEntriesQueryKey, getGetAdminWeeklyEntriesQueryKey, getGetLeaderboardQueryKey, getGetParticipantRecoveryStatusQueryKey, getGetAdminFinancialFileSubmissionsQueryKey, useCreateParticipant, useDeleteParticipant, useGetChallenge, useGetDashboard, useGetLeaderboard, useGetParticipants, useGetWeeks, useGetWeeklyEntries, useUpdateChallenge, useUpdateParticipant, useUpsertWeeklyEntry, useGetAdminWeeklyEntries, useUpdateAdminWeeklyEntry, type ChallengeWeek, type Participant, type WeeklyEntry, type AdminWeeklyEntry, ParticipantCountry, useGetMessages, getGetMessagesQueryKey, useUpdateProfile, useGetAdminParticipantMessages, getGetAdminParticipantMessagesQueryKey, useCreateParticipantMessage, useSendParticipantReminder, useGetAdminParticipantView, getGetAdminParticipantViewQueryKey, useUpdateAdminParticipantProfile, useUpsertAdminParticipantWeeklyEntry, useGetParticipantRecoveryStatus, useGetAdminFinancialFileSubmissions } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { buildRegistrationInstructions, copyRegistrationInstructions, findRegistrationParticipant, RegistrationInstructionsForParticipant } from './registrationInstructions';
import { CoachingForParticipant } from './coachingParticipant';
import { findEditableParticipant } from './editParticipant';
import { buildProductionRegistrationUrl } from './productionRegistrationUrl';
import { FinancienPage } from './pages/financien/FinancienPage';
import { AdminFinancienPage } from './pages/financien/AdminFinancienPage';
import { AdminFinancialImports } from './pages/financien/AdminFinancialImports';
import { ParticipantManagementFlow, ParticipantModal, participantEmailConflictMessage } from './participantManagement';
import { ParticipantRecoveryWarning } from './ParticipantRecoveryWarning';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const canonicalSignUpPath = `${basePath}/sign-up`;
const legacySignUpPath = '/byb-ledenchallenge/sign-up';
const productionSignUpUrl = buildProductionRegistrationUrl(
  import.meta.env.VITE_PUBLIC_APP_URL,
);
const profileConflictMessage = 'Dit profiel is intussen gewijzigd. De actuele waarden zijn geladen; controleer ze en sla daarna opnieuw op.';

function currentParticipantFromConflict(error: unknown): Participant | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.data || typeof error.data !== 'object') return null;
  if (!('currentParticipant' in error.data) || !error.data.currentParticipant) return null;
  return error.data.currentParticipant as Participant;
}

// Invitations sent before the production app moved to the root still point to
// the artifact preview path. Normalize that path before Clerk and Wouter read it.
function normalizeLegacySignUpPath() {
  if (
    canonicalSignUpPath !== legacySignUpPath &&
    (window.location.pathname === legacySignUpPath ||
      window.location.pathname.startsWith(`${legacySignUpPath}/`))
  ) {
    const suffix = window.location.pathname.slice(legacySignUpPath.length);
    window.history.replaceState(
      window.history.state,
      '',
      `${canonicalSignUpPath}${suffix}${window.location.search}${window.location.hash}`,
    );
  }
}
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function QueryIdentityGuard({ children }: { children: ReactNode }) {
  const { userId, isLoaded } = useAuth();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) queryClient.clear();
    previousUserId.current = userId;
  }, [isLoaded, userId]);
  return children;
}
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
function fmtDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}
function initials(value = 'ByB') {
  return value.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}
function pct(value?: number) {
  return `${(value ?? 0).toFixed(1).replace('.', ',')}%`;
}
function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export const appDisplayName = 'ByB ledenpagina';
export const signInSubtitle = 'Log in op je Boost your Business pagina';
export const signUpTitle = 'Welkom op de Boost your Business ledenpagina';
export const signUpSubtitle = 'Maak je account af voor toegang tot je persoonlijke ledenpagina';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3" data-testid="link-logo">
      <span className={cn('grid size-9 place-items-center rounded-full border text-sm font-semibold tracking-tight transition-transform group-hover:rotate-6', light ? 'border-accent/60 text-accent' : 'border-primary/20 bg-primary text-accent')}>B</span>
      <span className={cn('serif text-[22px] leading-none', light ? 'text-primary-foreground' : 'text-primary')}>ByB <i className="not-italic opacity-60">ledenpagina</i></span>
    </Link>
  );
}

function Button({ children, className, variant = 'primary', type = 'button', disabled, onClick, testId }: { children: ReactNode; className?: string; variant?: 'primary' | 'outline' | 'ghost' | 'gold' | 'danger'; type?: 'button' | 'submit'; disabled?: boolean; onClick?: () => void; testId: string }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline: 'border border-primary/20 bg-transparent text-primary hover:bg-primary/5',
    ghost: 'text-muted-foreground hover:bg-primary/5 hover:text-primary',
    gold: 'bg-accent text-accent-foreground hover:bg-accent/85',
    danger: 'border border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10',
  };
  return <button type={type} disabled={disabled} onClick={onClick} className={cn('inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50', styles[variant], className)} data-testid={testId}>{children}</button>;
}

function Loading({ label = 'Gegevens laden' }: { label?: string }) {
  return <div className="page-in flex items-center gap-3 rounded-xl border border-border/70 bg-card/70 p-6 text-sm text-muted-foreground" data-testid="status-loading"><span className="flex gap-1"><i className="size-1.5 animate-pulse rounded-full bg-accent" /><i className="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:150ms]" /><i className="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:300ms]" /></span>{label}</div>;
}
function ErrorState({ retry, message = 'De gegevens konden niet worden opgehaald.' }: { retry?: () => void; message?: string }) {
  return <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-6" data-testid="status-error"><CircleAlert className="size-5 text-destructive" /><p className="text-sm text-foreground">{message}</p>{retry && <Button variant="outline" onClick={retry} testId="button-retry"><RefreshCcw className="size-4" /> Opnieuw proberen</Button>}</div>;
}
function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8 text-center" data-testid="status-empty"><div className="mb-4 grid size-11 place-items-center rounded-full bg-accent/20 text-primary"><CircleHelp className="size-5" /></div><h3 className="serif text-2xl text-primary">{title}</h3><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{text}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function RootRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-background"><Loading label="Je omgeving wordt voorbereid" /></div>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <Redirect to={isAdminUser(user) ? '/beheer' : '/dashboard'} />;
}

function SignInPage() {
  return <div className="paper-grid flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8"><div className="w-full max-w-[440px]"><div className="mb-6 flex justify-center"><Logo /></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}
function SignUpContent({ path }: { path: string }) {
  return <div className="paper-grid flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8"><div className="w-full max-w-[440px]"><div className="mb-6 flex justify-center"><Logo /></div><SignUp routing="path" path={path} signInUrl={`${basePath}/sign-in`} /></div></div>;
}
function SignUpPage() {
  return <SignUpContent path={canonicalSignUpPath} />;
}

const navItems = [
  { href: '/dashboard', label: 'Overzicht', icon: BarChart3 },
  { href: '/cijfers', label: 'Mijn cijfers', icon: FilePenLine },
  { href: '/leaderboard', label: 'Ranglijst', icon: Trophy },
];
export const adminNavItems = [
  { href: '/beheer', label: 'Overzicht', icon: BarChart3, active: (path: string) => path === '/beheer' },
  { href: '/beheer/challenge', label: 'Challenge', icon: Trophy, active: (path: string) => path === '/beheer/challenge' },
  { href: '/beheer/deelnemers', label: 'Deelnemers', icon: Users, active: (path: string) => path === '/beheer/deelnemers' || path.startsWith('/beheer/deelnemer/') },
  { href: '/beheer/excelbestanden', label: 'Excelbestanden', icon: FileSpreadsheet, active: (path: string) => path === '/beheer/excelbestanden' },
  { href: '/beheer/financien', label: 'Financiën', icon: Landmark, active: (path: string) => path === '/beheer/financien' || path.startsWith('/beheer/financien/') },
];
function isAdminUser(user: ReturnType<typeof useUser>['user']) {
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase();
  return user?.publicMetadata?.role === 'admin' || user?.primaryEmailAddress?.emailAddress?.toLowerCase() === adminEmail;
}
export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  const isAdmin = isAdminUser(user);
  const name = user?.firstName ?? user?.primaryEmailAddress?.emailAddress?.split('@')[0] ?? (isAdmin ? 'Beheerder' : 'Deelnemer');
  return <div className="min-h-[100dvh] bg-background">
    <aside data-testid="app-sidebar" className={cn('fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col overflow-y-auto bg-primary px-5 py-7 transition-transform duration-300 lg:translate-x-0', mobileNav ? 'translate-x-0' : '-translate-x-full')}><div className="px-2"><Logo light /></div>{isAdmin ? <><div className="mt-14 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-primary-foreground/45">Beheer</div><nav className="mt-4 space-y-1">{adminNavItems.map(({ href, label, icon: Icon, active }) => { const selected = active(location); return <Link key={href} href={href} onClick={() => setMobileNav(false)} aria-current={selected ? 'page' : undefined} className={cn('group flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors', selected ? 'bg-primary-foreground/10 font-semibold text-primary-foreground' : 'text-primary-foreground/60 hover:bg-primary-foreground/5 hover:text-primary-foreground')} data-testid={`link-nav-beheer-${label.toLowerCase()}`}><Icon className={cn('size-[18px]', selected ? 'text-accent' : 'text-primary-foreground/50 group-hover:text-accent')} />{label}{selected && <span className="ml-auto size-1.5 rounded-full bg-accent" />}</Link>; })}</nav></> : <><div className="mt-14 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-primary-foreground/45">Jouw challenge</div><nav className="mt-4 space-y-1">{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileNav(false)} className={cn('group flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors', location === href ? 'bg-primary-foreground/10 font-semibold text-primary-foreground' : 'text-primary-foreground/60 hover:bg-primary-foreground/5 hover:text-primary-foreground')} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon className={cn('size-[18px]', location === href ? 'text-accent' : 'text-primary-foreground/50 group-hover:text-accent')} />{label}{location === href && <span className="ml-auto size-1.5 rounded-full bg-accent" />}</Link>)}</nav><div className="mt-10 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-primary-foreground/45">Jouw financiën</div><nav className="mt-4 space-y-1"><Link href="/financien" onClick={() => setMobileNav(false)} className={cn('group flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors', location.startsWith('/financien') ? 'bg-primary-foreground/10 font-semibold text-primary-foreground' : 'text-primary-foreground/60 hover:bg-primary-foreground/5 hover:text-primary-foreground')} data-testid="link-nav-financien"><Landmark className={cn('size-[18px]', location.startsWith('/financien') ? 'text-accent' : 'text-primary-foreground/50 group-hover:text-accent')} />Financiën{location.startsWith('/financien') && <span className="ml-auto size-1.5 rounded-full bg-accent" />}</Link></nav></>}<div className="mt-10 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-primary-foreground/45">Account</div><nav className="mt-4 space-y-1"><Link href="/instellingen" onClick={() => setMobileNav(false)} className={cn('flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors', location === '/instellingen' ? 'bg-primary-foreground/10 font-semibold text-primary-foreground' : 'text-primary-foreground/60 hover:bg-primary-foreground/5 hover:text-primary-foreground')} data-testid="link-nav-instellingen"><Settings className="size-[18px]" />Instellingen</Link></nav><div className="mt-auto border-t border-primary-foreground/10 pt-5"><div className="flex items-center gap-3 px-2"><span className="grid size-9 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground" data-testid="text-user-initials">{initials(name)}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-primary-foreground" data-testid="text-user-name">{name}</p><p className="truncate text-xs text-primary-foreground/45">{isAdmin ? 'Beheerder' : 'Deelnemer'}</p></div><button className="ml-auto text-primary-foreground/50 transition-colors hover:text-accent" onClick={() => void signOut({ redirectUrl: basePath || '/' })} aria-label="Uitloggen" data-testid="button-sign-out"><LogOut className="size-4" /></button></div></div></aside>
    {mobileNav && <button className="fixed inset-0 z-30 bg-primary/30 lg:hidden" onClick={() => setMobileNav(false)} aria-label="Menu sluiten" data-testid="button-close-mobile-nav" />}
    <div className="min-w-0 lg:pl-[252px]"><header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md lg:px-10"><button className="rounded-lg p-2 text-primary lg:hidden" onClick={() => setMobileNav(true)} aria-label="Menu openen" data-testid="button-open-mobile-nav"><Menu className="size-5" /></button><div className="hidden text-sm text-muted-foreground lg:block">{location === '/dashboard' ? 'Goed dat je er bent, {name}'.replace('{name}', name) : location.startsWith('/beheer') ? adminNavItems.find(item => item.active(location))?.label ?? 'Beheer' : navItems.find((item) => item.href === location)?.label ?? 'Instellingen'}</div><div className="ml-auto flex items-center gap-3"><span className="hidden text-xs text-muted-foreground sm:block">Editie 2026</span><span className="size-1 rounded-full bg-accent" /><Link href="/instellingen" className="text-sm font-semibold text-primary hover:text-accent-foreground" data-testid="link-header-account">{initials(name)}</Link></div></header><main className="mx-auto min-w-0 max-w-[1440px] px-5 py-8 lg:px-10 lg:py-12">{children}</main></div>
  </div>;
}
export function Protected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [location] = useLocation();
  const isAdmin = isAdminUser(user);
  const dashboard = useGetDashboard({ query: { enabled: Boolean(isLoaded && isSignedIn && !isAdmin), queryKey: getGetDashboardQueryKey() } });
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-background"><Loading label="Je omgeving wordt voorbereid" /></div>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (!isAdmin && dashboard.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background"><Loading label="Je profiel wordt voorbereid" /></div>;
  if (!isAdmin && (dashboard.isError || !dashboard.data)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background p-5">
        <div className="w-full max-w-xl">
          <ErrorState
            message="Je profiel kon niet worden gecontroleerd. Je persoonlijke pagina blijft geblokkeerd totdat dit lukt."
            retry={() => void dashboard.refetch()}
          />
        </div>
      </div>
    );
  }
  if (!isAdmin && dashboard.data && (dashboard.data.participant.startingMembers == null || dashboard.data.participant.targetNewMembers == null) && location !== '/onboarding') return <Redirect to="/onboarding" />;
  return <AppShell>{children}</AppShell>;
}
function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end page-in"><div><div className="mb-3 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.22em] text-muted-foreground"><span className="gold-rule" />{eyebrow}</div><h1 className="serif text-5xl leading-none tracking-[-.02em] text-primary lg:text-6xl" data-testid="text-page-title">{title}</h1>{description && <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</div>;
}
function MetricCard({ label, value, detail, icon: Icon, accent = false }: { label: string; value: string; detail: string; icon: typeof Activity; accent?: boolean }) {
  return <div className={cn('editorial-shadow rounded-xl border p-5 transition-transform duration-200 hover:-translate-y-0.5', accent ? 'border-accent/50 bg-accent/15' : 'border-border/70 bg-card')} data-testid={`card-metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="flex items-start justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><Icon className={cn('size-4', accent ? 'text-accent-foreground' : 'text-muted-foreground')} /></div><p className="mt-7 text-4xl font-semibold tracking-tight text-primary" data-testid={`text-metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p><p className="mt-2 text-xs text-muted-foreground">{detail}</p></div>;
}
function DashboardPage() {
  const dashboard = useGetDashboard();
  const messagesQuery = useGetMessages();
  const challenge = dashboard.data?.challenge;
  const totals = dashboard.data?.totals;
  const scores = dashboard.data?.scores;
  const entries = dashboard.data?.entries ?? [];
  const messages = messagesQuery.data ?? [];
  if (dashboard.isLoading) return <Loading label="Jouw overzicht laden" />;
  if (dashboard.isError || !dashboard.data) return <ErrorState retry={() => void dashboard.refetch()} />;
  const weeksDone = entries.filter((entry) => entry.signups > 0 || entry.attendance > 0 || entry.enrolled > 0).length;
  const completion = challenge?.totalWeeks ? Math.min(100, (weeksDone / challenge.totalWeeks) * 100) : 0;
  return <div className="page-in"><PageIntro eyebrow="Overzicht" title="Jouw beweging" description={`Week ${challenge?.currentWeek ?? '—'} van de challenge. Eén blik op waar je staat, en wat er nog kan.`} action={<Link href="/cijfers" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-enter-numbers">Cijfers bijwerken <ArrowUpRight className="size-4" /></Link>} />
     <section className="navy-panel relative overflow-hidden rounded-2xl p-6 text-primary-foreground sm:p-8"><div className="absolute -right-20 -top-28 size-80 rounded-full border border-accent/15" /><div className="absolute -right-6 -top-14 size-56 rounded-full border border-accent/10" /><div className="relative grid gap-8 lg:grid-cols-[1fr_310px] lg:items-end"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-accent"><CalendarCheck className="size-4" /> {challenge?.isActive ? 'Challenge actief' : 'Challenge staat klaar'}</div><h2 className="serif mt-4 max-w-xl text-4xl leading-tight sm:text-5xl">Elke week telt op naar groei.</h2><p className="mt-4 max-w-lg text-sm leading-6 text-primary-foreground/65">Je hebt {weeksDone} van de {challenge?.totalWeeks ?? 4} weken ingevuld. Hou het ritme vast.</p></div><div><div className="mb-3 flex justify-between text-xs text-primary-foreground/60"><span>Voortgang</span><span className="font-semibold text-accent">{Math.round(completion)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-primary-foreground/10"><div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${completion}%` }} /></div><div className="mt-4 flex justify-between text-xs text-primary-foreground/55"><span>Start {fmtDate(challenge?.startDate)}</span><span>{challenge?.daysRemaining ?? 0} dagen over</span></div></div></div></section>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><MetricCard label="Proeflessen" value={`${totals?.signups ?? 0}`} detail="aangemeld in totaal" icon={Target} /><MetricCard label="Aanwezig" value={`${totals?.attendance ?? 0}`} detail="van de proeflessen" icon={CalendarCheck} /><MetricCard label="Ingeschreven" value={`${totals?.enrolled ?? 0}`} detail="nieuwe leden" icon={TrendingUp} accent /><MetricCard label="Doel nieuwe leden" value={`${totals?.enrolled ?? 0} van ${dashboard.data.participant.targetNewMembers}`} detail={`${Math.round(((totals?.enrolled ?? 0) / Math.max(1, dashboard.data.participant.targetNewMembers ?? 1)) * 100)}% van je gewenste extra leden`} icon={Target} accent /><MetricCard label="Groei" value={pct(scores?.growthPercent)} detail={`t.o.v. ${dashboard.data.participant.startingMembers} startleden`} icon={Activity} /></section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><div className="rounded-xl border border-border/70 bg-card p-6 sm:p-7"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Jouw funnel</p><h2 className="serif mt-2 text-3xl text-primary">Van eerste les naar lid</h2></div><Link href="/cijfers" className="text-xs font-semibold text-accent-foreground hover:underline" data-testid="link-funnel-edit">Bewerk cijfers</Link></div><div className="mt-8 space-y-5"><FunnelRow label="Proeflessen" value={totals?.signups ?? 0} percent={100} color="bg-primary" /><FunnelRow label="Aanwezig" value={totals?.attendance ?? 0} percent={totals?.signups ? (totals.attendance / totals.signups) * 100 : 0} color="bg-accent" /><FunnelRow label="Ingeschreven" value={totals?.enrolled ?? 0} percent={totals?.signups ? (totals.enrolled / totals.signups) * 100 : 0} color="bg-[#7e9c82]" /></div></div><div className="rounded-xl border border-border/70 bg-card p-6 sm:p-7"><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Jouw scores</p><h2 className="serif mt-2 text-3xl text-primary">De drie richtingen</h2><div className="mt-7 space-y-5"><ScoreLine label="Groei" value={pct(scores?.growthPercent)} /><ScoreLine label="Conversie" value={pct(scores?.conversionPercent)} /><ScoreLine label="Aanwezigheid" value={pct(scores?.attendancePercent)} /></div><div className="mt-7 border-t border-border/60 pt-5 text-xs leading-5 text-muted-foreground">Scores worden automatisch bijgewerkt wanneer je cijfers opslaat.</div></div></section>
    <section className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-7"><div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Recent ingevuld</p><h2 className="serif mt-2 text-3xl text-primary">Jouw weken</h2></div><Link href="/cijfers" className="text-xs font-semibold text-accent-foreground hover:underline" data-testid="link-all-weeks">Alle weken</Link></div>{entries.length === 0 ? <div className="mt-6"><EmptyState title="Nog geen cijfers" text="Vul je eerste week in en maak je voortgang zichtbaar." action={<Link href="/cijfers" className="text-sm font-semibold text-accent-foreground" data-testid="link-empty-week">Eerste week invullen</Link>} /></div> : <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{entries.slice(-4).reverse().map((entry) => <div className="flex items-center justify-between rounded-lg bg-secondary/55 px-4 py-3" key={entry.id} data-testid={`card-recent-week-${entry.weekNumber}`}><div><p className="text-sm font-semibold text-primary">Week {entry.weekNumber}</p><p className="mt-1 text-xs text-muted-foreground">{entry.signups} proeflessen · {entry.enrolled} nieuw</p></div><Check className="size-4 text-[#557b5b]" /></div>)}</div>}</section>
    <section className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-7"><div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Ondersteuning</p><h2 className="serif mt-2 text-3xl text-primary">Berichten van je coach</h2></div><MessageSquare className="size-5 text-accent-foreground" /></div>{messages.length === 0 ? <div className="mt-6"><EmptyState title="Nog geen berichten" text="Hier verschijnen persoonlijke tips en aanmoedigingen van je business coach gedurende de challenge." /></div> : <div className="mt-6 space-y-4">{messages.map((msg) => <div key={msg.id} className="rounded-xl border border-border/60 bg-secondary/30 p-5" data-testid={`card-message-${msg.id}`}><div className="mb-3 flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{initials(msg.authorName)}</span><div><p className="text-sm font-semibold text-primary">{msg.authorName}</p><p className="text-xs text-muted-foreground">{fmtDate(msg.createdAt)}</p></div></div><p className="whitespace-pre-wrap text-sm leading-relaxed text-primary">{msg.body}</p></div>)}</div>}</section>
  </div>;
}
function FunnelRow({ label, value, percent, color }: { label: string; value: number; percent: number; color: string }) {
  return <div className="grid grid-cols-[100px_1fr_42px] items-center gap-3 text-sm"><span className="text-muted-foreground">{label}</span><div className="h-2.5 overflow-hidden rounded-full bg-secondary"><div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.max(percent, 3)}%` }} /></div><span className="text-right font-semibold text-primary">{value}</span></div>;
}
function ScoreLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b border-border/60 pb-3 text-sm last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="font-semibold text-primary">{value}</span></div>;
}

function CijfersPage() {
  const entriesQuery = useGetWeeklyEntries();
  const weeksQuery = useGetWeeks();
  const upsert = useUpsertWeeklyEntry();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, { signups: string; attendance: string; enrolled: string }>>({});
  const weeks = weeksQuery.data ?? [];
  const entries = entriesQuery.data ?? [];
  useEffect(() => {
    if (entries.length) setDrafts(Object.fromEntries(entries.map((entry) => [entry.weekNumber, { signups: String(entry.signups), attendance: String(entry.attendance), enrolled: String(entry.enrolled) }])));
  }, [entries]);
  function value(weekNumber: number, field: 'signups' | 'attendance' | 'enrolled') { return drafts[weekNumber]?.[field] ?? ''; }
  function setValue(weekNumber: number, field: 'signups' | 'attendance' | 'enrolled', next: string) { setDrafts((current) => ({ ...current, [weekNumber]: { signups: current[weekNumber]?.signups ?? '', attendance: current[weekNumber]?.attendance ?? '', enrolled: current[weekNumber]?.enrolled ?? '', [field]: next } })); }
  function save(weekNumber: number) {
    const draft = drafts[weekNumber] ?? { signups: '0', attendance: '0', enrolled: '0' };
    upsert.mutate({ data: { weekNumber, signups: Number(draft.signups) || 0, attendance: Number(draft.attendance) || 0, enrolled: Number(draft.enrolled) || 0 } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetWeeklyEntriesQueryKey() }); void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); void qc.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() }); } });
  }
  if (entriesQuery.isLoading || weeksQuery.isLoading) return <Loading label="Je invoerblad laden" />;
  if (entriesQuery.isError || weeksQuery.isError) return <ErrorState retry={() => { void entriesQuery.refetch(); void weeksQuery.refetch(); }} />;
  return <div className="page-in"><PageIntro eyebrow="Mijn cijfers" title="Het invoerblad" description="Neem vijf minuten per week. De rest van het dashboard rekent met je mee." action={<div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-4 text-accent-foreground" /> Laatst opgeslagen per week</div>} /><div className="mb-5 flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent-foreground"><CircleHelp className="size-4 shrink-0" /><span>Vul alleen echte aantallen in. Je kunt een week altijd later corrigeren.</span></div>{weeks.length === 0 ? <EmptyState title="De weken zijn er nog niet" text="Zodra de challenge is gestart, verschijnen je invulmomenten hier." /> : <div className="space-y-4">{weeks.map((week) => <WeekEditor key={week.weekNumber} week={week} draft={{ signups: value(week.weekNumber, 'signups'), attendance: value(week.weekNumber, 'attendance'), enrolled: value(week.weekNumber, 'enrolled') }} setValue={setValue} onSave={() => save(week.weekNumber)} saving={upsert.isPending} existing={entries.find((entry) => entry.weekNumber === week.weekNumber)} />)}</div>}</div>;
}
function WeekEditor({ week, draft, setValue, onSave, saving, existing }: { week: ChallengeWeek; draft: { signups: string; attendance: string; enrolled: string }; setValue: (weekNumber: number, field: 'signups' | 'attendance' | 'enrolled', value: string) => void; onSave: () => void; saving: boolean; existing?: WeeklyEntry }) {
  const locked = Boolean(week.isPast && existing);
  return <form onSubmit={(event) => { event.preventDefault(); onSave(); }} className={cn('rounded-xl border bg-card p-5 transition-shadow hover:shadow-sm sm:p-6', week.isCurrent ? 'border-accent/70 shadow-sm shadow-accent/10' : 'border-border/70')} data-testid={`form-week-${week.weekNumber}`}><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-4"><span className={cn('grid size-10 place-items-center rounded-full text-sm font-bold', week.isCurrent ? 'bg-accent text-accent-foreground' : 'bg-secondary text-primary')}>{week.weekNumber}</span><div><div className="flex items-center gap-2"><h2 className="font-semibold text-primary">{week.label || `Week ${week.weekNumber}`}</h2>{week.isCurrent && <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-foreground">Deze week</span>}{week.isPast && <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Afgerond</span>}</div><p className="mt-1 text-xs text-muted-foreground">{fmtDate(week.startDate)} — {fmtDate(week.endDate)}</p></div></div>{existing && <span className="flex items-center gap-1 text-xs text-[#557b5b]"><Check className="size-3.5" /> Opgeslagen</span>}</div><div className="mt-6 grid gap-3 sm:grid-cols-3">{(['signups', 'attendance', 'enrolled'] as const).map((field) => <label key={field} className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">{field === 'signups' ? 'Proeflessen' : field === 'attendance' ? 'Aanwezig' : 'Ingeschreven'}</span><input type="number" min="0" inputMode="numeric" value={draft[field]} disabled={locked} onChange={(event) => setValue(week.weekNumber, field, event.target.value)} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold text-primary outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60" placeholder="0" data-testid={`input-${field}-week-${week.weekNumber}`} /></label>)}</div><div className="mt-5 flex justify-end">{locked ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="size-3.5" /> Afgeronde week</span> : <Button type="submit" variant={week.isCurrent ? 'gold' : 'outline'} disabled={saving} testId={`button-save-week-${week.weekNumber}`}><Save className="size-4" /> {saving ? 'Opslaan…' : 'Week opslaan'}</Button>}</div></form>;
}

function LeaderboardPage() {
  const query = useGetLeaderboard();
  const rows = useMemo(() => [...(query.data ?? [])].sort((a, b) => b.growthPercent - a.growthPercent || b.conversionPercent - a.conversionPercent), [query.data]);
  if (query.isLoading) return <Loading label="De ranglijst laden" />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  return <div className="page-in"><PageIntro eyebrow="Ranglijst" title="Samen scherp blijven" description="Gesorteerd op groei, met conversie als tweede kompas. Iedere school heeft een ander vertrekpunt." action={<div className="flex items-center gap-2 text-xs text-muted-foreground"><Trophy className="size-4 text-accent-foreground" /> {rows.length} deelnemers</div>} /><div className="grid gap-6 xl:grid-cols-[1fr_300px]"><div className="overflow-hidden rounded-xl border border-border/70 bg-card"><div className="grid grid-cols-[48px_1fr_90px_90px_68px] gap-3 border-b border-border/70 bg-secondary/45 px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:grid-cols-[58px_1fr_120px_120px_80px] sm:px-6"><span>#</span><span>Dansschool</span><span className="text-right">Groei</span><span className="text-right">Conversie</span><span className="text-right">Nieuw</span></div>{rows.length === 0 ? <div className="p-6"><EmptyState title="De ranglijst is leeg" text="Zodra deelnemers hun eerste cijfers delen, verschijnt hier de stand." /></div> : <div>{rows.map((row, index) => <div key={`${row.schoolName}-${index}`} className={cn('grid grid-cols-[48px_1fr_90px_90px_68px] items-center gap-3 border-b border-border/60 px-4 py-4 last:border-0 sm:grid-cols-[58px_1fr_120px_120px_80px] sm:px-6', row.isCurrentUser && 'bg-accent/10')} data-testid={`row-leaderboard-${index}`}><div className={cn('grid size-8 place-items-center rounded-full text-sm font-semibold', index === 0 ? 'bg-accent text-accent-foreground' : index < 3 ? 'bg-secondary text-primary' : 'text-muted-foreground')}>{index === 0 ? <Crown className="size-4" /> : row.rank || index + 1}</div><div className="min-w-0"><p className="flex items-center truncate text-sm font-semibold text-primary"><span className="truncate">{row.schoolName}</span><span className="ml-2 shrink-0 rounded border border-border/70 bg-background/50 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{row.country === 'België' ? 'BE' : 'NL'}</span>{row.isCurrentUser && <span className="ml-2 shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent-foreground">Jij</span>}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.contactName}</p></div><span className="text-right text-sm font-semibold text-[#557b5b]">{pct(row.growthPercent)}</span><span className="text-right text-sm text-primary">{pct(row.conversionPercent)}</span><span className="text-right text-sm font-semibold text-primary">{row.enrolled}</span></div>)}</div>}</div><div className="navy-panel h-fit rounded-xl p-6 text-primary-foreground"><Medal className="size-6 text-accent" /><h2 className="serif mt-5 text-3xl">Goed kijken<br />wint.</h2><p className="mt-4 text-sm leading-6 text-primary-foreground/65">De ranglijst beloont niet de grootste school, maar de scherpste beweging vanaf je eigen startpunt.</p><div className="mt-7 border-t border-primary-foreground/15 pt-4 text-xs leading-5 text-primary-foreground/55">Groei is de primaire sortering. Bij gelijke groei bepaalt conversie de volgorde.</div></div></div></div>;
}

export function AdminPage() {
  const { user } = useUser();
  const [location] = useLocation();
  const [editingParticipantId, setEditingParticipantId] = useState<number | null>(null);
  const participantsQuery = useGetParticipants({
    query: {
      queryKey: getGetParticipantsQueryKey(),
      refetchInterval: editingParticipantId === null ? false : 5_000,
    },
  });
  const challengeQuery = useGetChallenge();
  const recoveryStatusQuery = useGetParticipantRecoveryStatus({
    query: {
      queryKey: getGetParticipantRecoveryStatusQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const financialFileSubmissionsQuery = useGetAdminFinancialFileSubmissions({
    query: {
      queryKey: getGetAdminFinancialFileSubmissionsQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const updateChallenge = useUpdateChallenge();
  const queryClient = useQueryClient();
  const [registrationInstructions, setRegistrationInstructions] = useState<Participant | null>(null);
  const [coachingParticipantId, setCoachingParticipantId] = useState<number | null>(null);
  const [dates, setDates] = useState({ startDate: '', endDate: '' });

  useEffect(() => {
    if (!challengeQuery.data) return;
    setDates({
      startDate: challengeQuery.data.startDate.slice(0, 10),
      endDate: challengeQuery.data.endDate.slice(0, 10),
    });
  }, [challengeQuery.data]);

  useEffect(() => {
    setRegistrationInstructions((openedParticipant) => {
      if (!openedParticipant) return null;
      return findRegistrationParticipant(participantsQuery.data ?? [], openedParticipant.id);
    });
  }, [participantsQuery.data]);

  if (!isAdminUser(user)) return <Redirect to="/dashboard" />;
  if (participantsQuery.isLoading || challengeQuery.isLoading) return <Loading label="Beheer laden" />;
  if (participantsQuery.isError || challengeQuery.isError) {
    return <ErrorState retry={() => {
      void participantsQuery.refetch();
      void challengeQuery.refetch();
    }} />;
  }

  function saveDates(event: FormEvent) {
    event.preventDefault();
    updateChallenge.mutate({ data: dates }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetChallengeQueryKey() });
      },
    });
  }

  const participants = participantsQuery.data ?? [];
  const section = location === '/beheer/challenge'
    ? 'challenge'
    : location === '/beheer/deelnemers'
      ? 'participants'
      : location === '/beheer/excelbestanden'
        ? 'imports'
        : location === '/beheer/financien'
          ? 'finances'
          : 'overview';
  const incompleteParticipants = participants.filter(participant => participant.startingMembers == null || participant.targetNewMembers == null).length;
  const openFinancialFileSubmissions = financialFileSubmissionsQuery.data?.filter(submission => submission.status !== 'processed').length;

  if (section === 'overview') {
    const shortcuts = adminNavItems.slice(1);
    return <div className="page-in"><PageIntro eyebrow="Beheer" title="Overzicht" description="Kies een onderdeel om deelnemers, de challenge, bestanden of financiën te beheren." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-border/70 bg-card p-5"><Users className="size-5 text-accent-foreground" /><p className="mt-5 text-3xl font-semibold text-primary">{participants.length}</p><p className="mt-1 text-sm text-muted-foreground">deelnemende scholen</p></div><div className="rounded-xl border border-border/70 bg-card p-5"><CircleAlert className="size-5 text-accent-foreground" /><p className="mt-5 text-3xl font-semibold text-primary">{incompleteParticipants}</p><p className="mt-1 text-sm text-muted-foreground">profielen vragen aandacht</p></div>{openFinancialFileSubmissions != null && <Link href="/beheer/excelbestanden" className="group rounded-xl border border-border/70 bg-card p-5 transition-colors hover:border-accent/60" data-testid="card-open-financial-files"><FileSpreadsheet className="size-5 text-accent-foreground" /><p className="mt-5 text-3xl font-semibold text-primary">{openFinancialFileSubmissions}</p><p className="mt-1 text-sm text-muted-foreground">financiële bestanden wachten op behandeling</p></Link>}<div className={`rounded-xl border border-border/70 bg-card p-5 ${openFinancialFileSubmissions == null ? 'sm:col-span-2' : ''}`}><CalendarDays className="size-5 text-accent-foreground" /><p className="mt-5 text-sm font-semibold text-primary">Actieve challenge</p><p className="mt-1 text-sm text-muted-foreground">{fmtDate(challengeQuery.data?.startDate)} — {fmtDate(challengeQuery.data?.endDate)}</p></div></div><section className="mt-6 grid gap-4 sm:grid-cols-2"><h2 className="sr-only">Beheeronderdelen</h2>{shortcuts.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="group flex items-center gap-4 rounded-xl border border-border/70 bg-card p-5 transition-colors hover:border-accent/60"><span className="grid size-11 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-5" /></span><span><span className="block font-semibold text-primary">{label}</span><span className="mt-1 block text-sm text-muted-foreground">{label === 'Challenge' ? 'Periode en weekcijfers beheren' : label === 'Deelnemers' ? 'Scholen, registratie en coaching beheren' : label === 'Excelbestanden' ? 'Financiële bestanden controleren en importeren' : 'Financiële omgeving per deelnemer openen'}</span></span><ArrowUpRight className="ml-auto size-4 text-muted-foreground transition-colors group-hover:text-accent-foreground" /></Link>)}</section></div>;
  }

  if (section === 'challenge') {
    return <div className="page-in"><PageIntro eyebrow="Beheer" title="Challenge" description="Beheer de actieve periode en corrigeer ingevulde weekcijfers." /><form onSubmit={saveDates} className="max-w-xl rounded-xl border border-border/70 bg-card p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Actieve periode</p><h2 className="serif mt-2 text-3xl text-primary">Challenge data</h2></div><CalendarDays className="size-5 text-accent-foreground" /></div><p className="mt-3 text-sm leading-6 text-muted-foreground">De weken en resterende dagen worden hieruit berekend.</p><div className="mt-7 grid gap-4 sm:grid-cols-2"><label className="block space-y-2"><span className="text-xs font-semibold text-muted-foreground">Startdatum</span><input type="date" value={dates.startDate} onChange={(event) => setDates({ ...dates, startDate: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-primary outline-none focus:border-accent" data-testid="input-challenge-start-date" /></label><label className="block space-y-2"><span className="text-xs font-semibold text-muted-foreground">Einddatum</span><input type="date" value={dates.endDate} onChange={(event) => setDates({ ...dates, endDate: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-primary outline-none focus:border-accent" data-testid="input-challenge-end-date" /></label></div><Button type="submit" className="mt-6" disabled={updateChallenge.isPending} testId="button-save-challenge-dates"><Save className="size-4" /> {updateChallenge.isPending ? 'Opslaan…' : 'Opslaan'}</Button></form><AdminCorrectionSection /></div>;
  }

  if (section === 'imports') {
    return <div className="page-in"><PageIntro eyebrow="Beheer" title="Excelbestanden" description="Behandel aangeleverde bestanden en importeer financiële stamgegevens per deelnemer." /><AdminFinancialImports participants={participants} /></div>;
  }

  if (section === 'finances') {
    return <div className="page-in"><PageIntro eyebrow="Beheer" title="Financiën" description="Open de financiële omgeving van een deelnemer." /><div className="rounded-xl border border-border/70 bg-card"><div className="border-b border-border/70 p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Deelnemers</p><h2 className="serif mt-2 text-3xl text-primary">Kies een dansschool</h2></div><div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{participants.map(participant => <Link key={participant.id} href={`/beheer/financien/${participant.id}`} className="flex items-center gap-3 rounded-lg border border-border/60 p-4 transition-colors hover:border-accent/60 hover:bg-secondary/25"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">{initials(participant.schoolName)}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-primary">{participant.schoolName}</span><span className="block truncate text-xs text-muted-foreground">{participant.contactName}</span></span><ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" /></Link>)}</div></div></div>;
  }

  return (
    <div className="page-in">
      <PageIntro eyebrow="Beheer" title="Deelnemers" description="Beheer scholen, registratiegegevens en persoonlijke coaching." />
      <ParticipantRecoveryWarning
        status={recoveryStatusQuery.data}
        statusUnavailable={recoveryStatusQuery.isError}
      />
      <section>
        <ParticipantManagementFlow
          participants={participants}
          onEditingChange={setEditingParticipantId}
          onOpenRegistration={setRegistrationInstructions}
          onOpenCoaching={setCoachingParticipantId}
          onParticipantCreated={setRegistrationInstructions}
        />
      </section>
      <RegistrationInstructionsForParticipant participants={participants} participantId={registrationInstructions?.id ?? null}>
        {(participant) => <RegistrationInstructionsModal participant={participant} onClose={() => setRegistrationInstructions(null)} />}
      </RegistrationInstructionsForParticipant>
      <CoachingForParticipant participants={participants} participantId={coachingParticipantId}>
        {(participant) => <CoachingModal participant={participant} onClose={() => setCoachingParticipantId(null)} />}
      </CoachingForParticipant>
    </div>
  );
}

/*
function LegacyAdminPage() {
  const [participantModalId, setParticipantModalId] = useState<number | 'new' | null>(null);
  const participantsQuery = useGetParticipants({
    query: {
      queryKey: getGetParticipantsQueryKey(),
      refetchInterval: typeof participantModalId === 'number' ? 5_000 : false,
    },
  });
  const challengeQuery = useGetChallenge();
  const update = useUpdateParticipant();
  const remove = useDeleteParticipant();
  const updateChallenge = useUpdateChallenge();
  const qc = useQueryClient();
  const { toast: showToast } = useToast();
  const participantModal = participantModalId === 'new'
    ? 'new'
    : findEditableParticipant(participantsQuery.data ?? [], participantModalId);
  function setParticipantModal(participant: Participant | 'new' | null) {
    setParticipantModalId(
      participant === 'new' || participant === null ? participant : participant.id,
    );
  }
  const [registrationInstructions, setRegistrationInstructions] = useState<Participant | null>(null);
  const create = useCreateParticipant();
  const [coachingParticipantId, setCoachingParticipantId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState<'Alle' | 'Nederland' | 'België'>('Alle');
  const [dates, setDates] = useState({ startDate: '', endDate: '' });
  function toast(options: Parameters<typeof showToast>[0]) {
    if (options.title === 'Uitnodiging verstuurd') {
      showToast({ ...options, title: 'Deelnemer toegevoegd', description: 'De deelnemer kan nu zelf een account aanmaken met dit e-mailadres.' });
      return;
    }
    if (options.title === 'Uitnodiging niet verstuurd') {
      showToast({ ...options, title: 'Deelnemer niet toegevoegd', description: 'Controleer de gegevens en probeer het opnieuw.' });
      return;
    }
    // The mutation error effect below distinguishes an email conflict from
    // unrelated failures once React Query has exposed the actual API error.
    if (options.title === 'Deelnemer niet toegevoegd') return;
    showToast(options);
  }
  useEffect(() => {
    if (!create.error) return;
    showToast(create.error instanceof ApiError && create.error.status === 409
      ? { title: 'Deelnemer niet toegevoegd', description: participantEmailConflictMessage, variant: 'destructive' }
      : { title: 'Deelnemer niet toegevoegd', description: 'Controleer de gegevens en probeer het opnieuw.', variant: 'destructive' });
  }, [create.error, showToast]);
  useEffect(() => {
    if (!update.error) return;
    showToast(update.error instanceof ApiError && update.error.status === 409
      ? { title: 'Deelnemer niet gewijzigd', description: participantEmailConflictMessage, variant: 'destructive' }
      : { title: 'Deelnemer niet gewijzigd', description: 'Controleer de gegevens en probeer het opnieuw.', variant: 'destructive' });
  }, [showToast, update.error]);
  useEffect(() => { if (challengeQuery.data) setDates({ startDate: challengeQuery.data.startDate.slice(0, 10), endDate: challengeQuery.data.endDate.slice(0, 10) }); }, [challengeQuery.data]);
  const participants = useMemo(() => (participantsQuery.data ?? []).filter((participant) => {
    const matchesSearch = `${participant.schoolName} ${participant.contactName} ${participant.email}`.toLowerCase().includes(search.toLowerCase());
    const matchesCountry = countryFilter === 'Alle' || participant.country === countryFilter;
    return matchesSearch && matchesCountry;
  }), [participantsQuery.data, search, countryFilter]);
  useEffect(() => {
    setRegistrationInstructions((openedParticipant) => {
      if (!openedParticipant) return null;
      return findRegistrationParticipant(
        participantsQuery.data ?? [],
        openedParticipant.id,
      );
    });
  }, [participantsQuery.data]);
  if (participantsQuery.isLoading || challengeQuery.isLoading) return <Loading label="Beheer laden" />;
  if (participantsQuery.isError || challengeQuery.isError) return <ErrorState retry={() => { void participantsQuery.refetch(); void challengeQuery.refetch(); }} />;
  function saveDates(event: FormEvent) { event.preventDefault(); updateChallenge.mutate({ data: dates }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetChallengeQueryKey() }); } }); }
  function deleteParticipant(id: number) { if (window.confirm('Deze deelnemer en het bijbehorende loginaccount definitief verwijderen?')) remove.mutate({ id }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() }); void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); } }); }
  return <div className="page-in"><PageIntro eyebrow="Beheer" title="Deelnemers & periode" description="Hou de challenge actueel en help scholen verder met cijfers die kloppen." /><section className="grid gap-6 xl:grid-cols-[1fr_360px]"><div className="rounded-xl border border-border/70 bg-card"><div className="flex flex-col justify-between gap-4 border-b border-border/70 p-6 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Deelnemers</p><h2 className="serif mt-2 text-3xl text-primary">{participantsQuery.data?.length ?? 0} scholen</h2></div><Button variant="gold" onClick={() => setParticipantModal('new')} testId="button-add-participant"><Plus className="size-4" /> Deelnemer toevoegen</Button></div><div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-accent" placeholder="Zoek op school, naam of e-mail" data-testid="input-search-participants" /></div><div className="flex items-center gap-2"><Filter className="size-4 text-muted-foreground" /><select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value as any)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="select-filter-country"><option value="Alle">Alle landen</option><option value="Nederland">Nederland</option><option value="België">België</option></select></div></div><div className="divide-y divide-border/60">{participants.length === 0 ? <div className="p-5"><EmptyState title="Geen deelnemers gevonden" text="Pas je zoekopdracht aan of voeg een nieuwe school toe." /></div> : <div><div className="hidden grid-cols-[2fr_90px_90px_90px_90px_90px_90px_132px] gap-3 border-b border-border/60 bg-secondary/45 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground lg:grid"><span>School</span><span className="text-right">Start</span><span className="text-right">Doel</span><span className="text-right">Proef</span><span className="text-right">Aanw</span><span className="text-right">Nieuw</span><span className="text-right">Groei</span><span className="text-right">Acties</span></div>{participants.map((participant) => <div key={participant.id} className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 transition-colors hover:bg-secondary/20 lg:grid lg:grid-cols-[2fr_90px_90px_90px_90px_90px_90px_132px] lg:items-center last:border-0"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">{initials(participant.schoolName)}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-primary">{participant.schoolName}</p><p className="truncate text-xs text-muted-foreground">{participant.contactName} · {participant.email}</p></div></div><div className="flex justify-between lg:block lg:text-right"><span className="text-xs text-muted-foreground lg:hidden">Startleden</span><span className="text-sm font-semibold text-primary">{participant.startingMembers != null ? participant.startingMembers : <span className="text-muted-foreground italic">Nog niet</span>}</span></div><div className="flex justify-between lg:block lg:text-right"><span className="text-xs text-muted-foreground lg:hidden">Doel</span><span className="text-sm font-semibold text-primary">{participant.targetNewMembers != null ? `+${participant.targetNewMembers}` : <span className="text-muted-foreground italic">Nog niet</span>}</span></div><div className="flex justify-between lg:block lg:text-right"><span className="text-xs text-muted-foreground lg:hidden">Proeflessen</span><span className="text-sm text-primary">{participant.totals?.signups ?? 0}</span></div><div className="flex justify-between lg:block lg:text-right"><span className="text-xs text-muted-foreground lg:hidden">Aanwezig</span><span className="text-sm text-primary">{participant.totals?.attendance ?? 0}</span></div><div className="flex justify-between lg:block lg:text-right"><span className="text-xs text-muted-foreground lg:hidden">Ingeschreven</span><span className="text-sm text-primary">{participant.totals?.enrolled ?? 0}</span></div><div className="flex justify-between lg:block lg:text-right"><span className="text-xs text-muted-foreground lg:hidden">Groei</span><span className="text-sm font-semibold text-[#557b5b]">{participant.startingMembers != null ? pct(participant.scores?.growthPercent) : <span className="text-muted-foreground">—</span>}</span></div><div className="flex justify-end gap-1 border-t border-border/60 pt-3 lg:border-0 lg:pt-0"><button onClick={() => setRegistrationInstructions(participant)} className="rounded-lg p-2 text-accent-foreground hover:bg-accent/15" aria-label={`Open registratie-instructie voor ${participant.schoolName}`} data-testid={`button-registration-instructions-${participant.id}`}><ClipboardCopy className="size-4" /></button><button onClick={() => setCoachingParticipantId(participant.id)} className="rounded-lg p-2 text-accent hover:bg-accent/10" aria-label={`Coaching panel ${participant.schoolName}`} data-testid={`button-coach-${participant.id}`}><MessageSquare className="size-4" /></button><Link href={`/beheer/financien/${participant.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`Coaching Financiën ${participant.schoolName}`} data-testid={`button-coach-financien-${participant.id}`}><Landmark className="size-4" /></Link><Link href={`/beheer/deelnemer/${participant.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`Bekijk dashboard ${participant.schoolName}`} data-testid={`button-view-participant-${participant.id}`}><BarChart3 className="size-4" /></Link><button onClick={() => setParticipantModal(participant)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`Bewerk ${participant.schoolName}`} data-testid={`button-edit-participant-${participant.id}`}><Pencil className="size-4" /></button><button onClick={() => deleteParticipant(participant.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Verwijder ${participant.schoolName}`} data-testid={`button-delete-participant-${participant.id}`}><Trash2 className="size-4" /></button></div></div>)}</div>}</div></div><form onSubmit={saveDates} className="h-fit rounded-xl border border-border/70 bg-card p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Actieve periode</p><h2 className="serif mt-2 text-3xl text-primary">Challenge data</h2></div><CalendarDays className="size-5 text-accent-foreground" /></div><p className="mt-3 text-sm leading-6 text-muted-foreground">De weken en resterende dagen worden hieruit berekend.</p><div className="mt-7 space-y-4"><label className="block space-y-2"><span className="text-xs font-semibold text-muted-foreground">Startdatum</span><input type="date" value={dates.startDate} onChange={(event) => setDates({ ...dates, startDate: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-primary outline-none focus:border-accent" data-testid="input-challenge-start-date" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">Einddatum</span><input type="date" value={dates.endDate} onChange={(event) => setDates({ ...dates, endDate: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-primary outline-none focus:border-accent" data-testid="input-challenge-end-date" /></label></div><Button type="submit" className="mt-6 w-full" disabled={updateChallenge.isPending} testId="button-save-challenge-dates"><Save className="size-4" /> {updateChallenge.isPending ? 'Opslaan…' : 'Opslaan'}</Button></form></section><AdminCorrectionSection />{participantModal && <ParticipantModal participant={participantModal === 'new' ? undefined : participantModal} onClose={() => setParticipantModal(null)} saving={create.isPending || update.isPending} onSave={(data) => { if (participantModal === 'new') create.mutate({ data }, { onSuccess: (participant) => { setParticipantModal(null); setRegistrationInstructions(participant); void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() }); }, onError: () => toast({ title: 'Deelnemer niet toegevoegd', description: 'Controleer de gegevens en probeer het opnieuw.', variant: 'destructive' }) }); else update.mutate({ id: participantModal.id, data }, { onSuccess: () => { setParticipantModal(null); void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() }); } }); }} />}<RegistrationInstructionsForParticipant participants={participantsQuery.data ?? []} participantId={registrationInstructions?.id ?? null}>{(participant) => <RegistrationInstructionsModal participant={participant} onClose={() => setRegistrationInstructions(null)} />}</RegistrationInstructionsForParticipant><CoachingForParticipant participants={participantsQuery.data ?? []} participantId={coachingParticipantId}>{(participant) => <CoachingModal participant={participant} onClose={() => setCoachingParticipantId(null)} />}</CoachingForParticipant></div>;
}
*/
function RegistrationInstructionsModal({ participant, onClose }: { participant: Participant; onClose: () => void }) {
  const { toast } = useToast();
  const instructions = buildRegistrationInstructions(participant.email, productionSignUpUrl);

  async function copyInstructions() {
    await copyRegistrationInstructions(
      instructions,
      navigator.clipboard,
      () => {
        toast({ title: 'Registratie-instructie gekopieerd', description: 'Je kunt de volledige tekst nu direct delen.' });
      },
      () => {
        toast({ title: 'Kopiëren lukt niet', description: 'Selecteer de tekst hieronder en kopieer deze handmatig.', variant: 'destructive' });
      },
    );
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-primary/30 p-4 backdrop-blur-sm"><div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-8" role="dialog" aria-modal="true" aria-labelledby="registration-instructions-title"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Registratie</p><h2 id="registration-instructions-title" className="serif mt-2 text-3xl text-primary">Deel de registratie-instructie</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="Sluiten" data-testid="button-close-registration-instructions"><X className="size-5" /></button></div><p className="mt-4 text-sm leading-6 text-muted-foreground">Deel onderstaande tekst met <strong className="text-primary">{participant.contactName}</strong> van {participant.schoolName}.</p><div className="mt-6 rounded-xl border border-border/70 bg-background p-4"><p className="select-text whitespace-pre-wrap text-sm leading-6 text-primary" data-testid="text-registration-instructions">{instructions}</p></div><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={onClose} testId="button-finish-registration-instructions">Klaar</Button><Button variant="gold" onClick={() => void copyInstructions()} testId="button-copy-registration-instructions"><ClipboardCopy className="size-4" /> Kopieer link en tekst</Button></div></div></div>;
}

/*
function LegacyParticipantModal({ participant, onClose, onSave, saving }: { participant?: Participant; onClose: () => void; onSave: (data: { schoolName: string; contactName: string; email: string; startingMembers?: number; country: ParticipantCountry }) => void; saving: boolean }) {
  const [form, setForm] = useState({ schoolName: participant?.schoolName ?? '', contactName: participant?.contactName ?? '', email: participant?.email ?? '', startingMembers: participant?.startingMembers != null ? String(participant.startingMembers) : '', country: participant?.country ?? 'Nederland' });
  useEffect(() => {
    if (!participant) return;
    setForm({
      schoolName: participant.schoolName,
      contactName: participant.contactName,
      email: participant.email,
      startingMembers: participant.startingMembers != null ? String(participant.startingMembers) : '',
      country: participant.country,
    });
  }, [
    participant?.id,
    participant?.schoolName,
    participant?.contactName,
    participant?.email,
    participant?.startingMembers,
    participant?.country,
  ]);
  function submit(event: FormEvent) { event.preventDefault(); onSave({ schoolName: form.schoolName, contactName: form.contactName, email: form.email, country: form.country as ParticipantCountry, ...(form.startingMembers.trim() !== '' ? { startingMembers: Number(form.startingMembers) } : {}) }); }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-primary/30 p-4 backdrop-blur-sm"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-8" data-testid="form-participant-modal"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">{participant ? 'Deelnemer bewerken' : 'Nieuwe deelnemer'}</p><h2 className="serif mt-2 text-3xl text-primary">{participant ? participant.schoolName : 'Een school toevoegen'}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="Sluiten" data-testid="button-close-participant-modal"><X className="size-5" /></button></div><div className="mt-7 grid gap-4 sm:grid-cols-2"><label className="space-y-2 sm:col-span-2"><span className="text-xs font-semibold text-muted-foreground">Naam dansschool</span><input required value={form.schoolName} onChange={(event) => setForm({ ...form, schoolName: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-school-name" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">Contactpersoon</span><input required value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-contact-name" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">E-mailadres</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-email" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">Land</span><select required value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value as ParticipantCountry })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-country"><option value="Nederland">Nederland</option><option value="België">België</option></select></label></div><p className="mt-5 text-xs leading-5 text-muted-foreground">Het aantal startleden vult de deelnemer zelf in bij de eerste aanmelding.</p><div className="mt-8 flex justify-end gap-3"><Button variant="ghost" onClick={onClose} testId="button-cancel-participant">Annuleren</Button><Button type="submit" disabled={saving} testId="button-save-participant"><Save className="size-4" /> {saving ? 'Opslaan…' : 'Opslaan'}</Button></div></form></div>;
}
function LegacyParticipantModal({ participant, onClose, onSave, saving }: { participant?: Participant; onClose: () => void; onSave: (data: { schoolName: string; contactName: string; email: string; startingMembers?: number; country: ParticipantCountry }) => void; saving: boolean }) {
  const [form, setForm] = useState({ schoolName: participant?.schoolName ?? '', contactName: participant?.contactName ?? '', email: participant?.email ?? '', startingMembers: participant?.startingMembers != null ? String(participant.startingMembers) : '', country: participant?.country ?? 'Nederland' });
  useEffect(() => {
    if (!participant) return;
    setForm({
      schoolName: participant.schoolName,
      contactName: participant.contactName,
      email: participant.email,
      startingMembers: participant.startingMembers != null ? String(participant.startingMembers) : '',
      country: participant.country,
    });
  }, [
    participant?.id,
    participant?.schoolName,
    participant?.contactName,
    participant?.email,
    participant?.startingMembers,
    participant?.country,
  ]);
  function submit(event: FormEvent) { event.preventDefault(); onSave({ schoolName: form.schoolName, contactName: form.contactName, email: form.email, country: form.country as ParticipantCountry, ...(form.startingMembers.trim() !== '' ? { startingMembers: Number(form.startingMembers) } : {}) }); }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-primary/30 p-4 backdrop-blur-sm"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-8" data-testid="form-participant-modal"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">{participant ? 'Deelnemer bewerken' : 'Nieuwe deelnemer'}</p><h2 className="serif mt-2 text-3xl text-primary">{participant ? participant.schoolName : 'Een school toevoegen'}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="Sluiten" data-testid="button-close-participant-modal"><X className="size-5" /></button></div><div className="mt-7 grid gap-4 sm:grid-cols-2"><label className="space-y-2 sm:col-span-2"><span className="text-xs font-semibold text-muted-foreground">Naam dansschool</span><input required value={form.schoolName} onChange={(event) => setForm({ ...form, schoolName: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-school-name" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">Contactpersoon</span><input required value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-contact-name" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">E-mailadres</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-email" /></label><label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">Land</span><select required value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value as ParticipantCountry })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-participant-country"><option value="Nederland">Nederland</option><option value="België">België</option></select></label></div><p className="mt-5 text-xs leading-5 text-muted-foreground">Het aantal startleden vult de deelnemer zelf in bij de eerste aanmelding.</p><div className="mt-8 flex justify-end gap-3"><Button variant="ghost" onClick={onClose} testId="button-cancel-participant">Annuleren</Button><Button type="submit" disabled={saving} testId="button-save-participant"><Save className="size-4" /> {saving ? 'Opslaan…' : 'Opslaan'}</Button></div></form></div>;
}
*/
function CoachingModal({ participant, onClose }: { participant: Participant; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesQuery = useGetAdminParticipantMessages(participant.id, { query: { enabled: !!participant.id, queryKey: getGetAdminParticipantMessagesQueryKey(participant.id) } });
  const messages = messagesQuery.data ?? [];
  const createMessage = useCreateParticipantMessage();
  const sendReminder = useSendParticipantReminder();

  const [messageBody, setMessageBody] = useState("");

  function handleSendReminder() {
    sendReminder.mutate({ id: participant.id }, {
      onSuccess: () => toast({ title: 'Herinnering verstuurd', description: 'De deelnemer heeft een e-mail ontvangen.' }),
      onError: () => toast({ title: 'Fout bij versturen', description: 'Kan de herinnering niet versturen.', variant: 'destructive' })
    });
  }

  function handlePostMessage(e: FormEvent) {
    e.preventDefault();
    if (!messageBody.trim()) return;
    createMessage.mutate({ id: participant.id, data: { body: messageBody } }, {
      onSuccess: () => {
        setMessageBody('');
        toast({ title: 'Bericht geplaatst', description: 'De deelnemer ziet dit op hun dashboard.' });
        void qc.invalidateQueries({ queryKey: getGetAdminParticipantMessagesQueryKey(participant.id) });
        void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetMessagesQueryKey() });
      },
      onError: () => toast({ title: 'Fout bij plaatsen', description: 'Kan het bericht niet plaatsen.', variant: 'destructive' })
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-primary/30 p-0 backdrop-blur-sm transition-all sm:p-4">
      <div className="flex h-full w-full max-w-lg flex-col overflow-hidden border-border bg-card shadow-2xl duration-300 animate-in slide-in-from-right-8 sm:rounded-2xl sm:border">
        <div className="flex items-center justify-between border-b border-border/60 bg-background p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Coaching</p>
            <h2 className="serif mt-1 text-2xl text-primary">{participant.schoolName}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="Sluiten" data-testid="button-close-coaching-modal"><X className="size-5" /></button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto bg-card p-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-secondary/50 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Groei</p>
              <p className="mt-1 text-lg font-semibold text-[#557b5b]">{pct(participant.scores?.growthPercent)}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Conversie</p>
              <p className="mt-1 text-lg font-semibold text-primary">{pct(participant.scores?.conversionPercent)}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ingeschreven</p>
              <p className="mt-1 text-lg font-semibold text-primary">{participant.totals?.enrolled ?? 0}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary">Snelle acties</h3>
            <Button variant="outline" onClick={handleSendReminder} disabled={sendReminder.isPending} className="h-11 w-full justify-start text-sm" testId="button-send-reminder">
              <BellRing className="mr-2 size-4" /> {sendReminder.isPending ? 'Versturen...' : 'Stuur handmatige herinnering e-mail'}
            </Button>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary">Berichten aan deelnemer</h3>
            <div className="space-y-3">
              {messagesQuery.isLoading ? (
                <div className="animate-pulse p-4 text-center text-xs text-muted-foreground">Berichten laden...</div>
              ) : messages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-background p-6 text-center text-sm text-muted-foreground">
                  Nog geen berichten geplaatst.
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className="rounded-xl border border-border/60 bg-background p-4 text-sm" data-testid={`admin-message-${msg.id}`}>
                    <p className="leading-relaxed text-primary whitespace-pre-wrap">{msg.body}</p>
                    <p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">{fmtDate(msg.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border/60 bg-background p-6">
          <form onSubmit={handlePostMessage} className="space-y-3">
            <textarea required value={messageBody} onChange={e => setMessageBody(e.target.value)} placeholder="Schrijf een bericht of tip voor de deelnemer..." className="min-h-24 w-full resize-none rounded-xl border border-input bg-background p-3 text-sm outline-none focus:border-accent" data-testid="input-coach-message" />
            <div className="flex justify-end">
              <Button type="submit" variant="gold" disabled={createMessage.isPending} testId="button-post-message">
                <Send className="mr-2 size-4" /> {createMessage.isPending ? 'Plaatsen...' : 'Bericht plaatsen'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AdminCorrectionSection() {
  const query = useGetAdminWeeklyEntries();
  const [search, setSearch] = useState('');

  const entries = useMemo(() => {
    if (!query.data) return [];
    return query.data.filter(e => e.schoolName.toLowerCase().includes(search.toLowerCase()) || `week ${e.weekNumber}`.includes(search.toLowerCase()));
  }, [query.data, search]);

  if (query.isLoading) return <Loading label="Cijfers laden" />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;

  return (
    <section className="mt-6 rounded-xl border border-border/70 bg-card">
      <div className="flex flex-col justify-between gap-4 border-b border-border/70 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Datakwaliteit</p>
          <h2 className="serif mt-2 text-3xl text-primary">Cijfers corrigeren</h2>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-accent" placeholder="Zoek op school of week" data-testid="input-search-entries" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[800px] divide-y divide-border/60">
          <div className="grid grid-cols-[1.5fr_100px_1fr_1fr_1fr_100px] gap-4 bg-secondary/45 px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <span>Dansschool</span>
            <span>Week</span>
            <span className="text-right">Proeflessen</span>
            <span className="text-right">Aanwezig</span>
            <span className="text-right">Nieuw</span>
            <span className="text-right">Actie</span>
          </div>
          {entries.length === 0 ? (
            <div className="p-6"><EmptyState title="Geen resultaten" text="Er zijn geen ingevulde cijfers gevonden voor deze zoekopdracht." /></div>
          ) : (
            entries.map(entry => <AdminEntryRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </section>
  );
}

function AdminEntryRow({ entry }: { entry: AdminWeeklyEntry }) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ signups: String(entry.signups), attendance: String(entry.attendance), enrolled: String(entry.enrolled) });
  const update = useUpdateAdminWeeklyEntry();
  const qc = useQueryClient();

  function onSave(e: FormEvent) {
    e.preventDefault();
    update.mutate(
      { params: { id: entry.id, participantId: entry.participantId }, data: { signups: Number(form.signups) || 0, attendance: Number(form.attendance) || 0, enrolled: Number(form.enrolled) || 0 } },
      { onSuccess: () => {
          setIsEditing(false);
          void qc.invalidateQueries({ queryKey: getGetAdminWeeklyEntriesQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetAdminParticipantViewQueryKey(entry.participantId) });
      }}
    );
  }

  if (isEditing) {
    return (
      <form onSubmit={onSave} className="grid grid-cols-[1.5fr_100px_1fr_1fr_1fr_100px] items-center gap-4 px-6 py-3 bg-accent/5">
        <span className="truncate text-sm font-semibold text-primary">{entry.schoolName}</span>
        <span className="text-sm text-muted-foreground">Week {entry.weekNumber}</span>
        <input type="number" min="0" required value={form.signups} onChange={e => setForm({...form, signups: e.target.value})} className="h-9 w-full rounded-md border border-input bg-background px-2 text-right text-sm outline-none focus:border-accent" data-testid={`input-edit-signups-${entry.id}`} />
        <input type="number" min="0" required value={form.attendance} onChange={e => setForm({...form, attendance: e.target.value})} className="h-9 w-full rounded-md border border-input bg-background px-2 text-right text-sm outline-none focus:border-accent" data-testid={`input-edit-attendance-${entry.id}`} />
        <input type="number" min="0" required value={form.enrolled} onChange={e => setForm({...form, enrolled: e.target.value})} className="h-9 w-full rounded-md border border-input bg-background px-2 text-right text-sm outline-none focus:border-accent" data-testid={`input-edit-enrolled-${entry.id}`} />
        <div className="flex justify-end gap-1">
          <button type="button" onClick={() => setIsEditing(false)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="Annuleren" data-testid={`button-cancel-edit-${entry.id}`}><X className="size-4" /></button>
          <button type="submit" disabled={update.isPending} className="rounded p-1.5 text-accent hover:bg-accent/20" aria-label="Opslaan" data-testid={`button-save-edit-${entry.id}`}><Save className="size-4" /></button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid grid-cols-[1.5fr_100px_1fr_1fr_1fr_100px] items-center gap-4 px-6 py-4 hover:bg-secondary/20">
      <span className="truncate text-sm font-semibold text-primary">{entry.schoolName}</span>
      <span className="text-sm text-muted-foreground">Week {entry.weekNumber}</span>
      <span className="text-right text-sm font-medium text-primary">{entry.signups}</span>
      <span className="text-right text-sm font-medium text-primary">{entry.attendance}</span>
      <span className="text-right text-sm font-medium text-primary">{entry.enrolled}</span>
      <div className="text-right">
        <button onClick={() => setIsEditing(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`Bewerk week ${entry.weekNumber} van ${entry.schoolName}`} data-testid={`button-edit-entry-${entry.id}`}>
          <Pencil className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const dashboard = useGetDashboard();
  const updateProfile = useUpdateProfile();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editingMembers, setEditingMembers] = useState(false);
  const [membersValue, setMembersValue] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [profileRevision, setProfileRevision] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isAdmin = isAdminUser(user);

  useEffect(() => {
    if (dashboard.data?.participant && !editingMembers) {
      const startingMembers = dashboard.data.participant.startingMembers;
      setMembersValue(startingMembers != null ? String(startingMembers) : '');
      const targetNewMembers = dashboard.data.participant.targetNewMembers;
      setTargetValue(targetNewMembers != null ? String(targetNewMembers) : '');
      setProfileRevision(dashboard.data.participant.revision);
    }
  }, [dashboard.data, editingMembers, isAdmin]);

  if (!isLoaded || (dashboard.isLoading && !isAdmin)) return <Loading label="Profiel laden" />;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || (isAdmin ? 'Beheerder' : 'Je profiel');
  const participant = dashboard.data?.participant;
  const challengeStartDate = dashboard.data?.challenge?.startDate;

  function handleSaveMembers(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const val = Number(membersValue);
    if (isNaN(val) || val < 1) return;
    const target = Number(targetValue);
    if (isNaN(target) || target < 1) return;
    if (!participant || profileRevision === null) return;
    updateProfile.mutate({ data: { startingMembers: val, targetNewMembers: target, revision: profileRevision } }, {
      onSuccess: (updated) => {
        setMembersValue(updated.startingMembers?.toString() ?? '');
        setTargetValue(updated.targetNewMembers?.toString() ?? '');
        setProfileRevision(updated.revision);
        setSaveError(null);
        qc.setQueryData(getGetDashboardQueryKey(), (current: typeof dashboard.data) =>
          current ? { ...current, participant: updated } : current);
        setEditingMembers(false);
        toast({ title: 'Profiel bijgewerkt', description: 'Je startpunt en groeidoel zijn opgeslagen.' });
        void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
      },
      onError: (error) => {
        const current = currentParticipantFromConflict(error);
        if (current) {
          setMembersValue(current.startingMembers?.toString() ?? '');
          setTargetValue(current.targetNewMembers?.toString() ?? '');
          setProfileRevision(current.revision);
          setSaveError(profileConflictMessage);
          toast({ title: 'Profiel intussen gewijzigd', description: profileConflictMessage, variant: 'destructive' });
          return;
        }
        const message = 'Je profiel kon niet worden opgeslagen. Controleer de aantallen en probeer het opnieuw.';
        setSaveError(message);
        toast({ title: 'Fout bij opslaan', description: message, variant: 'destructive' });
      }
    });
  }

  return <div className="page-in"><PageIntro eyebrow="Instellingen" title="Jouw account" description="Een rustige plek voor je profiel en toegang." /><div className="grid max-w-4xl gap-6 lg:grid-cols-[1fr_300px]"><section className="rounded-xl border border-border/70 bg-card p-6 sm:p-8"><div className="flex items-center gap-4 border-b border-border/60 pb-7"><span className="grid size-16 place-items-center rounded-full bg-accent text-lg font-bold text-accent-foreground" data-testid="text-profile-initials">{initials(name)}</span><div><h2 className="serif text-3xl text-primary" data-testid="text-profile-name">{name}</h2><p className="mt-1 text-sm text-muted-foreground" data-testid="text-profile-email">{user?.primaryEmailAddress?.emailAddress ?? 'Geen e-mailadres bekend'}</p></div></div><div className="mt-7 space-y-5"><div className="flex items-center gap-4"><UserRound className="size-5 text-accent-foreground" /><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Naam</p><p className="mt-1 text-sm font-semibold text-primary">{name}</p></div></div>

      {!isAdmin && <div className="flex items-start gap-4"><Users className="mt-1 size-5 text-accent-foreground" /><div className="flex-1"><div className="flex items-center justify-between"><p className="text-xs uppercase tracking-wider text-muted-foreground">Startpunt & groeidoel</p>{!editingMembers && <button onClick={() => { setSaveError(null); setProfileRevision(participant?.revision ?? null); setEditingMembers(true); }} className="text-xs font-semibold text-accent-foreground hover:underline" data-testid="button-edit-members">Bewerk</button>}</div>{editingMembers ? <form onSubmit={handleSaveMembers} className="mt-3 rounded-lg border border-border/70 bg-background p-4" data-testid="form-settings-members"><p className="mb-3 text-xs text-muted-foreground">Startleden zijn je actieve leden op {fmtDate(challengeStartDate) || 'de startdatum'}; je doel is het aantal extra leden dat je tijdens de challenge wilt behalen.</p>{saveError && <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-foreground" data-testid="status-settings-save-error"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><p>{saveError}</p></div>}<div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold text-muted-foreground">Startleden<input type="number" min="1" required value={membersValue} onChange={(e) => setMembersValue(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-settings-members" /></label><label className="text-xs font-semibold text-muted-foreground">Gewenste extra leden<input type="number" min="1" required value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-settings-target-members" /></label><Button type="submit" disabled={updateProfile.isPending} testId="button-save-members" className="self-end h-10 px-4 py-0"><Save className="mr-2 size-4" /> Opslaan</Button></div></form> : <p className="mt-1 text-sm font-semibold text-primary">{participant?.startingMembers != null ? `${participant.startingMembers} startleden · +${participant.targetNewMembers ?? 'Nog niet'} gewenste extra leden` : <span className="text-muted-foreground italic font-normal">Nog niet ingevuld</span>}</p>}</div></div>}

      {!isAdmin && <div className="flex items-center gap-4"><MapPin className="size-5 text-accent-foreground" /><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Land</p><p className="mt-1 text-sm font-semibold text-primary">{participant?.country ?? '—'}</p></div></div>}

      <div className="flex items-center gap-4"><LockKeyhole className="size-5 text-accent-foreground" /><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Toegang</p><p className="mt-1 text-sm font-semibold text-primary">{appDisplayName} {isAdmin && '(Beheerder)'}</p></div></div></div></section><section className="h-fit rounded-xl border border-border/70 bg-secondary/45 p-6"><Settings className="size-5 text-accent-foreground" /><h2 className="serif mt-4 text-2xl text-primary">Account verlaten</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Log uit op dit apparaat. Je voortgang blijft bewaard.</p><Button variant="outline" className="mt-6 w-full" onClick={() => void signOut({ redirectUrl: basePath || '/' })} testId="button-settings-sign-out"><LogOut className="size-4" /> Uitloggen</Button></section></div></div>;
}

export function OnboardingPage() {
  const { user } = useUser();
  const isAdmin = isAdminUser(user);
  const dashboard = useGetDashboard({ query: { enabled: !isAdmin, queryKey: getGetDashboardQueryKey() } });
  const updateProfile = useUpdateProfile();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [startingMembers, setStartingMembers] = useState('');
  const [targetNewMembers, setTargetNewMembers] = useState('');
  const [profileRevision, setProfileRevision] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!dashboard.data || profileRevision !== null) return;
    setStartingMembers(dashboard.data.participant.startingMembers?.toString() ?? '');
    setTargetNewMembers(dashboard.data.participant.targetNewMembers?.toString() ?? '');
    setProfileRevision(dashboard.data.participant.revision);
  }, [dashboard.data, profileRevision]);
  if (isAdmin) return <Redirect to="/beheer" />;
  if (dashboard.isLoading) return <Loading label="Je startpunt voorbereiden" />;
  if (dashboard.isError || !dashboard.data) return <ErrorState retry={() => void dashboard.refetch()} />;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!dashboard.data || profileRevision === null) return;
    const starting = Number(startingMembers);
    const target = Number(targetNewMembers);
    if (!Number.isInteger(starting) || starting < 1 || !Number.isInteger(target) || target < 1) return;
    setSaveError(null);
    updateProfile.mutate({ data: { startingMembers: starting, targetNewMembers: target, revision: profileRevision } }, {
      onSuccess: (savedParticipant) => {
        toast({ title: 'Je uitgangspunt staat klaar', description: 'Je dashboard rekent vanaf nu met jouw eigen doel.' });
        if (savedParticipant) {
          qc.setQueryData(getGetDashboardQueryKey(), (current: { participant: Participant } | undefined) => (
            current
              ? { ...current, participant: { ...current.participant, ...savedParticipant } }
              : current
          ));
        }
        void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
        setLocation('/dashboard');
      },
      onError: (error) => {
        const current = currentParticipantFromConflict(error);
        if (current) {
          setStartingMembers(current.startingMembers?.toString() ?? '');
          setTargetNewMembers(current.targetNewMembers?.toString() ?? '');
          setProfileRevision(current.revision);
          setSaveError(profileConflictMessage);
          toast({ title: 'Profiel intussen gewijzigd', description: profileConflictMessage, variant: 'destructive' });
          return;
        }
        const message = 'Je profiel kon niet worden opgeslagen. Controleer je aantallen en probeer het opnieuw.';
        setSaveError(message);
        toast({ title: 'Opslaan lukt niet', description: message, variant: 'destructive' });
      },
    });
  }
  return <div className="page-in mx-auto max-w-3xl"><PageIntro eyebrow="Welkom bij ByB" title="Zet je vertrekpunt" description="Met deze twee aantallen maken we jouw groei tijdens de challenge persoonlijk en helder." /><section className="overflow-hidden rounded-2xl border border-border/70 bg-card"><div className="navy-panel p-6 text-primary-foreground sm:p-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-accent">Jouw challenge</p><h2 className="serif mt-3 text-3xl">Eerst weten waar je staat. Dan kiezen waar je heen wilt.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-primary-foreground/70">Dit is geen totaal aantal leden voor straks: je doel gaat alleen over de extra leden die je in deze challenge wilt winnen.</p></div><form onSubmit={submit} className="space-y-6 p-6 sm:p-8" data-testid="form-onboarding"><label className="block rounded-xl border border-border/70 bg-secondary/25 p-5"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Users className="size-4 text-accent-foreground" /> Hoeveel actieve leden heb je nu?</span><span className="mt-2 block text-sm leading-6 text-muted-foreground">Vul het aantal actieve leden op de startdatum van de challenge in. Dit is je uitgangspunt voor het groeipercentage.</span><input type="number" min="1" step="1" required value={startingMembers} onChange={(event) => setStartingMembers(event.target.value)} className="mt-4 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-onboarding-starting-members" /></label><label className="block rounded-xl border border-border/70 bg-secondary/25 p-5"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Target className="size-4 text-accent-foreground" /> Hoeveel extra leden wil je erbij?</span><span className="mt-2 block text-sm leading-6 text-muted-foreground">Vul alleen de nieuwe leden in die je tijdens deze challenge wilt winnen, niet je gewenste totaal aantal leden.</span><input type="number" min="1" step="1" required value={targetNewMembers} onChange={(event) => setTargetNewMembers(event.target.value)} className="mt-4 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" data-testid="input-onboarding-target-new-members" /></label>{saveError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground" data-testid="status-onboarding-save-error"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><p>{saveError}</p></div>}<div className="flex justify-end"><Button type="submit" disabled={updateProfile.isPending} testId="button-save-onboarding"><Check className="size-4" /> {updateProfile.isPending ? 'Opslaan…' : 'Naar mijn dashboard'}</Button></div></form></section></div>;
}

export function AdminParticipantViewPage() {
  const params = useParams();
  const id = Number(params.id);
  const query = useGetAdminParticipantView(id, { query: { enabled: !!id, queryKey: getGetAdminParticipantViewQueryKey(id) } });
  const updateProfile = useUpdateAdminParticipantProfile();
  const upsertWeeklyEntry = useUpsertAdminParticipantWeeklyEntry();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [startingMembers, setStartingMembers] = useState('');
  const [targetNewMembers, setTargetNewMembers] = useState('');
  const [profileRevision, setProfileRevision] = useState<number | null>(null);
  const [weeklyDrafts, setWeeklyDrafts] = useState<Record<number, { signups: string; attendance: string; enrolled: string }>>({});

  useEffect(() => {
    if (!query.data || profileRevision !== null) return;
    setStartingMembers(query.data.participant.startingMembers?.toString() ?? '');
    setTargetNewMembers(query.data.participant.targetNewMembers?.toString() ?? '');
    setProfileRevision(query.data.participant.revision);
  }, [profileRevision, query.data]);

  useEffect(() => {
    if (!query.data) return;
    setWeeklyDrafts(Object.fromEntries(query.data.weeks.map((week) => {
      const entry = query.data.entries.find((item) => item.weekNumber === week.weekNumber);
      return [week.weekNumber, {
        signups: entry ? String(entry.signups) : '',
        attendance: entry ? String(entry.attendance) : '',
        enrolled: entry ? String(entry.enrolled) : '',
      }];
    })));
  }, [query.data]);

  if (query.isLoading) return <Loading label="Deelnemer laden" />;
  if (query.isError && query.error instanceof ApiError && query.error.status === 404) {
    return (
      <EmptyState
        title="Deelnemer niet meer beschikbaar"
        text="Deze deelnemer bestaat niet meer of is intussen verwijderd."
        action={(
          <Link
            href="/beheer"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary/20 px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
            data-testid="link-back-to-participants"
          >
            <ArrowLeft className="size-4" /> Terug naar deelnemersoverzicht
          </Link>
        )}
      />
    );
  }
  if (query.isError || !query.data) return <ErrorState retry={() => void query.refetch()} />;

  const { participant, challenge, totals, scores, entries, weeks, messages } = query.data;

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    const starting = Number(startingMembers);
    const target = Number(targetNewMembers);
    if (!Number.isInteger(starting) || starting < 1 || !Number.isInteger(target) || target < 1) return;
    if (profileRevision === null) return;
    updateProfile.mutate({ id: participant.id, data: { startingMembers: starting, targetNewMembers: target, revision: profileRevision } }, {
      onSuccess: (updated) => {
        setStartingMembers(updated.startingMembers?.toString() ?? '');
        setTargetNewMembers(updated.targetNewMembers?.toString() ?? '');
        setProfileRevision(updated.revision);
        toast({ title: 'Profiel bijgewerkt', description: `De gegevens van ${participant.schoolName} zijn opgeslagen.` });
        void qc.invalidateQueries({ queryKey: getGetAdminParticipantViewQueryKey(participant.id) });
        void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
      },
      onError: (error) => {
        const current = currentParticipantFromConflict(error);
        if (current) {
          setStartingMembers(current.startingMembers?.toString() ?? '');
          setTargetNewMembers(current.targetNewMembers?.toString() ?? '');
          setProfileRevision(current.revision);
          toast({ title: 'Profiel intussen gewijzigd', description: profileConflictMessage, variant: 'destructive' });
          return;
        }
        toast({ title: 'Opslaan lukt niet', description: 'Controleer de aantallen en probeer het opnieuw.', variant: 'destructive' });
      },
    });
  }

  function setWeeklyValue(weekNumber: number, field: 'signups' | 'attendance' | 'enrolled', value: string) {
    setWeeklyDrafts((current) => ({
      ...current,
      [weekNumber]: {
        signups: current[weekNumber]?.signups ?? '',
        attendance: current[weekNumber]?.attendance ?? '',
        enrolled: current[weekNumber]?.enrolled ?? '',
        [field]: value,
      },
    }));
  }

  function saveWeek(event: FormEvent, weekNumber: number) {
    event.preventDefault();
    const draft = weeklyDrafts[weekNumber] ?? { signups: '', attendance: '', enrolled: '' };
    upsertWeeklyEntry.mutate({
      id: participant.id,
      data: {
        weekNumber,
        signups: Number(draft.signups) || 0,
        attendance: Number(draft.attendance) || 0,
        enrolled: Number(draft.enrolled) || 0,
      },
    }, {
      onSuccess: () => {
        toast({ title: `Week ${weekNumber} opgeslagen`, description: 'De cijfers van de deelnemer zijn bijgewerkt.' });
        void qc.invalidateQueries({ queryKey: getGetAdminParticipantViewQueryKey(participant.id) });
        void qc.invalidateQueries({ queryKey: getGetAdminWeeklyEntriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetParticipantsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
      },
      onError: () => toast({ title: 'Week opslaan lukt niet', description: 'Controleer de cijfers en probeer het opnieuw.', variant: 'destructive' }),
    });
  }

  const weeksDone = entries.filter((entry) => entry.signups > 0 || entry.attendance > 0 || entry.enrolled > 0).length;
  const completion = challenge?.totalWeeks ? Math.min(100, (weeksDone / challenge.totalWeeks) * 100) : 0;

  return (
    <div className="page-in pb-20">
      <div className="mb-6">
        <Link href="/beheer" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors" data-testid="link-back-to-beheer">
          <ArrowLeft className="size-4" /> Terug naar beheer
        </Link>
      </div>

      <div className="mb-8 flex items-center gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-destructive" data-testid="banner-admin-participant-warning">
        <ShieldCheck className="size-5 shrink-0" />
        <div>
           <p className="text-sm font-semibold">Je blijft ingelogd als beheerder</p>
           <p className="mt-0.5 text-xs">Wijzigingen op deze pagina worden toegepast op deelnemer {participant.schoolName}.</p>
        </div>
      </div>

      <PageIntro eyebrow="Coaching" title={participant.schoolName} description={`${participant.contactName} · ${participant.email}`} action={<Link href={`/beheer/financien/${participant.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent/85" data-testid="link-view-participant-finances"><Landmark className="size-4" /> Bekijk financiën</Link>} />

      <section className="navy-panel relative overflow-hidden rounded-2xl p-6 text-primary-foreground sm:p-8">
        <div className="absolute -right-20 -top-28 size-80 rounded-full border border-accent/15" />
        <div className="absolute -right-6 -top-14 size-56 rounded-full border border-accent/10" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_310px] lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-accent">
              <CalendarCheck className="size-4" /> {challenge?.isActive ? 'Challenge actief' : 'Challenge staat klaar'}
            </div>
            <h2 className="serif mt-4 max-w-xl text-4xl leading-tight sm:text-5xl">Elke week telt op naar groei.</h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-primary-foreground/65">
              De school heeft {weeksDone} van de {challenge?.totalWeeks ?? 4} weken ingevuld.
            </p>
          </div>
          <div>
            <div className="mb-3 flex justify-between text-xs text-primary-foreground/60">
              <span>Voortgang</span><span className="font-semibold text-accent">{Math.round(completion)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-primary-foreground/10">
              <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${completion}%` }} />
            </div>
            <div className="mt-4 flex justify-between text-xs text-primary-foreground/55">
              <span>Start {fmtDate(challenge?.startDate)}</span><span>{challenge?.daysRemaining ?? 0} dagen over</span>
            </div>
          </div>
        </div>
      </section>

       <section className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-7">
         <div className="flex items-start justify-between gap-4">
           <div>
             <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Deelnemerprofiel</p>
             <h2 className="serif mt-2 text-3xl text-primary">Startpunt & groeidoel</h2>
             <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Pas de aantallen aan waarmee het dashboard en de ranglijst van deze deelnemer rekenen.</p>
           </div>
           <Users className="size-5 shrink-0 text-accent-foreground" />
         </div>
         <form onSubmit={saveProfile} className="mt-6 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid="form-admin-participant-profile">
           <label className="space-y-2">
             <span className="text-xs font-semibold text-muted-foreground">Startleden</span>
             <input type="number" min="1" step="1" required value={startingMembers} onChange={(event) => setStartingMembers(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold text-primary outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20" data-testid="input-admin-starting-members" />
           </label>
           <label className="space-y-2">
             <span className="text-xs font-semibold text-muted-foreground">Gewenste extra leden</span>
             <input type="number" min="1" step="1" required value={targetNewMembers} onChange={(event) => setTargetNewMembers(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold text-primary outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20" data-testid="input-admin-target-new-members" />
           </label>
           <Button type="submit" variant="gold" disabled={updateProfile.isPending} testId="button-save-admin-participant-profile"><Save className="size-4" /> {updateProfile.isPending ? 'Opslaan…' : 'Profiel opslaan'}</Button>
         </form>
       </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Proeflessen" value={`${totals?.signups ?? 0}`} detail="aangemeld in totaal" icon={Target} />
        <MetricCard label="Aanwezig" value={`${totals?.attendance ?? 0}`} detail="van de proeflessen" icon={CalendarCheck} />
        <MetricCard label="Ingeschreven" value={`${totals?.enrolled ?? 0}`} detail="nieuwe leden" icon={TrendingUp} accent />
        <MetricCard label="Doel nieuwe leden" value={`${totals?.enrolled ?? 0} van ${participant.targetNewMembers ?? 1}`} detail={`${Math.round(((totals?.enrolled ?? 0) / Math.max(1, participant.targetNewMembers ?? 1)) * 100)}% van gewenste extra leden`} icon={Target} accent />
        <MetricCard label="Groei" value={pct(scores?.growthPercent)} detail={`t.o.v. ${participant.startingMembers ?? '?'} startleden`} icon={Activity} />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <div className="rounded-xl border border-border/70 bg-card p-6 sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">De funnel</p>
              <h2 className="serif mt-2 text-3xl text-primary">Van eerste les naar lid</h2>
            </div>
          </div>
          <div className="mt-8 space-y-5">
            <FunnelRow label="Proeflessen" value={totals?.signups ?? 0} percent={100} color="bg-primary" />
            <FunnelRow label="Aanwezig" value={totals?.attendance ?? 0} percent={totals?.signups ? (totals.attendance / totals.signups) * 100 : 0} color="bg-accent" />
            <FunnelRow label="Ingeschreven" value={totals?.enrolled ?? 0} percent={totals?.signups ? (totals.enrolled / totals.signups) * 100 : 0} color="bg-[#7e9c82]" />
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-6 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">De scores</p>
          <h2 className="serif mt-2 text-3xl text-primary">De drie richtingen</h2>
          <div className="mt-7 space-y-5">
            <ScoreLine label="Groei" value={pct(scores?.growthPercent)} />
            <ScoreLine label="Conversie" value={pct(scores?.conversionPercent)} />
            <ScoreLine label="Aanwezigheid" value={pct(scores?.attendancePercent)} />
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-7">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Overzicht per week</p>
            <h2 className="serif mt-2 text-3xl text-primary">Cijfers bijwerken</h2>
          </div>
        </div>
        {weeks.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="Geen weken" text="Er is nog geen data beschikbaar voor deze challenge." />
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {weeks.map((week) => {
              const entry = entries.find(e => e.weekNumber === week.weekNumber);
              const draft = weeklyDrafts[week.weekNumber] ?? { signups: '', attendance: '', enrolled: '' };
              return (
                <form key={week.weekNumber} onSubmit={(event) => saveWeek(event, week.weekNumber)} className={cn('rounded-xl border p-5 transition-shadow hover:shadow-sm', week.isCurrent ? 'border-accent/70 bg-accent/5 shadow-sm shadow-accent/10' : 'border-border/70 bg-secondary/20')} data-testid={`card-admin-week-${week.weekNumber}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-primary">{week.label || `Week ${week.weekNumber}`}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(week.startDate)} — {fmtDate(week.endDate)}</p>
                    </div>
                    {entry && <Check className="size-4 text-[#557b5b]" aria-label="Opgeslagen" />}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/50 pt-4">
                    <label className="space-y-2">
                      <span className="block text-center text-[10px] uppercase text-muted-foreground">Proef</span>
                      <input type="number" min="0" step="1" required value={draft.signups} onChange={(event) => setWeeklyValue(week.weekNumber, 'signups', event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-center text-sm font-semibold text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" aria-label={`Proeflessen week ${week.weekNumber}`} data-testid={`input-admin-signups-week-${week.weekNumber}`} />
                    </label>
                    <label className="space-y-2">
                      <span className="block text-center text-[10px] uppercase text-muted-foreground">Aanw</span>
                      <input type="number" min="0" step="1" required value={draft.attendance} onChange={(event) => setWeeklyValue(week.weekNumber, 'attendance', event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-center text-sm font-semibold text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" aria-label={`Aanwezig week ${week.weekNumber}`} data-testid={`input-admin-attendance-week-${week.weekNumber}`} />
                    </label>
                    <label className="space-y-2">
                      <span className="block text-center text-[10px] uppercase text-muted-foreground">Nieuw</span>
                      <input type="number" min="0" step="1" required value={draft.enrolled} onChange={(event) => setWeeklyValue(week.weekNumber, 'enrolled', event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-center text-sm font-semibold text-[#557b5b] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" aria-label={`Ingeschreven week ${week.weekNumber}`} data-testid={`input-admin-enrolled-week-${week.weekNumber}`} />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button type="submit" variant={week.isCurrent ? 'gold' : 'outline'} disabled={upsertWeeklyEntry.isPending} testId={`button-admin-save-week-${week.weekNumber}`}><Save className="size-3.5" /> {upsertWeeklyEntry.isPending ? 'Opslaan…' : entry ? 'Bijwerken' : 'Week opslaan'}</Button>
                  </div>
                </form>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border/70 bg-card p-6 sm:p-7">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Ondersteuning</p>
            <h2 className="serif mt-2 text-3xl text-primary">Berichten aan deelnemer</h2>
          </div>
          <MessageSquare className="size-5 text-accent-foreground" />
        </div>
        {messages.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="Nog geen berichten" text="Er zijn nog geen berichten gestuurd naar deze deelnemer." />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className="rounded-xl border border-border/60 bg-secondary/30 p-5" data-testid={`card-message-${msg.id}`}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                    {initials(msg.authorName)}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-primary">{msg.authorName}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(msg.createdAt)}</p>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-primary">{msg.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NotFoundPage() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background p-6 text-center"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-accent-foreground">404</p><h1 className="serif mt-3 text-6xl text-primary">Deze pagina is niet in beeld.</h1><p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">Ga terug naar je overzicht om verder te gaan.</p><Link href="/dashboard" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-accent-foreground" data-testid="link-not-found-dashboard"><ArrowLeft className="size-4" /> Naar overzicht</Link></div></div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={RootRoute} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/onboarding"><Protected><OnboardingPage /></Protected></Route><Route path="/dashboard"><Protected><DashboardPage /></Protected></Route><Route path="/cijfers"><Protected><CijfersPage /></Protected></Route><Route path="/leaderboard"><Protected><LeaderboardPage /></Protected></Route><Route path="/financien"><Protected><FinancienPage /></Protected></Route><Route path="/beheer/deelnemer/:id"><Protected><AdminParticipantViewPage /></Protected></Route><Route path="/beheer/financien/:id"><Protected><AdminFinancienPage /></Protected></Route><Route path="/beheer/challenge"><Protected><AdminPage /></Protected></Route><Route path="/beheer/deelnemers"><Protected><AdminPage /></Protected></Route><Route path="/beheer/excelbestanden"><Protected><AdminPage /></Protected></Route><Route path="/beheer/financien"><Protected><AdminPage /></Protected></Route><Route path="/beheer"><Protected><AdminPage /></Protected></Route><Route path="/instellingen"><Protected><SettingsPage /></Protected></Route><Route component={NotFoundPage} /></Switch></RoutedErrorBoundary>;
}
function ClerkApp() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={{ theme: experimental__simple, cssLayerName: 'clerk', options: { logoPlacement: 'inside', logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` }, variables: { colorPrimary: '#1d2c45', colorForeground: '#1d2c45', colorMutedForeground: '#6b6a67', colorBackground: '#fcfaf5', colorInput: '#fffdf8', colorInputForeground: '#1d2c45', colorNeutral: '#dcd6ca', fontFamily: 'DM Sans', borderRadius: '0.7rem' } }} signInUrl={`${basePath}/sign-in`} signUpUrl={canonicalSignUpPath} localization={{ signIn: { start: { title: 'Welkom terug', subtitle: signInSubtitle } }, signUp: { start: { title: signUpTitle, subtitle: signUpSubtitle } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><QueryIdentityGuard><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryIdentityGuard></QueryClientProvider></ClerkProvider>;
}
function App() {
  normalizeLegacySignUpPath();
  return <WouterRouter base={basePath}><ClerkApp /></WouterRouter>;
}
export default App;
