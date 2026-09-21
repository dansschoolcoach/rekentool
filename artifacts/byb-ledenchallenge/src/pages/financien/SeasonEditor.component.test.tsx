import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type FinancialSeasonDetail } from '@workspace/api-client-react';
import { createSeasonTemplate, SeasonEditor } from './SeasonEditor';

const { createMutate, adminCreateMutate, updateMutate, adminUpdateMutate, getFinancialSeason, refetchFinancialSeason, toast } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  adminCreateMutate: vi.fn(),
  updateMutate: vi.fn(),
  adminUpdateMutate: vi.fn(),
  getFinancialSeason: vi.fn(),
  refetchFinancialSeason: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ userId: 'clerk-user-1' }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('@workspace/api-client-react', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(response: Response) {
      super(`API error ${response.status}`);
      this.status = response.status;
    }
  },
  getGetFinancialSeasonQueryKey: (seasonId: number) => ['financial-season', seasonId],
  getGetFinancialSeasonsQueryKey: () => ['financial-seasons'],
  getGetAdminFinancialSeasonQueryKey: (participantId: number, seasonId: number) => ['admin-financial-season', participantId, seasonId],
  getGetAdminFinancialSeasonsQueryKey: (participantId: number) => ['admin-financial-seasons', participantId],
  useCreateFinancialSeason: () => ({ isPending: false, mutate: createMutate }),
  useUpdateFinancialSeason: () => ({ isPending: false, mutate: updateMutate }),
  useGetFinancialSeason: getFinancialSeason,
  useCreateAdminFinancialSeason: () => ({ isPending: false, mutate: adminCreateMutate }),
  useUpdateAdminFinancialSeason: () => ({ isPending: false, mutate: adminUpdateMutate }),
  useGetAdminFinancialSeason: getFinancialSeason,
}));

const defaultSeasonResponse = {
    isLoading: false,
    data: {
      id: 42,
      name: '2026/2027',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2027-07-01T00:00:00.000Z',
      country: 'Nederland',
      hasStarterDeduction: false,
      defaultSalary: 0,
      teachers: [],
      locations: [{
        id: 8,
        name: 'Studio',
        rentFrequency: 'session',
        rent: 20,
        rentTermCount: null,
        sessionMinutes: 60,
      }],
      subscriptions: [{
        id: 7,
        name: 'Jeugdabonnement',
        audience: 'youth',
        productType: 'subscription',
        paymentFrequency: 'installments',
        price: 120,
        installmentCount: 4,
        durationMonths: 10,
        rideCount: null,
        validityMonths: null,
        vatRate: 9,
      }],
      lessons: [],
      closures: [],
      lessonSeasonForecast: {
        locationRentBreakdowns: [],
      },
      updatedAt: '2026-09-12T10:00:00.000Z',
    },
    refetch: refetchFinancialSeason,
  };

beforeEach(() => {
  localStorage.clear();
  createMutate.mockReset();
  adminCreateMutate.mockReset();
  updateMutate.mockReset();
  adminUpdateMutate.mockReset();
  getFinancialSeason.mockReset();
  refetchFinancialSeason.mockReset();
  toast.mockReset();
  refetchFinancialSeason.mockResolvedValue({ data: defaultSeasonResponse.data });
  getFinancialSeason.mockReturnValue(defaultSeasonResponse);
});

