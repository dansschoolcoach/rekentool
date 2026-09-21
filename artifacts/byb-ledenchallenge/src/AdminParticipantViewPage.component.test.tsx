import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, type AdminParticipantView } from '@workspace/api-client-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminParticipantViewPage } from './App';

const participantView: AdminParticipantView = {
  participant: {
    id: 17,
    schoolName: 'Dansschool De Horizon',
    contactName: 'Sanne Jansen',
    email: 'sanne@horizon.example',
    startingMembers: 80,
    targetNewMembers: 12,
    country: 'Nederland',
    revision: 1,
    updatedAt: '2026-09-12T10:00:00.000Z',
    totals: { signups: 14, attendance: 11, enrolled: 5 },
    scores: { growthPercent: 6.25, conversionPercent: 35.7, attendancePercent: 78.6 },
  },
  challenge: {
    id: 1,
    name: 'ByB Ledenchallenge',
    startDate: '2026-09-14',
    endDate: '2026-10-11',
    totalWeeks: 4,
    totalDays: 28,
    currentWeek: 2,
    daysRemaining: 21,
    isActive: true,
  },
  totals: { signups: 14, attendance: 11, enrolled: 5 },
  scores: { growthPercent: 6.25, conversionPercent: 35.7, attendancePercent: 78.6 },
  entries: [{
    id: 41,
    weekNumber: 1,
    signups: 14,
    attendance: 11,
    enrolled: 5,
    updatedAt: '2026-09-20T10:00:00.000Z',
  }],
  weeks: [{
    weekNumber: 1,
    label: 'Week 1',
    startDate: '2026-09-14',
    endDate: '2026-09-20',
    isCurrent: false,
    isPast: true,
  }],
  messages: [],
};

const mocks = vi.hoisted(() => ({
  view: null as AdminParticipantView | null,
  viewError: null as Error | null,
  refetchView: vi.fn(),
  profileVariables: null as unknown,
  profileError: null as Error | null,
  profileResults: [] as AdminParticipantView['participant'][],
  toast: vi.fn(),
}));

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return { ...actual, useParams: () => ({ id: '17' }) };
});

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useGetAdminParticipantView: () => ({
      isLoading: false,
      isError: mocks.viewError !== null,
      error: mocks.viewError,
      data: mocks.view,
      refetch: mocks.refetchView,
    }),
    useUpdateAdminParticipantProfile: () => ({
      isPending: false,
      mutate: vi.fn((variables, options) => {
        mocks.profileVariables = variables;
        if (mocks.profileError) options?.onError?.(mocks.profileError);
        else {
          const result = mocks.profileResults.shift();
          if (result) options?.onSuccess?.(result);
        }
      }),
    }),
    useUpsertAdminParticipantWeeklyEntry: () => ({ isPending: false, mutate: vi.fn() }),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.view = participantView;
  mocks.viewError = null;
  mocks.refetchView.mockReset();
  mocks.profileVariables = null;
  mocks.profileError = null;
  mocks.profileResults = [];
  mocks.toast.mockReset();
});

