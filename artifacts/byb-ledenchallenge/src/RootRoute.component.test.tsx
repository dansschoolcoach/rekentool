import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router as WouterRouter } from 'wouter';
import { ApiError, getGetDashboardQueryKey } from '@workspace/api-client-react';
import App, { appDisplayName, Logo, OnboardingPage, Protected, RootRoute, SettingsPage, signInSubtitle, signUpSubtitle, signUpTitle } from './App';

const clerkState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: false,
  user: null as null | {
    publicMetadata?: { role?: string };
    primaryEmailAddress?: { emailAddress: string };
  },
}));

const clerkRouter = vi.hoisted(() => ({
  replace: null as null | ((to: string) => void),
}));

const dashboardState = vi.hoisted(() => ({
  data: {
    participant: {
      startingMembers: null as number | null,
      targetNewMembers: null as number | null,
      revision: 1,
    },
    challenge: null as null | {
      currentWeek: number;
      totalWeeks: number;
      isActive: boolean;
      startDate?: string;
    },
    totals: {
      signups: 0,
      attendance: 0,
      enrolled: 0,
    },
    scores: {
      growthPercent: 0,
      conversionPercent: 0,
      attendancePercent: 0,
    },
    entries: [] as Array<{
      id: number;
      weekNumber: number;
      signups: number;
      attendance: number;
      enrolled: number;
    }>,
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  profileMutate: vi.fn(),
  toast: vi.fn(),
}));

const weeklyState = vi.hoisted(() => ({
  entries: [] as Array<{
    id: number;
    weekNumber: number;
    signups: number;
    attendance: number;
    enrolled: number;
  }>,
  weeks: [] as Array<{
    weekNumber: number;
    label: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
    isPast: boolean;
  }>,
  upsertMutate: vi.fn(),
}));

const participantProtectedRoutes = [
  '/dashboard',
  '/cijfers',
  '/leaderboard',
  '/financien',
  '/instellingen',
] as const;
const participantOnboardingRoutes = ['/cijfers', '/leaderboard', '/financien', '/instellingen'] as const;

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({
    children,
    routerReplace,
  }: {
    children: ReactNode;
    routerReplace: (to: string) => void;
  }) => {
    clerkRouter.replace = routerReplace;
    return children;
  },
  SignIn: () => null,
  SignUp: ({ path }: { path: string }) => (
    <div data-testid="clerk-sign-up">
      <span data-testid="clerk-sign-up-path">{path}</span>
      <span data-testid="clerk-invitation-parameters">{window.location.search}</span>
      <span data-testid="clerk-invitation-hash">{window.location.hash}</span>
      <button
        type="button"
        onClick={() => {
          clerkState.isSignedIn = true;
          clerkState.user = {
            publicMetadata: { role: 'participant' },
            primaryEmailAddress: { emailAddress: 'deelnemer@example.test' },
          };
          clerkRouter.replace?.('/');
        }}
      >
        Registratie afronden
      </button>
    </div>
  ),
  useAuth: () => ({
    isLoaded: clerkState.isLoaded,
    isSignedIn: clerkState.isSignedIn,
    userId: clerkState.isSignedIn ? 'test-user' : null,
  }),
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ isLoaded: clerkState.isLoaded, user: clerkState.user }),
}));

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useGetDashboard: () => ({
      data: dashboardState.data,
      isLoading: dashboardState.isLoading,
      isError: dashboardState.isError,
      refetch: dashboardState.refetch,
    }),
    useGetMessages: () => ({
      data: [],
      isLoading: false,
      isError: false,
    }),
    useGetWeeklyEntries: () => ({
      data: weeklyState.entries,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useGetWeeks: () => ({
      data: weeklyState.weeks,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useUpsertWeeklyEntry: () => ({
      isPending: false,
      mutate: weeklyState.upsertMutate,
    }),
    useUpdateProfile: () => ({
      isPending: false,
      mutate: dashboardState.profileMutate,
    }),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: dashboardState.toast, toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@clerk/react/internal', () => ({
  publishableKeyFromHost: () => 'pk_test_route',
}));

vi.mock('@clerk/themes', () => ({
  experimental__simple: {},
}));

vi.mock('wouter', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    Redirect: ({ to }: { to: string }) => React.createElement('div', { 'data-testid': 'redirect-target' }, to),
  };
});