describe('SeasonEditor local drafts', () => {
  it('bundles rapid edits and shows waiting before the final saved status', async () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('season-draft-save-status')).toBeNull();
    const name = screen.getByLabelText('Naam seizoen');
    fireEvent.change(name, { target: { value: 'Eerste wijziging' } });
    fireEvent.change(name, { target: { value: 'Tweede wijziging' } });
    fireEvent.change(name, { target: { value: 'Definitieve wijziging' } });

    expect(screen.getByRole('status').textContent).toBe('Wijzigingen wachten om automatisch te worden bewaard.');
    expect(setItem).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(setItem.mock.calls[0]?.[1] ?? 'null')).toMatchObject({
      form: { name: 'Definitieve wijziging' },
      savedAt: expect.any(String),
    });
    expect(screen.getByRole('status').textContent).toBe('Concept automatisch bewaard in deze browser.');
    setItem.mockRestore();
    vi.useRealTimers();
  });

  it('flushes the latest waiting edit when the editor closes', async () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Naam seizoen'), { target: { value: 'Laatste wijziging' } });
    expect(setItem).not.toHaveBeenCalled();

    view.unmount();

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(setItem.mock.calls[0]?.[1] ?? 'null')).toMatchObject({
      form: { name: 'Laatste wijziging' },
    });
    setItem.mockRestore();
    vi.useRealTimers();
  });

  it('warns without blocking the editor when browser storage rejects a draft', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.type(await screen.findByLabelText('Naam seizoen'), ' aangepast');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      'Concept kon niet in deze browser worden bewaard. Je kunt de stamgegevens wel handmatig opslaan.',
    ));
    expect((screen.getByRole('button', { name: 'Algemeen opslaan' }) as HTMLButtonElement).disabled).toBe(false);
    setItem.mockRestore();
  });

  it('stores edits and offers the matching participant and season draft on return', async () => {
    const user = userEvent.setup();
    const firstRender = render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const name = await screen.findByLabelText('Naam seizoen');
    await user.clear(name);
    await user.type(name, 'Conceptseizoen');

    await waitFor(() => expect(JSON.parse(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42') ?? 'null')).toMatchObject({
      form: { name: 'Conceptseizoen' },
      expectedUpdatedAt: '2026-09-12T10:00:00.000Z',
      savedAt: expect.any(String),
    }));

    firstRender.unmount();
    const secondRender = render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    expect((await screen.findByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('2026/2027');
    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42')).not.toBeNull();

    secondRender.unmount();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Concept herstellen' })).toBeTruthy();
    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Concept herstellen' }));
    expect((screen.getByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('Conceptseizoen');
  });

  it('can delete a draft without restoring it', async () => {
    localStorage.setItem(
      'byb:financial-season-draft:v2:participant:clerk-user-1:season:42',
      JSON.stringify({ form: { ...defaultSeasonResponse.data, name: 'Niet herstellen' } }),
    );
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Concept verwijderen' }));
    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42')).toBeNull();
    expect((screen.getByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('2026/2027');
  });

  it('warns when the saved season changed after the local draft was created', async () => {
    const draftSavedAt = '2026-09-12T09:30:00.000Z';
    localStorage.setItem(
      'byb:financial-season-draft:v2:participant:clerk-user-1:season:42',
      JSON.stringify({
        form: {
          ...defaultSeasonResponse.data,
          name: 'Ouder concept',
          startDate: '2026-09-01',
          endDate: '2027-07-01',
        },
        expectedUpdatedAt: '2026-09-12T09:00:00.000Z',
        savedAt: draftSavedAt,
      }),
    );
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const notice = await screen.findByTestId('season-draft-notice');
    expect(notice.textContent).toContain('Dit lokale concept is mogelijk verouderd');
    expect(notice.textContent).toContain('De opgeslagen stamgegevens zijn gewijzigd sinds dit concept is gemaakt.');
    expect(notice.textContent).toContain(`Lokaal concept: bewaard op ${new Intl.DateTimeFormat('nl-NL', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(draftSavedAt))}`);
    expect(notice.textContent).toContain(`Opgeslagen gegevens: gewijzigd op ${new Intl.DateTimeFormat('nl-NL', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(defaultSeasonResponse.data.updatedAt))}`);

    await user.click(screen.getByRole('button', { name: 'Concept herstellen' }));
    expect((screen.getByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('Ouder concept');
  });

  it('keeps an older stale draft without a local save time recoverable', async () => {
    localStorage.setItem(
      'byb:financial-season-draft:v2:participant:clerk-user-1:season:42',
      JSON.stringify({
        form: {
          ...defaultSeasonResponse.data,
          name: 'Oud herstelbaar concept',
          startDate: '2026-09-01',
          endDate: '2027-07-01',
        },
        expectedUpdatedAt: '2026-09-12T09:00:00.000Z',
      }),
    );
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const notice = await screen.findByTestId('season-draft-notice');
    expect(notice.textContent).toContain('Lokaal concept: opslagtijd niet beschikbaar (ouder concept)');
    expect(notice.textContent).toContain('Opgeslagen gegevens: gewijzigd op');

    await user.click(screen.getByRole('button', { name: 'Concept herstellen' }));
    expect((screen.getByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('Oud herstelbaar concept');
  });

  it('warns on window focus when the open season changed without overwriting local input', async () => {
    const user = userEvent.setup();
    refetchFinancialSeason.mockResolvedValue({
      data: {
        ...defaultSeasonResponse.data,
        name: 'Gewijzigd in andere sessie',
        updatedAt: '2026-09-12T11:00:00.000Z',
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const name = await screen.findByLabelText('Naam seizoen');
    await user.clear(name);
    await user.type(name, 'Mijn lokale invoer');
    fireEvent.focus(window);

    const notice = await screen.findByTestId('season-draft-notice');
    expect(notice.textContent).toContain('Dit lokale concept is mogelijk verouderd');
    expect((name as HTMLInputElement).value).toBe('Mijn lokale invoer');

    await user.click(screen.getByRole('button', { name: 'Concept verwijderen' }));
    expect((name as HTMLInputElement).value).toBe('Gewijzigd in andere sessie');
  });

  it('lets the user delete a stale draft and continue with the latest saved season', async () => {
    const storageKey = 'byb:financial-season-draft:v2:participant:clerk-user-1:season:42';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        form: {
          ...defaultSeasonResponse.data,
          name: 'Ouder concept',
          startDate: '2026-09-01',
          endDate: '2027-07-01',
        },
        expectedUpdatedAt: '2026-09-12T09:00:00.000Z',
      }),
    );
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Concept verwijderen' }));
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect((screen.getByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('2026/2027');
  });

  it('clears only the saved season draft after a successful server save', async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_variables, options) => options.onSuccess({ id: 99 }));
    localStorage.setItem('byb:financial-season-draft:v2:participant:clerk-user-1:new', JSON.stringify({ form: { name: 'Concept' } }));
    localStorage.setItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42', JSON.stringify({ form: { name: 'Ander seizoen' } }));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Naam seizoen'), '2027/2028');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:new')).toBeNull();
    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42')).not.toBeNull();
  });

  it('keeps admin participant and season drafts separate', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} adminParticipantId={7} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const name = await screen.findByLabelText('Naam seizoen');
    await user.clear(name);
    await user.type(name, 'Beheerconcept');

    await waitFor(() => expect(localStorage.getItem('byb:financial-season-draft:v2:admin-participant:7:season:42')).not.toBeNull());
    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42')).toBeNull();
  });

  it('uses the draft origin revision when a restored draft is saved', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: { ...defaultSeasonResponse.data, updatedAt: '2026-09-12T12:00:00.000Z' },
    });
    localStorage.setItem(
      'byb:financial-season-draft:v2:participant:clerk-user-1:season:42',
      JSON.stringify({
        form: {
          ...defaultSeasonResponse.data,
          name: 'Ouder concept',
          startDate: '2026-09-01',
          endDate: '2027-07-01',
        },
        expectedUpdatedAt: '2026-09-12T10:00:00.000Z',
      }),
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Concept herstellen' }));
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(updateMutate.mock.calls[0]?.[0].data.expectedUpdatedAt).toBe('2026-09-12T10:00:00.000Z');
  });

  it('keeps a new draft when the user edits back to the old value after saving', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: { ...defaultSeasonResponse.data, updatedAt: '2026-09-12T10:00:00.000Z' },
    });
    updateMutate.mockImplementation((_variables, options) => options.onSuccess({
      updatedAt: '2026-09-12T11:00:00.000Z',
    }));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const name = await screen.findByLabelText('Naam seizoen');
    await user.clear(name);
    await user.type(name, 'Eerst opgeslagen');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));
    await user.clear(name);
    await user.type(name, '2026/2027');

    await waitFor(() => expect(JSON.parse(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42') ?? 'null')).toMatchObject({
      form: { name: '2026/2027' },
      expectedUpdatedAt: '2026-09-12T11:00:00.000Z',
    }));
  });

  it('uses the refreshed server revision when retrying after a stale draft conflict', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn().mockResolvedValue({
      data: { ...defaultSeasonResponse.data, updatedAt: '2026-09-12T13:00:00.000Z' },
    });
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: { ...defaultSeasonResponse.data, updatedAt: '2026-09-12T12:00:00.000Z' },
      refetch,
    });
    localStorage.setItem(
      'byb:financial-season-draft:v2:participant:clerk-user-1:season:42',
      JSON.stringify({
        form: {
          ...defaultSeasonResponse.data,
          name: 'Ouder concept',
          startDate: '2026-09-01',
          endDate: '2027-07-01',
        },
        expectedUpdatedAt: '2026-09-12T10:00:00.000Z',
      }),
    );
    updateMutate
      .mockImplementationOnce((_variables, options) => options.onError(new ApiError(
        new Response(null, { status: 409 }),
        null,
        { method: 'PUT', url: '/financial-seasons/42' },
      )))
      .mockImplementationOnce(() => undefined);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Concept herstellen' }));
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42') ?? 'null')).toMatchObject({
      form: { name: 'Ouder concept' },
      expectedUpdatedAt: '2026-09-12T13:00:00.000Z',
    });

    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));
    expect(updateMutate.mock.calls[1]?.[0].data.expectedUpdatedAt).toBe('2026-09-12T13:00:00.000Z');
  });

  it('keeps rejected admin additions and removals while loading the latest season for retry', async () => {
    const user = userEvent.setup();
    const latestSeason = {
      ...defaultSeasonResponse.data,
      name: 'Nieuwste beheerderversie',
      teachers: [{ id: 12, name: 'Andere beheerder', hourlyRate: 45, weeklyTravel: 12 }],
      updatedAt: '2026-09-12T13:00:00.000Z',
    };
    const refetch = vi.fn().mockResolvedValue({ data: latestSeason });
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      refetch,
    });
    adminUpdateMutate
      .mockImplementationOnce((_variables, options) => options.onError(new ApiError(
        new Response(null, { status: 409 }),
        null,
        { method: 'PUT', url: '/admin/financial/participants/7/seasons/42' },
      )))
      .mockImplementationOnce((_variables, options) => options.onSuccess({
        updatedAt: '2026-09-12T14:00:00.000Z',
      }));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} adminParticipantId={7} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByTestId('button-add-teacher-bottom'));
    const addedTeacher = screen.getAllByLabelText('Naam docent').at(-1)!;
    await user.type(addedTeacher, 'Mijn afgewezen docent');
    await user.click(screen.getByRole('button', { name: 'Verwijder locatie Studio' }));
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('season-draft-notice').textContent).toContain('Je afgewezen seizoenbewerking is bewaard');
    expect((screen.getByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('Nieuwste beheerderversie');
    expect((screen.getByLabelText('Naam docent') as HTMLInputElement).value).toBe('Andere beheerder');
    expect(JSON.parse(localStorage.getItem('byb:financial-season-draft:v2:admin-participant:7:season:42') ?? 'null')).toMatchObject({
      form: {
        teachers: [{ name: 'Mijn afgewezen docent' }],
        locations: [],
      },
      expectedUpdatedAt: '2026-09-12T13:00:00.000Z',
      reason: 'conflict',
    });

    await user.click(screen.getByRole('button', { name: 'Afgewezen invoer herstellen' }));
    expect((screen.getByLabelText('Naam docent') as HTMLInputElement).value).toBe('Mijn afgewezen docent');
    expect(screen.queryByLabelText('Naam locatie')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(adminUpdateMutate.mock.calls[1]?.[0]).toMatchObject({
      participantId: 7,
      seasonId: 42,
      data: {
        expectedUpdatedAt: '2026-09-12T13:00:00.000Z',
        teachers: [{ name: 'Mijn afgewezen docent' }],
        locations: [],
      },
    });
  });

  it('keeps a nested edit made while the preceding save is still pending', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: {
        ...defaultSeasonResponse.data,
        updatedAt: '2026-09-12T10:00:00.000Z',
        teachers: [{ id: 3, name: 'Nina', hourlyRate: 40, weeklyTravel: 10 }],
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const teacherName = await screen.findByLabelText('Naam docent');
    await user.clear(teacherName);
    await user.type(teacherName, 'Eerst opgeslagen');
    await user.click(screen.getByRole('button', { name: 'Docenten opslaan' }));

    expect(updateMutate.mock.calls[0]?.[0].data.teachers[0].name).toBe('Eerst opgeslagen');
    await user.clear(teacherName);
    await user.type(teacherName, 'Nog niet opgeslagen');
    expect(updateMutate.mock.calls[0]?.[0].data.teachers[0].name).toBe('Eerst opgeslagen');

    await act(async () => {
      updateMutate.mock.calls[0]?.[1].onSuccess({
        updatedAt: '2026-09-12T11:00:00.000Z',
      });
    });

    expect(JSON.parse(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:42') ?? 'null')).toMatchObject({
      form: { teachers: [{ name: 'Nog niet opgeslagen' }] },
      expectedUpdatedAt: '2026-09-12T11:00:00.000Z',
    });
  });

  it('moves edits made during creation to the newly created season draft', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const firstRender = render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor onSaved={onSaved} />
      </QueryClientProvider>,
    );

    const name = screen.getByLabelText('Naam seizoen');
    await user.type(name, 'Ingediend seizoen');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));
    await user.clear(name);
    await user.type(name, 'Nog niet opgeslagen');

    await act(async () => {
      createMutate.mock.calls[0]?.[1].onSuccess({
        id: 99,
        updatedAt: '2026-09-12T11:00:00.000Z',
      });
    });

    expect(onSaved).toHaveBeenCalledWith(99);
    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:new')).toBeNull();
    expect(JSON.parse(localStorage.getItem('byb:financial-season-draft:v2:participant:clerk-user-1:season:99') ?? 'null')).toMatchObject({
      form: { name: 'Nog niet opgeslagen' },
      expectedUpdatedAt: '2026-09-12T11:00:00.000Z',
    });

    firstRender.unmount();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: {
        ...defaultSeasonResponse.data,
        id: 99,
        name: 'Ingediend seizoen',
        updatedAt: '2026-09-12T11:00:00.000Z',
      },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={99} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Concept herstellen' }));
    expect((screen.getByLabelText('Naam seizoen') as HTMLInputElement).value).toBe('Nog niet opgeslagen');
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('SeasonEditor revision contract', () => {
  it('sends the loaded season revision when updating an existing season', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: {
        ...defaultSeasonResponse.data,
        updatedAt: '2026-09-12T10:15:30.000Z',
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Algemeen opslaan' }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      seasonId: 42,
      data: {
        expectedUpdatedAt: '2026-09-12T10:15:30.000Z',
      },
    });
  });

  it('keeps the participant, season, and loaded revision in an admin update', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: {
        ...defaultSeasonResponse.data,
        updatedAt: '2026-09-12T10:15:30.000Z',
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} adminParticipantId={7} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Algemeen opslaan' }));

    expect(adminUpdateMutate).toHaveBeenCalledTimes(1);
    expect(adminUpdateMutate.mock.calls[0]?.[0]).toMatchObject({
      participantId: 7,
      seasonId: 42,
      data: {
        expectedUpdatedAt: '2026-09-12T10:15:30.000Z',
      },
    });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('creates a new season without an update revision', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Naam seizoen'), '2027/2028');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]?.[0].data).not.toHaveProperty('expectedUpdatedAt');
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('keeps the participant season list and navigation unchanged when creation fails', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onSaved = vi.fn();
    createMutate.mockImplementation((_variables, options) => options.onError(new Error('Creation rejected')));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor onSaved={onSaved} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Naam seizoen'), '2027/2028');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Opslaan tijdelijk niet gelukt',
      description: 'De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.',
      variant: 'destructive',
    });
  });

  it('invalidates only the participant season list and returns the created season id', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onSaved = vi.fn();
    createMutate.mockImplementation((_variables, options) => options.onSuccess({ id: 99 }));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor onSaved={onSaved} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Naam seizoen'), '2027/2028');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['financial-seasons'],
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['admin-financial-seasons', 7],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['admin-financial-season', 7, 99],
    });
    expect(onSaved).toHaveBeenCalledWith(99);
  });

  it('invalidates only the participant season list and updated season detail after a successful update', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onSaved = vi.fn();
    updateMutate.mockImplementation((_variables, options) => options.onSuccess({
      updatedAt: '2026-09-12T11:00:00.000Z',
    }));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor seasonId={42} onSaved={onSaved} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['financial-seasons'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['financial-season', 42],
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['admin-financial-seasons', 7],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['admin-financial-season', 7, 42],
    });
    expect(onSaved).toHaveBeenCalledWith(42);
  });

  it('keeps participant season caches and navigation unchanged when an update fails', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onSaved = vi.fn();
    updateMutate.mockImplementation((_variables, options) => options.onError(new Error('Update rejected')));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor seasonId={42} onSaved={onSaved} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Opslaan tijdelijk niet gelukt',
      description: 'De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.',
      variant: 'destructive',
    });
  });

  it('creates a new admin season for the selected participant through the admin hook', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor adminParticipantId={7} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Naam seizoen'), '2027/2028');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(adminCreateMutate).toHaveBeenCalledTimes(1);
    expect(adminCreateMutate.mock.calls[0]?.[0]).toMatchObject({
      participantId: 7,
      data: {
        name: '2027/2028',
        startDate: '2027-09-01',
        endDate: '2028-07-01',
      },
    });
    expect(adminCreateMutate.mock.calls[0]?.[0].data).not.toHaveProperty('expectedUpdatedAt');
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('invalidates only the selected admin participant season list and returns the created season id', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onSaved = vi.fn();
    adminCreateMutate.mockImplementation((_variables, options) => options.onSuccess({ id: 99 }));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor adminParticipantId={7} onSaved={onSaved} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Naam seizoen'), '2027/2028');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin-financial-seasons', 7],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['financial-seasons'],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['admin-financial-seasons', 8],
    });
    expect(onSaved).toHaveBeenCalledWith(99);
  });

  it('keeps admin season caches and navigation unchanged when creation fails', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onSaved = vi.fn();
    adminCreateMutate.mockImplementation((_variables, options) => options.onError(new Error('Creation rejected')));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor adminParticipantId={7} onSaved={onSaved} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Naam seizoen'), '2027/2028');
    await user.type(screen.getByLabelText('Startdatum'), '2027-09-01');
    await user.type(screen.getByLabelText('Einddatum'), '2028-07-01');
    await user.click(screen.getByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Opslaan tijdelijk niet gelukt',
      description: 'De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.',
      variant: 'destructive',
    });
  });

  it('invalidates only the selected admin participant season list and updated season detail', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    adminUpdateMutate.mockImplementation((_variables, options) => options.onSuccess({
      updatedAt: '2026-09-12T11:00:00.000Z',
    }));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor seasonId={42} adminParticipantId={7} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin-financial-seasons', 7],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin-financial-season', 7, 42],
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['financial-seasons'],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['financial-season', 42],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['admin-financial-seasons', 8],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['admin-financial-season', 8, 42],
    });
  });

  it('keeps admin season caches and navigation unchanged when an update fails', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onSaved = vi.fn();
    adminUpdateMutate.mockImplementation((_variables, options) => options.onError(new Error('Update rejected')));

    render(
      <QueryClientProvider client={queryClient}>
        <SeasonEditor seasonId={42} adminParticipantId={7} onSaved={onSaved} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Algemeen opslaan' }));

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Opslaan tijdelijk niet gelukt',
      description: 'De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.',
      variant: 'destructive',
    });
  });
});