describe('deelnemerweergave voor beheerders', () => {
  it('legt bij een verwijderde deelnemer uit dat die niet meer beschikbaar is en linkt terug', () => {
    mocks.view = null;
    mocks.viewError = new ApiError(
      new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }),
      { message: 'Not found' },
      { method: 'GET', url: '/admin/participants/17/view' },
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminParticipantViewPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Deelnemer niet meer beschikbaar')).toBeTruthy();
    expect(screen.getByText('Deze deelnemer bestaat niet meer of is intussen verwijderd.')).toBeTruthy();
    expect(screen.queryByTestId('button-retry')).toBeNull();
    expect(screen.getByTestId('link-back-to-participants').getAttribute('href')).toBe('/beheer');
  });

  it('behoudt bij andere laadfouten de algemene herstelactie', async () => {
    const user = userEvent.setup();
    mocks.view = null;
    mocks.viewError = new ApiError(
      new Response(JSON.stringify({ message: 'Server error' }), { status: 500 }),
      { message: 'Server error' },
      { method: 'GET', url: '/admin/participants/17/view' },
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminParticipantViewPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText('De gegevens konden niet worden opgehaald.')).toBeTruthy();
    expect(screen.queryByText('Deelnemer niet meer beschikbaar')).toBeNull();
    await user.click(screen.getByTestId('button-retry'));
    expect(mocks.refetchView).toHaveBeenCalledTimes(1);
  });

  it('waarschuwt over de beheerderssessie en laat profiel en weekcijfers bijwerken', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminParticipantViewPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Dansschool De Horizon')).toBeTruthy();
    expect(screen.getByText('Sanne Jansen · sanne@horizon.example')).toBeTruthy();

    const warningBanner = screen.getByTestId('banner-admin-participant-warning');
    expect(within(warningBanner).getByText('Je blijft ingelogd als beheerder')).toBeTruthy();
    expect(within(warningBanner).getByText(/Wijzigingen op deze pagina worden toegepast op deelnemer/)).toBeTruthy();

    const savedWeek = screen.getByTestId('card-admin-week-1');
    expect(within(savedWeek).getByDisplayValue('14')).toBeTruthy();
    expect(within(savedWeek).getByDisplayValue('11')).toBeTruthy();
    expect(within(savedWeek).getByDisplayValue('5')).toBeTruthy();
    expect((screen.getByTestId('input-admin-starting-members') as HTMLInputElement).value).toBe('80');
    expect((screen.getByTestId('input-admin-target-new-members') as HTMLInputElement).value).toBe('12');
    expect(screen.getByTestId('button-save-admin-participant-profile')).toBeTruthy();
    expect(screen.getByTestId('button-admin-save-week-1')).toBeTruthy();
    expect(screen.getByTestId('link-view-participant-finances')).toBeTruthy();
  });

  it('behoudt de openingsrevisie tijdens refetch en laadt actuele waarden na een conflict', async () => {
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminParticipantViewPage />
      </QueryClientProvider>,
    );
    const startingMembers = screen.getByTestId('input-admin-starting-members') as HTMLInputElement;
    await user.clear(startingMembers);
    await user.type(startingMembers, '85');

    const currentParticipant = {
      ...participantView.participant,
      startingMembers: 90,
      targetNewMembers: 15,
      revision: 2,
      updatedAt: '2026-09-12T10:05:00.000Z',
    };
    mocks.view = { ...participantView, participant: currentParticipant };
    mocks.profileError = new ApiError(
      new Response(JSON.stringify({ currentParticipant }), { status: 409 }),
      { currentParticipant },
      { method: 'PATCH', url: '/admin/participants/17/profile' },
    );
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AdminParticipantViewPage />
      </QueryClientProvider>,
    );

    expect(startingMembers.value).toBe('85');
    await user.click(screen.getByTestId('button-save-admin-participant-profile'));

    expect(mocks.profileVariables).toEqual(expect.objectContaining({
      data: expect.objectContaining({ startingMembers: 85, revision: 1 }),
    }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Profiel intussen gewijzigd',
    })));
    expect((screen.getByTestId('input-admin-starting-members') as HTMLInputElement).value).toBe('90');
    expect((screen.getByTestId('input-admin-target-new-members') as HTMLInputElement).value).toBe('15');
  });

  it('gebruikt na een geslaagde opslag meteen de teruggegeven revisie voor de volgende opslag', async () => {
    const user = userEvent.setup();
    const revisionTwo = {
      ...participantView.participant,
      startingMembers: 85,
      revision: 2,
      updatedAt: '2026-09-12T10:05:00.000Z',
    };
    const revisionThree = {
      ...revisionTwo,
      startingMembers: 86,
      revision: 3,
      updatedAt: '2026-09-12T10:06:00.000Z',
    };
    mocks.profileResults = [revisionTwo, revisionThree];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminParticipantViewPage />
      </QueryClientProvider>,
    );

    const startingMembers = screen.getByTestId('input-admin-starting-members') as HTMLInputElement;
    await user.clear(startingMembers);
    await user.type(startingMembers, '85');
    await user.click(screen.getByTestId('button-save-admin-participant-profile'));
    expect(mocks.profileVariables).toEqual(expect.objectContaining({
      data: expect.objectContaining({ startingMembers: 85, revision: 1 }),
    }));

    await user.clear(startingMembers);
    await user.type(startingMembers, '86');
    await user.click(screen.getByTestId('button-save-admin-participant-profile'));
    expect(mocks.profileVariables).toEqual(expect.objectContaining({
      data: expect.objectContaining({ startingMembers: 86, revision: 2 }),
    }));
  });
});