afterEach(() => {
  cleanup();
  clerkState.isLoaded = true;
  clerkState.isSignedIn = false;
  clerkState.user = null;
  clerkRouter.replace = null;
  dashboardState.data.participant.startingMembers = null;
  dashboardState.data.participant.targetNewMembers = null;
  dashboardState.data.participant.revision = 1;
  dashboardState.data.challenge = null;
  dashboardState.data.totals = { signups: 0, attendance: 0, enrolled: 0 };
  dashboardState.data.scores = { growthPercent: 0, conversionPercent: 0, attendancePercent: 0 };
  dashboardState.data.entries = [];
  dashboardState.isLoading = false;
  dashboardState.isError = false;
  dashboardState.refetch.mockReset();
  dashboardState.profileMutate.mockReset();
  dashboardState.toast.mockReset();
  weeklyState.entries = [];
  weeklyState.weeks = [];
  weeklyState.upsertMutate.mockReset();
  window.history.replaceState(null, '', '/');
});

describe('hoofdroute', () => {
  it('gebruikt de bredere ledenpaginanaam en inlogtekst', () => {
    render(<Logo />);

    expect(screen.getByTestId('link-logo').textContent).toContain('ByB ledenpagina');
    expect(appDisplayName).toBe('ByB ledenpagina');
    expect(signInSubtitle).toBe('Log in op je Boost your Business pagina');
  });

  it('beschrijft bij registratie de bredere ledenpagina', () => {
    expect(signUpTitle).toBe('Welkom op de Boost your Business ledenpagina');
    expect(signUpSubtitle).toBe('Maak je account af voor toegang tot je persoonlijke ledenpagina');
  });

  it('wacht tot de aanmeldstatus bekend is', () => {
    clerkState.isLoaded = false;

    render(<RootRoute />);

    expect(screen.getByText('Je omgeving wordt voorbereid')).not.toBeNull();
    expect(screen.queryByTestId('redirect-target')).toBeNull();
  });

  it('stuurt uitgelogde bezoekers direct naar inloggen', () => {
    render(<RootRoute />);

    expect(screen.getByTestId('redirect-target').textContent).toBe('/sign-in');
  });

  it('stuurt een ingelogde deelnemer direct naar het dashboard', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'deelnemer@example.test' },
    };

    render(<RootRoute />);

    expect(screen.getByTestId('redirect-target').textContent).toBe('/dashboard');
  });

  it.each(participantProtectedRoutes)(
    'stuurt een ingelogde deelnemer zonder beginaantallen vanaf %s naar onboarding',
    (route) => {
      clerkState.isSignedIn = true;
      clerkState.user = {
        publicMetadata: { role: 'participant' },
        primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
      };
      window.history.replaceState(null, '', route);

      render(
        <WouterRouter>
          <QueryClientProvider client={new QueryClient()}>
            <Protected>
              <div data-testid="protected-content">Beschermde pagina</div>
            </Protected>
          </QueryClientProvider>
        </WouterRouter>,
      );

      expect(screen.getByTestId('redirect-target').textContent).toBe('/onboarding');
    },
  );

  it.each(participantOnboardingRoutes)(
    'stuurt directe navigatie naar %s via de echte routeconfiguratie naar onboarding',
    (route) => {
      clerkState.isSignedIn = true;
      clerkState.user = {
        publicMetadata: { role: 'participant' },
        primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
      };
      window.history.replaceState(null, '', route);

      render(<App />);

      expect(screen.getByTestId('redirect-target').textContent).toBe('/onboarding');
      expect(screen.queryByTestId('app-sidebar')).toBeNull();
    },
  );

  it('toont de onboardingpagina voor een ingelogde deelnemer zonder beginaantallen', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
    };
    window.history.replaceState(null, '', '/onboarding');

    render(
      <WouterRouter>
        <QueryClientProvider client={new QueryClient()}>
          <Protected>
            <OnboardingPage />
          </Protected>
        </QueryClientProvider>
      </WouterRouter>,
    );

    expect(screen.getByTestId('form-onboarding')).not.toBeNull();
    expect(screen.getByText('Zet je vertrekpunt')).not.toBeNull();
    expect(screen.queryByTestId('redirect-target')).toBeNull();
  });

  it('toont een foutmelding en behoudt de invoer wanneer het onboardingprofiel niet kan worden opgeslagen', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
    };
    window.history.replaceState(null, '', '/onboarding');
    dashboardState.profileMutate.mockImplementation((_variables, options) => {
      options?.onError?.(new Error('tijdelijke opslagfout'));
    });

    render(
      <WouterRouter>
        <QueryClientProvider client={new QueryClient()}>
          <Protected>
            <OnboardingPage />
          </Protected>
        </QueryClientProvider>
      </WouterRouter>,
    );

    fireEvent.change(screen.getByTestId('input-onboarding-starting-members'), { target: { value: '42' } });
    fireEvent.change(screen.getByTestId('input-onboarding-target-new-members'), { target: { value: '8' } });
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    const form = screen.getByTestId('form-onboarding');
    expect(within(form).getByRole('alert').textContent).toContain('Je profiel kon niet worden opgeslagen');
    expect((screen.getByTestId('input-onboarding-starting-members') as HTMLInputElement).value).toBe('42');
    expect((screen.getByTestId('input-onboarding-target-new-members') as HTMLInputElement).value).toBe('8');
    expect(screen.getByTestId('button-save-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('redirect-target')).toBeNull();
  });

  it('laadt actuele waarden na een onboardingprofielconflict en laat opnieuw opslaan', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
    };
    window.history.replaceState(null, '', '/onboarding');

    const currentParticipant = {
      startingMembers: 36,
      targetNewMembers: 11,
      revision: 8,
    };
    const profileAttempts: unknown[] = [];
    dashboardState.profileMutate.mockImplementation((variables, options) => {
      profileAttempts.push(variables);
      if (profileAttempts.length === 1) {
        options?.onError?.(new ApiError(
          new Response(JSON.stringify({ currentParticipant }), { status: 409 }),
          { currentParticipant },
          { method: 'PATCH', url: '/profile/preferences' },
        ));
        return;
      }
      options?.onSuccess?.();
    });

    render(
      <WouterRouter>
        <QueryClientProvider client={new QueryClient()}>
          <Protected>
            <OnboardingPage />
          </Protected>
        </QueryClientProvider>
      </WouterRouter>,
    );

    fireEvent.change(screen.getByTestId('input-onboarding-starting-members'), { target: { value: '42' } });
    fireEvent.change(screen.getByTestId('input-onboarding-target-new-members'), { target: { value: '8' } });
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    const form = screen.getByTestId('form-onboarding');
    expect(within(form).getByRole('alert').textContent).toContain(
      'Dit profiel is intussen gewijzigd. De actuele waarden zijn geladen; controleer ze en sla daarna opnieuw op.',
    );
    expect((screen.getByTestId('input-onboarding-starting-members') as HTMLInputElement).value).toBe('36');
    expect((screen.getByTestId('input-onboarding-target-new-members') as HTMLInputElement).value).toBe('11');
    expect(window.location.pathname).toBe('/onboarding');

    fireEvent.submit(form);

    expect(profileAttempts).toEqual([
      { data: { startingMembers: 42, targetNewMembers: 8, revision: 1 } },
      { data: { startingMembers: 36, targetNewMembers: 11, revision: 8 } },
    ]);
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('toont een profielconflict blijvend in Instellingen en gebruikt de actuele revision bij opnieuw opslaan', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'deelnemer@example.test' },
    };
    dashboardState.data.participant.startingMembers = 17;
    dashboardState.data.participant.targetNewMembers = 4;
    dashboardState.data.participant.revision = 1;
    const currentParticipant = {
      startingMembers: 36,
      targetNewMembers: 11,
      revision: 8,
    };
    const profileAttempts: unknown[] = [];
    dashboardState.profileMutate.mockImplementation((variables, options) => {
      profileAttempts.push(variables);
      if (profileAttempts.length === 1) {
        options?.onError?.(new ApiError(
          new Response(JSON.stringify({ currentParticipant }), { status: 409 }),
          { currentParticipant },
          { method: 'PATCH', url: '/profile/preferences' },
        ));
        return;
      }
      options?.onSuccess?.({ ...currentParticipant, revision: 9 });
    });

    render(
      <WouterRouter>
        <QueryClientProvider client={new QueryClient()}>
          <SettingsPage />
        </QueryClientProvider>
      </WouterRouter>,
    );

    fireEvent.click(screen.getByTestId('button-edit-members'));
    fireEvent.change(screen.getByTestId('input-settings-members'), { target: { value: '42' } });
    fireEvent.change(screen.getByTestId('input-settings-target-members'), { target: { value: '8' } });
    fireEvent.submit(screen.getByTestId('form-settings-members'));

    const form = screen.getByTestId('form-settings-members');
    expect(within(form).getByRole('alert').textContent).toContain(
      'Dit profiel is intussen gewijzigd. De actuele waarden zijn geladen; controleer ze en sla daarna opnieuw op.',
    );
    expect((screen.getByTestId('input-settings-members') as HTMLInputElement).value).toBe('36');
    expect((screen.getByTestId('input-settings-target-members') as HTMLInputElement).value).toBe('11');
    expect(dashboardState.toast).toHaveBeenCalledWith({
      title: 'Profiel intussen gewijzigd',
      description: 'Dit profiel is intussen gewijzigd. De actuele waarden zijn geladen; controleer ze en sla daarna opnieuw op.',
      variant: 'destructive',
    });

    fireEvent.submit(form);

    expect(profileAttempts).toEqual([
      { data: { startingMembers: 42, targetNewMembers: 8, revision: 1 } },
      { data: { startingMembers: 36, targetNewMembers: 11, revision: 8 } },
    ]);
    expect(screen.queryByTestId('status-settings-save-error')).toBeNull();
    expect(screen.queryByTestId('form-settings-members')).toBeNull();
  });

  it('stuurt dezelfde onboardinginvoer opnieuw en gaat na een tijdelijke fout naar het dashboard', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
    };
    dashboardState.data.participant.revision = 7;
    window.history.replaceState(null, '', '/onboarding');

    const profileAttempts: unknown[] = [];
    dashboardState.profileMutate.mockImplementation((variables, options) => {
      profileAttempts.push(variables);
      if (profileAttempts.length === 1) {
        options?.onError?.(new Error('tijdelijke opslagfout'));
        return;
      }
      options?.onSuccess?.();
    });

    render(
      <WouterRouter>
        <QueryClientProvider client={new QueryClient()}>
          <Protected>
            <OnboardingPage />
          </Protected>
        </QueryClientProvider>
      </WouterRouter>,
    );

    fireEvent.change(screen.getByTestId('input-onboarding-starting-members'), { target: { value: '42' } });
    fireEvent.change(screen.getByTestId('input-onboarding-target-new-members'), { target: { value: '8' } });
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    const form = screen.getByTestId('form-onboarding');
    expect(within(form).getByRole('alert').textContent).toContain('Je profiel kon niet worden opgeslagen');
    expect((screen.getByTestId('input-onboarding-starting-members') as HTMLInputElement).value).toBe('42');
    expect((screen.getByTestId('input-onboarding-target-new-members') as HTMLInputElement).value).toBe('8');

    fireEvent.submit(form);

    expect(profileAttempts).toEqual([
      { data: { startingMembers: 42, targetNewMembers: 8, revision: 7 } },
      { data: { startingMembers: 42, targetNewMembers: 8, revision: 7 } },
    ]);
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('slaat geldige startaantallen met de actuele revisie op en gaat daarna naar het dashboard', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
    };
    dashboardState.data.participant.revision = 7;
    window.history.replaceState(null, '', '/onboarding');

    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    dashboardState.profileMutate.mockImplementation((variables, options) => {
      expect(variables).toEqual({
        data: {
          startingMembers: 42,
          targetNewMembers: 8,
          revision: 7,
        },
      });
      options?.onSuccess?.();
    });

    render(
      <WouterRouter>
        <QueryClientProvider client={queryClient}>
          <Protected>
            <OnboardingPage />
          </Protected>
        </QueryClientProvider>
      </WouterRouter>,
    );

    fireEvent.change(screen.getByTestId('input-onboarding-starting-members'), { target: { value: '42' } });
    fireEvent.change(screen.getByTestId('input-onboarding-target-new-members'), { target: { value: '8' } });
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: getGetDashboardQueryKey() });
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('toont na onboarding de nieuwe dashboardwaarden en niet het oude startpunt', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'nieuwe-deelnemer@example.test' },
    };
    dashboardState.data.participant.startingMembers = 17;
    dashboardState.data.participant.targetNewMembers = 4;
    window.history.replaceState(null, '', '/onboarding');

    dashboardState.profileMutate.mockImplementation((_variables, options) => {
      dashboardState.data.participant.startingMembers = 42;
      dashboardState.data.participant.targetNewMembers = 8;
      options?.onSuccess?.();
    });

    render(<App />);

    expect((screen.getByTestId('input-onboarding-starting-members') as HTMLInputElement).value).toBe('17');
    expect((screen.getByTestId('input-onboarding-target-new-members') as HTMLInputElement).value).toBe('4');

    fireEvent.change(screen.getByTestId('input-onboarding-starting-members'), { target: { value: '42' } });
    fireEvent.change(screen.getByTestId('input-onboarding-target-new-members'), { target: { value: '8' } });
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    expect(window.location.pathname).toBe('/dashboard');
    expect(screen.getByTestId('text-metric-doel-nieuwe-leden').textContent).toBe('0 van 8');
    expect(screen.getByTestId('card-metric-groei').textContent).toContain('t.o.v. 42 startleden');
    expect(screen.getByTestId('card-metric-groei').textContent).not.toContain('t.o.v. 17 startleden');
  });

  it('werkt doel en groei bij na het opslaan van nieuwe weekcijfers', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'deelnemer@example.test' },
    };
    dashboardState.data.participant.startingMembers = 40;
    dashboardState.data.participant.targetNewMembers = 10;
    dashboardState.data.challenge = {
      currentWeek: 1,
      totalWeeks: 4,
      isActive: true,
      startDate: '2026-09-01',
    };
    window.history.replaceState(null, '', '/cijfers');
    weeklyState.weeks = [{
      weekNumber: 1,
      label: 'Week 1',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
      isCurrent: true,
      isPast: false,
    }];

    const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    weeklyState.upsertMutate.mockImplementation((variables, options) => {
      expect(variables).toEqual({
        data: { weekNumber: 1, signups: 12, attendance: 9, enrolled: 6 },
      });
      dashboardState.data.totals = { signups: 12, attendance: 9, enrolled: 6 };
      dashboardState.data.scores = { growthPercent: 15, conversionPercent: 50, attendancePercent: 75 };
      dashboardState.data.entries = [{
        id: 1,
        weekNumber: 1,
        signups: 12,
        attendance: 9,
        enrolled: 6,
      }];
      options?.onSuccess?.();
    });

    render(<App />);

    fireEvent.change(screen.getByTestId('input-signups-week-1'), { target: { value: '12' } });
    fireEvent.change(screen.getByTestId('input-attendance-week-1'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('input-enrolled-week-1'), { target: { value: '6' } });
    fireEvent.submit(screen.getByTestId('form-week-1'));

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: getGetDashboardQueryKey() });

    fireEvent.click(screen.getByTestId('link-nav-overzicht'));

    expect(screen.getByTestId('text-metric-doel-nieuwe-leden').textContent).toBe('6 van 10');
    expect(screen.getByTestId('text-metric-groei').textContent).toBe('15,0%');
    expect(screen.getByTestId('card-metric-groei').textContent).toContain('t.o.v. 40 startleden');
    expect(screen.getByTestId('card-metric-groei').textContent).not.toContain('t.o.v. 0 startleden');
  });

  it.each(participantProtectedRoutes)(
    'blokkeert een deelnemer wanneer de profielcontrole voor %s mislukt',
    (route) => {
      clerkState.isSignedIn = true;
      clerkState.user = {
        publicMetadata: { role: 'participant' },
        primaryEmailAddress: { emailAddress: 'deelnemer@example.test' },
      };
      dashboardState.isError = true;
      window.history.replaceState(null, '', route);

      render(
        <WouterRouter>
          <QueryClientProvider client={new QueryClient()}>
            <Protected>
              <div data-testid="protected-content">Beschermde pagina</div>
            </Protected>
          </QueryClientProvider>
        </WouterRouter>,
      );

      expect(screen.getByTestId('status-error').textContent).toContain('Je profiel kon niet worden gecontroleerd');
      expect(screen.getByTestId('button-retry')).not.toBeNull();
      expect(screen.queryByTestId('protected-content')).toBeNull();
      expect(screen.queryByTestId('redirect-target')).toBeNull();
    },
  );

  it('geeft na een geslaagde nieuwe profielcontrole weer toegang', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'deelnemer@example.test' },
    };
    dashboardState.isError = true;
    window.history.replaceState(null, '', '/dashboard');

    const renderProtectedView = () => (
      <WouterRouter>
        <QueryClientProvider client={new QueryClient()}>
          <Protected>
            <div data-testid="protected-content">Beschermde pagina</div>
          </Protected>
        </QueryClientProvider>
      </WouterRouter>
    );
    const { rerender } = render(renderProtectedView());

    fireEvent.click(screen.getByTestId('button-retry'));
    expect(dashboardState.refetch).toHaveBeenCalledTimes(1);

    dashboardState.isError = false;
    dashboardState.data.participant.startingMembers = 42;
    dashboardState.data.participant.targetNewMembers = 8;
    rerender(renderProtectedView());

    expect(screen.getByTestId('protected-content').textContent).toBe('Beschermde pagina');
    expect(screen.queryByTestId('status-error')).toBeNull();
  });

  it.each(participantProtectedRoutes)(
    'houdt een ingelogde deelnemer met een compleet profiel op %s',
    (route) => {
      clerkState.isSignedIn = true;
      clerkState.user = {
        publicMetadata: { role: 'participant' },
        primaryEmailAddress: { emailAddress: 'bestaande-deelnemer@example.test' },
      };
      dashboardState.data.participant.startingMembers = 42;
      dashboardState.data.participant.targetNewMembers = 8;
      window.history.replaceState(null, '', route);

      render(
        <WouterRouter>
          <QueryClientProvider client={new QueryClient()}>
            <Protected>
              <div data-testid="protected-content">Beschermde pagina</div>
            </Protected>
          </QueryClientProvider>
        </WouterRouter>,
      );

      expect(screen.getByTestId('protected-content').textContent).toBe('Beschermde pagina');
      expect(screen.queryByTestId('redirect-target')).toBeNull();
    },
  );

  it.each(participantOnboardingRoutes)(
    'maakt directe navigatie naar %s beschikbaar voor een compleet profiel',
    (route) => {
      clerkState.isSignedIn = true;
      clerkState.user = {
        publicMetadata: { role: 'participant' },
        primaryEmailAddress: { emailAddress: 'bestaande-deelnemer@example.test' },
      };
      dashboardState.data.participant.startingMembers = 42;
      dashboardState.data.participant.targetNewMembers = 8;
      window.history.replaceState(null, '', route);

      render(<App />);

      expect(screen.getByTestId('app-sidebar')).not.toBeNull();
      expect(screen.queryByTestId('redirect-target')).toBeNull();
    },
  );

  it('stuurt een ingelogde beheerder direct naar Beheer', () => {
    clerkState.isSignedIn = true;
    clerkState.user = {
      publicMetadata: { role: 'admin' },
      primaryEmailAddress: { emailAddress: 'beheer@example.test' },
    };

    render(<RootRoute />);

    expect(screen.getByTestId('redirect-target').textContent).toBe('/beheer');
  });

  it('rondt registratie vanaf een oude uitnodigingslink af in de ledenstroom', () => {
    window.history.replaceState(
      null,
      '',
      '/byb-ledenchallenge/sign-up?__clerk_ticket=uitnodiging-123&__clerk_status=sign_up#clerk-invitation',
    );

    render(<App />);

    expect(screen.getByTestId('clerk-sign-up')).not.toBeNull();
    expect(screen.getByTestId('clerk-sign-up-path').textContent).toBe('/sign-up');
    expect(window.location.pathname).toBe('/sign-up');
    expect(screen.getByTestId('clerk-invitation-parameters').textContent).toBe(
      '?__clerk_ticket=uitnodiging-123&__clerk_status=sign_up',
    );
    expect(screen.getByTestId('clerk-invitation-hash').textContent).toBe('#clerk-invitation');

    fireEvent.click(screen.getByRole('button', { name: 'Registratie afronden' }));

    expect(screen.getByTestId('redirect-target').textContent).toBe('/dashboard');
  });

  it('behoudt extra Clerk-padsegmenten bij registratie vanaf een oude uitnodigingslink', () => {
    window.history.replaceState(
      null,
      '',
      '/byb-ledenchallenge/sign-up/continue/verify?__clerk_ticket=uitnodiging-456&__clerk_status=sign_up#clerk-invitation',
    );

    render(<App />);

    expect(screen.getByTestId('clerk-sign-up')).not.toBeNull();
    expect(screen.getByTestId('clerk-sign-up-path').textContent).toBe('/sign-up');
    expect(window.location.pathname).toBe('/sign-up/continue/verify');
    expect(screen.getByTestId('clerk-invitation-parameters').textContent).toBe(
      '?__clerk_ticket=uitnodiging-456&__clerk_status=sign_up',
    );
    expect(screen.getByTestId('clerk-invitation-hash').textContent).toBe('#clerk-invitation');

    fireEvent.click(screen.getByRole('button', { name: 'Registratie afronden' }));

    expect(screen.getByTestId('redirect-target').textContent).toBe('/dashboard');
  });
});