describe('SeasonEditor adaptive subscription fields', () => {
  it('adds the next teacher, subscription, or lesson from the bottom of each long list', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await screen.findByTestId('button-add-teacher-bottom');
    const teacherCount = screen.queryAllByLabelText('Naam docent').length;
    const subscriptionCount = screen.queryAllByLabelText('Soort').length;
    const lessonCount = screen.queryAllByPlaceholderText('Naam les (bijv. Hiphop 12+)').length;

    await user.click(screen.getByTestId('button-add-teacher-bottom'));
    await user.click(screen.getByTestId('button-add-subscription-bottom'));
    await user.click(screen.getByTestId('button-add-lesson-bottom'));

    expect(screen.getAllByLabelText('Naam docent')).toHaveLength(teacherCount + 1);
    expect(screen.getAllByLabelText('Soort')).toHaveLength(subscriptionCount + 1);
    expect(screen.getAllByPlaceholderText('Naam les (bijv. Hiphop 12+)')).toHaveLength(lessonCount + 1);
  });

  it('clears hidden punch-card and installment values before saving', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const productType = await screen.findByLabelText('Soort');
    expect(screen.getByRole('button', { name: 'Algemeen opslaan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Docenten opslaan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Locaties opslaan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aanbod opslaan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sluitingsweken opslaan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lessen opslaan' })).toBeTruthy();
    expect((screen.getByLabelText('Aantal termijnen') as HTMLInputElement).value).toBe('4');
    expect(screen.queryByLabelText('Aantal ritten')).toBeNull();

    await user.selectOptions(productType, 'punch_card');

    expect(screen.queryByLabelText('Aantal termijnen')).toBeNull();
    expect(screen.queryByLabelText('Betaalwijze')).toBeNull();
    expect((screen.getByLabelText('Aantal ritten') as HTMLInputElement).value).toBe('10');
    await user.clear(screen.getByLabelText('Aantal ritten'));
    await user.type(screen.getByLabelText('Aantal ritten'), '12');

    await user.selectOptions(productType, 'subscription');

    expect(screen.queryByLabelText('Aantal ritten')).toBeNull();
    expect((screen.getByLabelText('Betaalwijze') as HTMLSelectElement).value).toBe('monthly');
    expect(screen.queryByLabelText('Aantal termijnen')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Betaalwijze'), 'installments');
    expect((screen.getByLabelText('Aantal termijnen') as HTMLInputElement).value).toBe('3');
    await user.clear(screen.getByLabelText('Aantal termijnen'));
    await user.type(screen.getByLabelText('Aantal termijnen'), '6');

    await user.selectOptions(screen.getByLabelText('Betaalwijze'), 'yearly');
    expect(screen.queryByLabelText('Aantal termijnen')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Aanbod opslaan' }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      seasonId: 42,
      data: {
        subscriptions: [{
          id: 7,
          productType: 'subscription',
          paymentFrequency: 'yearly',
          installmentCount: null,
          rideCount: null,
          validityMonths: null,
        }],
      },
    });
  });

  it('asks for monthly rent terms and clears them for other frequencies', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const frequency = await screen.findByLabelText('Huurfrequentie');
    expect(screen.queryByLabelText('Aantal huurtermijnen')).toBeNull();
    expect(screen.getByLabelText('Sessieduur (minuten)')).toBeTruthy();

    await user.selectOptions(frequency, 'month');
    expect(screen.queryByLabelText('Sessieduur (minuten)')).toBeNull();
    expect((screen.getByLabelText('Aantal huurtermijnen') as HTMLInputElement).value).toBe('12');
    await user.clear(screen.getByLabelText('Aantal huurtermijnen'));
    await user.type(screen.getByLabelText('Aantal huurtermijnen'), '10');
    await user.click(screen.getByRole('button', { name: 'Stamgegevens opslaan' }));

    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      data: { locations: [{ id: 8, rentFrequency: 'month', rentTermCount: 10, sessionMinutes: null }] },
    });

    updateMutate.mockReset();
    await user.selectOptions(frequency, 'hour');
    expect(screen.queryByLabelText('Aantal huurtermijnen')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stamgegevens opslaan' }));
    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      data: { locations: [{ id: 8, rentFrequency: 'hour', rentTermCount: null, sessionMinutes: null }] },
    });
  });

  it('warns before saving a monthly contract below historical venue rent', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      isLoading: false,
      data: {
        id: 42,
        name: '2026/2027',
        startDate: '2026-09-01T00:00:00.000Z',
        endDate: '2027-07-01T00:00:00.000Z',
        country: 'Nederland',
        hasStarterDeduction: false,
        defaultSalary: 0,
        teachers: [],
        locations: [{ id: 8, name: 'Studio Noord', rentFrequency: 'month', rent: 200, rentTermCount: 10, sessionMinutes: null }],
        subscriptions: [],
        lessons: [],
        closures: [],
        lessonSeasonForecast: {
          locationRentBreakdowns: [{ locationId: 8, previouslyAllocatedCost: 1_500 }],
        },
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.clear(await screen.findByLabelText('Huurtarief (€ incl. btw)'));
    await user.type(screen.getByLabelText('Huurtarief (€ incl. btw)'), '100');

    expect(screen.getByRole('alert').textContent).toContain('Studio Noord');
    expect(screen.getByRole('alert').textContent).toContain('€ 1.500,00 opgeslagen');
    expect(screen.getByRole('alert').textContent).toContain('€ 1.000,00 bedraagt');

    await user.click(screen.getByRole('button', { name: 'Stamgegevens opslaan' }));
    expect(updateMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Wil je ondanks de lagere contractwaarde doorgaan?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Toch opslaan' }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      change: 'de locatie verwijderen',
      apply: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(await screen.findByRole('button', { name: 'Verwijder locatie Studio Noord' }));
      },
      expectedLocation: undefined,
    },
    {
      change: 'de huurfrequentie wijzigen naar per uur',
      apply: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.selectOptions(await screen.findByLabelText('Huurfrequentie'), 'hour');
      },
      expectedLocation: { id: 8, rentFrequency: 'hour', rentTermCount: null },
    },
    {
      change: 'de huurfrequentie wijzigen naar per sessie',
      apply: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.selectOptions(await screen.findByLabelText('Huurfrequentie'), 'session');
        await user.type(screen.getByLabelText('Sessieduur (minuten)'), '60');
      },
      expectedLocation: { id: 8, rentFrequency: 'session', rentTermCount: null },
    },
  ])('warns before saving when $change hides historical monthly rent', async ({ apply, expectedLocation }) => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      isLoading: false,
      data: {
        ...defaultSeasonResponse.data,
        locations: [{ id: 8, name: 'Studio Noord', rentFrequency: 'month', rent: 200, rentTermCount: 10, sessionMinutes: null }],
        lessonSeasonForecast: {
          locationRentBreakdowns: [{ locationId: 8, previouslyAllocatedCost: 1_500 }],
        },
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await apply(user);

    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('Studio Noord');
    expect(warning.textContent).toContain('€ 1.500,00 opgeslagen');

    await user.click(screen.getByRole('button', { name: 'Stamgegevens opslaan' }));
    expect(updateMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Wil je ondanks de verdwenen historische maandhuur doorgaan?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Toch opslaan' }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0].data.locations).toEqual(
      expectedLocation == null ? [] : [expect.objectContaining(expectedLocation)],
    );
  });

  it('distinguishes affected monthly locations with the same name and keeps each historical amount attached', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      isLoading: false,
      data: {
        ...defaultSeasonResponse.data,
        locations: [
          { id: 8, name: 'Studio', rentFrequency: 'month', rent: 200, rentTermCount: 10, sessionMinutes: null },
          { id: 9, name: 'Studio', rentFrequency: 'month', rent: 300, rentTermCount: 10, sessionMinutes: null },
        ],
        lessonSeasonForecast: {
          locationRentBreakdowns: [
            { locationId: 8, previouslyAllocatedCost: 1_500 },
            { locationId: 9, previouslyAllocatedCost: 2_750 },
          ],
        },
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const firstLocationName = await screen.findByLabelText('Naam locatie (locatie 8)');
    const secondLocationName = screen.getByLabelText('Naam locatie (locatie 9)');
    expect((firstLocationName as HTMLInputElement).value).toBe('Studio');
    expect((secondLocationName as HTMLInputElement).value).toBe('Studio');

    await user.selectOptions(screen.getByLabelText('Huurfrequentie (locatie 9)'), 'hour');
    await user.click(screen.getByRole('button', { name: 'Verwijder locatie Studio (locatie 8)' }));

    const warning = screen.getByRole('alert');
    const conflicts = Array.from(warning.querySelectorAll('li'), item => item.textContent);
    expect(conflicts).toEqual([
      expect.stringContaining('Studio (locatie 8): € 1.500,00 opgeslagen'),
      expect.stringContaining('Studio (locatie 9): € 2.750,00 opgeslagen'),
    ]);
    expect(screen.queryByLabelText('Naam locatie (locatie 8)')).toBeNull();
    expect((screen.getByLabelText('Naam locatie') as HTMLInputElement).value).toBe('Studio');

    await user.click(screen.getByRole('button', { name: 'Stamgegevens opslaan' }));
    expect(updateMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Wil je ondanks de verdwenen historische maandhuur doorgaan?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Toch opslaan' }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0].data.locations).toEqual([
      expect.objectContaining({ id: 9, name: 'Studio', rentFrequency: 'hour', rentTermCount: null }),
    ]);
  });

  it('distinguishes same-name locations in the lesson schedule and can link a lesson to either one', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: {
        ...defaultSeasonResponse.data,
        locations: [
          { id: 8, name: 'Studio', rentFrequency: 'session', rent: 20, rentTermCount: null, sessionMinutes: 60 },
          { id: 9, name: 'Studio', rentFrequency: 'session', rent: 25, rentTermCount: null, sessionMinutes: 60 },
          { id: 10, name: 'Theater', rentFrequency: 'session', rent: 30, rentTermCount: null, sessionMinutes: 60 },
        ],
        lessons: [{
          id: 12,
          name: 'Hiphop',
          teacherId: null,
          locationId: 8,
          weekday: 1,
          startTime: '18:00',
          durationMinutes: 60,
          activeFrom: '2026-09-01T00:00:00.000Z',
          activeUntil: '2027-07-01T00:00:00.000Z',
        }],
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const locationSelect = await screen.findByLabelText('Locatie');
    expect(screen.getByRole('option', { name: 'Studio (locatie 8)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Studio (locatie 9)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Theater' })).toBeTruthy();

    await user.selectOptions(locationSelect, 'id:9');
    await user.click(screen.getByRole('button', { name: 'Lessen opslaan' }));
    expect(updateMutate.mock.calls[0]?.[0].data.lessons[0]).toMatchObject({
      id: 12,
      locationId: 9,
      locationClientId: null,
    });

    updateMutate.mockReset();
    await user.selectOptions(locationSelect, 'id:8');
    await user.click(screen.getByRole('button', { name: 'Lessen opslaan' }));
    expect(updateMutate.mock.calls[0]?.[0].data.lessons[0]).toMatchObject({
      id: 12,
      locationId: 8,
      locationClientId: null,
    });
  });

  it('distinguishes same-name teachers in the lesson schedule and can link a lesson to either one', async () => {
    const user = userEvent.setup();
    getFinancialSeason.mockReturnValue({
      ...defaultSeasonResponse,
      data: {
        ...defaultSeasonResponse.data,
        teachers: [
          { id: 3, name: 'Nina', hourlyRate: 40, weeklyTravel: 10 },
          { id: 4, name: 'Nina', hourlyRate: 45, weeklyTravel: 15 },
          { id: 5, name: 'Sam', hourlyRate: 50, weeklyTravel: 20 },
        ],
        lessons: [{
          id: 12,
          name: 'Hiphop',
          teacherId: 3,
          locationId: 8,
          weekday: 1,
          startTime: '18:00',
          durationMinutes: 60,
          activeFrom: '2026-09-01T00:00:00.000Z',
          activeUntil: '2027-07-01T00:00:00.000Z',
        }],
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const teacherSelect = await screen.findByLabelText('Docent');
    expect(screen.getByRole('option', { name: 'Nina (docent 3)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Nina (docent 4)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Sam' })).toBeTruthy();

    await user.selectOptions(teacherSelect, 'id:4');
    await user.click(screen.getByRole('button', { name: 'Lessen opslaan' }));
    expect(updateMutate.mock.calls[0]?.[0].data.lessons[0]).toMatchObject({
      id: 12,
      teacherId: 4,
      teacherClientId: null,
    });

    updateMutate.mockReset();
    await user.selectOptions(teacherSelect, 'id:3');
    await user.click(screen.getByRole('button', { name: 'Lessen opslaan' }));
    expect(updateMutate.mock.calls[0]?.[0].data.lessons[0]).toMatchObject({
      id: 12,
      teacherId: 3,
      teacherClientId: null,
    });
  });
});

describe('startersaftrek guidance', () => {
  it('opens Dutch eligibility guidance from the information button', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor seasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const informationButton = screen.getByRole('button', { name: 'Meer informatie over startersaftrek' });
    expect(informationButton.getAttribute('type')).toBe('button');
    fireEvent.click(informationButton);

    const popover = screen.getByRole('dialog', { name: 'Informatie over startersaftrek' });
    expect(popover.textContent).toContain('extra aftrekpost op je Nederlandse inkomstenbelasting');
    expect(popover.textContent).toContain('aan het urencriterium voldoet');
    expect(popover.textContent).toContain('in ten minste één van de vijf voorafgaande jaren geen ondernemer was');
    expect(popover.textContent).toContain('zelfstandigenaftrek in die vijf jaren niet meer dan twee keer');
    expect(popover.textContent).toContain('Laat de keuze uit en stem af met je accountant');
  });
});

describe('new season template', () => {
  it('carries reusable master data forward without historical ids or dates', () => {
    let nextClientId = 0;
    const template = createSeasonTemplate({
      ...defaultSeasonResponse.data,
      hasStarterDeduction: true,
      teachers: [{ id: 3, name: 'Nina', hourlyRate: 42.5, weeklyTravel: 15 }],
      locations: defaultSeasonResponse.data.locations,
      lessons: [{
        id: 11,
        teacherId: 3,
        locationId: 8,
        name: 'Jeugd beginners',
        weekday: 2,
        startTime: '17:30',
        durationMinutes: 60,
        activeFrom: '2026-09-01T00:00:00.000Z',
        activeUntil: '2027-07-01T00:00:00.000Z',
      }],
      closures: [{
        id: 13,
        name: 'Kerstvakantie',
        startDate: '2026-12-20T00:00:00.000Z',
        endDate: '2027-01-03T00:00:00.000Z',
      }],
    } as unknown as FinancialSeasonDetail, () => `new-${++nextClientId}`);

    expect(template).toMatchObject({
      name: '',
      startDate: '',
      endDate: '',
      country: 'Nederland',
      hasStarterDeduction: false,
      defaultSalary: 0,
      teachers: [{ clientId: 'new-1', name: 'Nina', hourlyRate: 42.5, weeklyTravel: 15 }],
      locations: [{ clientId: 'new-2', name: 'Studio', rent: 20 }],
      lessons: [{
        teacherId: null,
        teacherClientId: 'new-1',
        locationId: null,
        locationClientId: 'new-2',
        name: 'Jeugd beginners',
        weekday: 2,
        startTime: '17:30',
        durationMinutes: 60,
        activeFrom: '',
        activeUntil: '',
      }],
      closures: [],
    });
    expect(template.subscriptions).toEqual([expect.not.objectContaining({ id: expect.anything() })]);
    expect(template.teachers).toEqual([expect.not.objectContaining({ id: expect.anything() })]);
    expect(template.locations).toEqual([expect.not.objectContaining({ id: expect.anything() })]);
    expect(template.lessons).toEqual([expect.not.objectContaining({ id: expect.anything() })]);
  });

  it('blocks an empty new season when the source season cannot be loaded', () => {
    const refetch = vi.fn();
    getFinancialSeason.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonEditor templateSeasonId={42} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('alert').textContent).toContain('konden niet worden geladen');
    expect(screen.queryByTestId('season-template-notice')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stamgegevens opslaan' })).toBeNull();
  });
});