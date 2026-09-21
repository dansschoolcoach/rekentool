import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, type FinancialMonthDetail } from '@workspace/api-client-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthView } from './MonthView';

const upsertMutate = vi.fn();
const updateTaxYearMutate = vi.fn();
const toast = vi.fn();
const refetchMonth = vi.fn();
const adminRefetchMonth = vi.fn();
let monthDetails: Record<string, FinancialMonthDetail>;
let seasonMonthDetails: Record<number, Record<string, FinancialMonthDetail>>;
let delayedMonth: string | null;
let delayedSeasonId: number | null;
let staleMonthDetail: FinancialMonthDetail | undefined;
let failedMonth: string | null;
let failedSeasonId: number | null;

const seasonLessons = [
  { id: 11, name: 'Modern', weekday: 2, startTime: '18:00' },
  { id: 12, name: 'Jazz', weekday: 1, startTime: '19:00' },
];

function createMonthDetail({
  month = '2026-10-01',
  sourceMonth = '2026-09-01',
  isSaved = false,
  lessonIds = [11, 12],
}: {
  month?: string;
  sourceMonth?: string;
  isSaved?: boolean;
  lessonIds?: number[];
} = {}): FinancialMonthDetail {
  const lessons = [
    { lessonId: 11, lessonName: 'Modern', attendance: 18 },
    { lessonId: 12, lessonName: 'Jazz', attendance: 14 },
  ].filter(lesson => lessonIds.includes(lesson.lessonId));

  return {
    month,
    isSaved,
    updatedAt: isSaved ? '2026-10-10T12:00:00.000Z' : null,
    contributionRevenue: 1200,
    taxArrears: 0,
    salaryOverride: null,
    revenue: 1200,
    costs: 300,
    grossProfit: 900,
    taxReserve: 0,
    netProfit: 900,
    salary: 0,
    bankBalance: 900,
    fixedCosts: [],
    previousMonth: null,
    previousMonthFixedCosts: [],
    activities: [],
    lessonInputs: lessons.map(lesson => ({
      lessonId: lesson.lessonId,
      attendance: lesson.attendance,
      attendanceSourceMonth: sourceMonth,
      lessonCountOverride: null,
    })),
    lessonProfitability: lessons.map(lesson => ({
        lessonId: lesson.lessonId,
        lessonName: lesson.lessonName,
        locationId: 1,
        locationName: 'Studio',
        autoCount: 4,
        effectiveCount: 4,
        attendance: lesson.attendance,
        lessonCost: 100,
        locationRentCost: 40,
        locationRentCalculation: null,
        estimatedRevenue: 200,
        estimatedProfit: 100,
        breakEvenAttendance: 9,
        promotionGap: null,
        status: 'healthy',
      })),
    cumulative: {},
  };
}

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    getGetFinancialMonthQueryKey: (seasonId: number, month: string) => ['financial-month', seasonId, month],
    getGetFinancialSeasonQueryKey: (seasonId: number) => ['financial-season', seasonId],
    getGetFinancialTaxYearQueryKey: (calendarYear: number) => ['financial-tax-year', calendarYear],
    useGetFinancialMonth: (seasonId: number, month: string) => {
      const hasFailed = failedMonth === month && (failedSeasonId === null || failedSeasonId === seasonId);
      return {
        isLoading: delayedMonth === month && (delayedSeasonId === null || delayedSeasonId === seasonId),
        isError: hasFailed,
        queryKey: ['financial-month', seasonId, month],
        data: hasFailed
          ? staleMonthDetail
          : delayedMonth === month && (delayedSeasonId === null || delayedSeasonId === seasonId)
            ? staleMonthDetail
            : seasonMonthDetails[seasonId]?.[month] ?? monthDetails[month],
        refetch: refetchMonth,
      };
    },
    useGetFinancialSeason: (seasonId: number) => ({
      isLoading: false,
      queryKey: ['financial-season', seasonId],
      data: { months: [], lessons: seasonLessons, costTrends: [] },
    }),
    useGetAdminFinancialMonth: (participantId: number, seasonId: number, month: string) => {
      const hasFailed = failedMonth === month && (failedSeasonId === null || failedSeasonId === seasonId);
      return {
        isLoading: delayedMonth === month && (delayedSeasonId === null || delayedSeasonId === seasonId),
        isError: hasFailed,
        queryKey: ['admin-financial-month', participantId, seasonId, month],
        data: hasFailed
          ? staleMonthDetail
          : delayedMonth === month && (delayedSeasonId === null || delayedSeasonId === seasonId)
            ? staleMonthDetail
            : seasonMonthDetails[seasonId]?.[month] ?? monthDetails[month],
        refetch: adminRefetchMonth,
      };
    },
    useGetAdminFinancialSeason: (participantId: number, seasonId: number) => ({
      isLoading: false,
      isError: false,
      queryKey: ['admin-financial-season', participantId, seasonId],
      data: {
        months: Object.values(seasonMonthDetails[seasonId] ?? monthDetails),
        lessons: seasonLessons,
        costTrends: [],
      },
      refetch: vi.fn(),
    }),
    useUpsertAdminFinancialMonth: () => ({ isPending: false, mutate: upsertMutate }),
    getGetAdminFinancialMonthQueryKey: (participantId: number, seasonId: number, month: string) => [
      'admin-financial-month',
      participantId,
      seasonId,
      month,
    ],
    getGetAdminFinancialSeasonQueryKey: (participantId: number, seasonId: number) => [
      'admin-financial-season',
      participantId,
      seasonId,
    ],
    useGetFinancialTaxYear: (calendarYear: number) => ({
      isLoading: false,
      isError: false,
      data: {
        calendarYear,
        calculationVersion: '2026',
        country: 'Nederland',
        hasCountryConflict: false,
        grossProfit: 900,
        estimatedTax: 225,
        effectiveReservePercentage: 25,
        preliminaryPayments: 100,
        extraToSave: 125,
        coveredMonths: [`${calendarYear}-10-01`],
        missingMonths: Array.from({ length: 11 }, (_, index) => `${calendarYear}-${String(index + 1).padStart(2, '0')}-01`).filter(month => !month.endsWith('-10-01')),
        isComplete: false,
        updatedAt: null,
      },
    }),
    useUpsertFinancialMonth: () => ({ isPending: false, mutate: upsertMutate }),
    useUpdateFinancialTaxYear: () => ({ isPending: false, mutate: updateTaxYearMutate }),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

function renderMonth(month = '2026-10-01', view: 'input' | 'costs' | 'results' = 'input') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MonthView
        seasonId={4}
        month={month}
        view={view}
        onSelectMonth={vi.fn()}
        onUnsavedChangesChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function renderAdminMonth(month = '2026-10-01', view: 'input' | 'costs' | 'results' = 'input') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MonthView
        seasonId={4}
        month={month}
        view={view}
        onSelectMonth={vi.fn()}
        onUnsavedChangesChange={vi.fn()}
        adminParticipantId={42}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  monthDetails = {
    '2026-10-01': createMonthDetail(),
  };
  seasonMonthDetails = {};
  delayedMonth = null;
  delayedSeasonId = null;
  staleMonthDetail = undefined;
  failedMonth = null;
  failedSeasonId = null;
  upsertMutate.mockReset();
  updateTaxYearMutate.mockReset();
  toast.mockReset();
  refetchMonth.mockReset();
  refetchMonth.mockImplementation(async () => ({ data: monthDetails['2026-10-01'] }));
  adminRefetchMonth.mockReset();
  adminRefetchMonth.mockImplementation(async () => ({ data: monthDetails['2026-10-01'] }));
});

afterEach(cleanup);

describe('nieuw administratief seizoen', () => {
  it('laat een beheerder de eerste maand invoeren voordat er maanden zijn opgeslagen', async () => {
    renderAdminMonth('2026-10-01', 'input');

    expect(await screen.findByRole('heading', { name: 'Invoer oktober 2026' })).not.toBeNull();
    expect(screen.getByLabelText('Contributie-inkomsten (€ incl. btw)')).not.toBeNull();
    expect(screen.queryByTestId('empty-financial-season')).toBeNull();
  });

  it('toont in Resultaten wel de lege melding zolang er niets is opgeslagen', async () => {
    renderAdminMonth('2026-10-01', 'results');

    expect(await screen.findByTestId('empty-financial-season')).not.toBeNull();
    expect(screen.getByText('Nog geen opgeslagen maanden')).not.toBeNull();
  });
});

describe('herkomstmelding van overgenomen ledenaantallen', () => {
  it('bewaart afgewezen invoer tijdens conflict en laat die na vergelijking opnieuw toepassen', async () => {
    const user = userEvent.setup();
    monthDetails['2026-10-01'] = {
      ...createMonthDetail({ isSaved: true }),
      fixedCosts: [
        { group: 'Marketing', description: 'Afgewezen advertentiecampagne', frequency: 'one_time', amount: 275 },
      ],
      activities: [
        { name: 'Afgewezen workshop', amount: 425 },
      ],
    };
    upsertMutate.mockImplementation((_variables, options) => {
      const response = new Response(JSON.stringify({ error: 'conflict' }), { status: 409, statusText: 'Conflict' });
      options.onError(new ApiError(response, { error: 'conflict' }, { method: 'PUT', url: '/financial/month' }));
    });
    renderMonth();

    const contribution = screen.getByLabelText('Contributie-inkomsten (€ incl. btw)');
    await user.clear(contribution);
    await user.type(contribution, '1450');
    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);

    expect(upsertMutate.mock.calls[0][0].data.expectedUpdatedAt).toBe('2026-10-10T12:00:00.000Z');
    expect(upsertMutate.mock.calls[0][0].data.fixedCosts).toEqual([
      { group: 'Marketing', description: 'Afgewezen advertentiecampagne', frequency: 'one_time', amount: 275 },
    ]);
    expect(upsertMutate.mock.calls[0][0].data.activities).toEqual([
      { name: 'Afgewezen workshop', amount: 425 },
    ]);
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText(/je eigen invoer is bewaard/i)).not.toBeNull();
    expect((contribution as HTMLInputElement).value).toBe('1450');

    monthDetails['2026-10-01'] = {
      ...monthDetails['2026-10-01'],
      contributionRevenue: 1300,
      updatedAt: '2026-10-10T12:05:00.000Z',
      fixedCosts: [
        { group: 'Huur', description: 'Nieuwste zaalhuur', frequency: 'monthly', amount: 600 },
      ],
      activities: [
        { name: 'Nieuwste optreden', amount: 150 },
      ],
    };
    refetchMonth.mockResolvedValueOnce({ data: monthDetails['2026-10-01'] });
    await user.click(screen.getByRole('button', { name: 'Nieuwste maand laden' }));

    expect(await screen.findByLabelText('Vergelijking van maandinvoer')).not.toBeNull();
    expect(screen.getByText(/€\s*1.300,00/)).not.toBeNull();
    expect(screen.getByText(/€\s*1.450,00/)).not.toBeNull();
    expect((contribution as HTMLInputElement).value).toBe('1300');
    expect(screen.getAllByText(/Kostenregels:/).map(node => node.textContent)).toEqual([
      'Kostenregels: 1',
      'Kostenregels: 1',
    ]);
    expect(screen.getAllByText(/Activiteiten:/).map(node => node.textContent)).toEqual([
      'Activiteiten: 1',
      'Activiteiten: 1',
    ]);

    await user.click(screen.getByRole('button', { name: 'Mijn invoer opnieuw toepassen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((contribution as HTMLInputElement).value).toBe('1450');
    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(upsertMutate.mock.calls[1][0].data.expectedUpdatedAt).toBe('2026-10-10T12:05:00.000Z');
    expect(upsertMutate.mock.calls[1][0].data.fixedCosts).toEqual([
      { group: 'Marketing', description: 'Afgewezen advertentiecampagne', frequency: 'one_time', amount: 275 },
    ]);
    expect(upsertMutate.mock.calls[1][0].data.activities).toEqual([
      { name: 'Afgewezen workshop', amount: 425 },
    ]);
  });

  it('bewaart afgewezen kosten en activiteiten wanneer de eerste conflictherlaadpoging afwijst', async () => {
    const user = userEvent.setup();
    const rejectedFixedCosts = [
      { group: 'Marketing', description: 'Afgewezen advertentiecampagne', frequency: 'one_time' as const, amount: 275 },
    ];
    const rejectedActivities = [
      { name: 'Afgewezen workshop', amount: 425 },
    ];
    monthDetails['2026-10-01'] = {
      ...createMonthDetail({ isSaved: true }),
      fixedCosts: rejectedFixedCosts,
      activities: rejectedActivities,
    };
    upsertMutate.mockImplementation((_variables, options) => {
      const response = new Response(JSON.stringify({ error: 'conflict' }), { status: 409, statusText: 'Conflict' });
      options.onError(new ApiError(response, { error: 'conflict' }, { method: 'PUT', url: '/financial/month' }));
    });
    renderMonth();

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(screen.getByRole('dialog')).not.toBeNull();

    refetchMonth.mockImplementationOnce(async () => {
      staleMonthDetail = monthDetails['2026-10-01'];
      failedMonth = '2026-10-01';
      throw new Error('Network request failed');
    });
    await user.click(screen.getByRole('button', { name: 'Nieuwste maand laden' }));

    expect(refetchMonth).toHaveBeenCalledWith({ throwOnError: true });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Nieuwste maand laden mislukt',
      description: 'Je eigen invoer is bewaard. Probeer de nieuwste maand opnieuw te laden.',
      variant: 'destructive',
    }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.queryByLabelText('Vergelijking van maandinvoer')).toBeNull();
    expect((screen.getByRole('button', { name: 'Nieuwste maand laden' }) as HTMLButtonElement).disabled).toBe(false);

    const latestOctober = {
      ...monthDetails['2026-10-01'],
      contributionRevenue: 1300,
      updatedAt: '2026-10-10T12:05:00.000Z',
      fixedCosts: [
        { group: 'Huur', description: 'Nieuwste zaalhuur', frequency: 'monthly' as const, amount: 600 },
      ],
      activities: [
        { name: 'Nieuwste optreden', amount: 150 },
      ],
    };
    failedMonth = null;
    refetchMonth.mockResolvedValueOnce({ data: latestOctober });
    await user.click(screen.getByRole('button', { name: 'Nieuwste maand laden' }));

    expect(await screen.findByLabelText('Vergelijking van maandinvoer')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mijn invoer opnieuw toepassen' }));
    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);

    expect(upsertMutate).toHaveBeenCalledTimes(2);
    expect(upsertMutate.mock.calls[1][0].data.expectedUpdatedAt).toBe('2026-10-10T12:05:00.000Z');
    expect(upsertMutate.mock.calls[1][0].data.fixedCosts).toEqual(rejectedFixedCosts);
    expect(upsertMutate.mock.calls[1][0].data.activities).toEqual(rejectedActivities);
  });

  it('verbergt alleen een aangepast aantal en wist alle meldingen na succesvol opslaan', async () => {
    const user = userEvent.setup();
    upsertMutate.mockImplementation((_variables, options) => options.onSuccess({
      ...monthDetails['2026-10-01'],
      updatedAt: '2026-10-10T12:01:00.000Z',
    }));
    renderMonth();

    expect(screen.getAllByText('Overgenomen uit september 2026')).toHaveLength(2);

    const modernAttendance = screen.getByLabelText('Ingeschreven leden voor Modern');
    await user.clear(modernAttendance);
    await user.type(modernAttendance, '19');

    expect(screen.getAllByText('Overgenomen uit september 2026')).toHaveLength(1);
    expect(screen.getByLabelText('Ingeschreven leden voor Jazz').parentElement?.textContent)
      .toContain('Overgenomen uit september 2026');

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);

    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Overgenomen uit september 2026')).toBeNull();
  });

  it('toont lessen eerst op dag en tijd en daarna op lesnaam', () => {
    renderMonth();

    const monday = screen.getByText('Maandag · 19:00');
    const tuesday = screen.getByText('Dinsdag · 18:00');

    expect(monday.parentElement?.textContent).toContain('Jazz');
    expect(tuesday.parentElement?.textContent).toContain('Modern');
    expect(monday.compareDocumentPosition(tuesday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('toont nooit een herkomstmelding voor een reeds opgeslagen maand', () => {
    monthDetails['2026-10-01'] = createMonthDetail({ isSaved: true });
    renderMonth();

    expect(screen.queryByText('Overgenomen uit september 2026')).toBeNull();
  });

  it('initialiseert na maandwisselen alleen de actuele herkomstmeldingen opnieuw', async () => {
    const user = userEvent.setup();
    monthDetails = {
      '2026-10-01': createMonthDetail({ lessonIds: [11] }),
      '2026-11-01': createMonthDetail({
        month: '2026-11-01',
        sourceMonth: '2026-10-01',
        lessonIds: [12],
      }),
    };
    const rendered = renderMonth();

    expect(screen.getByText('Overgenomen uit september 2026')).not.toBeNull();
    await user.clear(screen.getByLabelText('Ingeschreven leden voor Modern'));
    await user.type(screen.getByLabelText('Ingeschreven leden voor Modern'), '19');
    expect(screen.queryByText('Overgenomen uit september 2026')).toBeNull();

    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="input"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Overgenomen uit oktober 2026')).not.toBeNull();
    expect(screen.queryByText('Overgenomen uit september 2026')).toBeNull();

    monthDetails['2026-10-01'] = createMonthDetail({
      sourceMonth: '2026-08-01',
      lessonIds: [11],
    });
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-10-01"
          view="input"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Overgenomen uit augustus 2026')).not.toBeNull();
    expect(screen.queryByText('Overgenomen uit oktober 2026')).toBeNull();
    expect(screen.queryByText('Overgenomen uit september 2026')).toBeNull();
  });

  it('verbergt oude maandgegevens totdat een vertraagde maandwissel is geladen', async () => {
    monthDetails = {
      '2026-10-01': createMonthDetail({ lessonIds: [11] }),
      '2026-11-01': createMonthDetail({
        month: '2026-11-01',
        sourceMonth: '2026-10-01',
        lessonIds: [12],
      }),
    };
    const rendered = renderMonth();

    expect((screen.getByLabelText('Ingeschreven leden voor Modern') as HTMLInputElement).value).toBe('18');
    expect(screen.getByText('Overgenomen uit september 2026')).not.toBeNull();

    delayedMonth = '2026-11-01';
    staleMonthDetail = monthDetails['2026-10-01'];
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="input"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Maandgegevens laden...')).not.toBeNull();
    expect(screen.queryByLabelText('Ingeschreven leden voor Modern')).toBeNull();
    expect(screen.queryByText('Overgenomen uit september 2026')).toBeNull();

    delayedMonth = null;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="input"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect((screen.getByLabelText('Ingeschreven leden voor Jazz') as HTMLInputElement).value).toBe('14');
    });
    expect(screen.getByText('Overgenomen uit oktober 2026')).not.toBeNull();
    expect(screen.queryByLabelText('Ingeschreven leden voor Modern')).toBeNull();
    expect(screen.queryByText('Overgenomen uit september 2026')).toBeNull();
  });
});

describe('vertraagde maandwissel in financiële overzichten', () => {
  it('sluit in beheerdermodus het kosten-kopieervenster en focust de foutmelding wanneer een maand in een ander seizoen niet laadt', async () => {
    const user = userEvent.setup();
    const october = createMonthDetail({ isSaved: true });
    october.previousMonth = '2026-09-01';
    october.previousMonthFixedCosts = [
      { group: 'Abonnementen', description: 'Septemberlicentie', frequency: 'monthly', amount: 111 },
    ];
    seasonMonthDetails = {
      4: { '2026-10-01': october },
      5: { '2027-10-01': createMonthDetail({ month: '2027-10-01', isSaved: true }) },
    };
    const rendered = renderAdminMonth('2026-10-01', 'costs');

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();

    failedMonth = '2027-10-01';
    failedSeasonId = 5;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={5}
          month="2027-10-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
          adminParticipantId={42}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    const errorMessage = screen.getByText('Kon maandgegevens niet laden.');
    await waitFor(() => expect(document.activeElement).toBe(errorMessage));
  });

  it('sluit in beheerdermodus het kosten-kopieervenster en focust de foutmelding wanneer de nieuwe maand niet laadt', async () => {
    const user = userEvent.setup();
    const october = createMonthDetail({ isSaved: true });
    october.previousMonth = '2026-09-01';
    october.previousMonthFixedCosts = [
      { group: 'Abonnementen', description: 'Septemberlicentie', frequency: 'monthly', amount: 111 },
    ];
    monthDetails['2026-10-01'] = october;
    const rendered = renderAdminMonth('2026-10-01', 'costs');

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();

    failedMonth = '2026-11-01';
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
          adminParticipantId={42}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    const errorMessage = screen.getByText('Kon maandgegevens niet laden.');
    await waitFor(() => expect(document.activeElement).toBe(errorMessage));
  });

  it('sluit het kosten-kopieervenster en focust de foutmelding wanneer de nieuwe maand niet laadt', async () => {
    const user = userEvent.setup();
    const october = createMonthDetail({ isSaved: true });
    october.previousMonth = '2026-09-01';
    october.previousMonthFixedCosts = [
      { group: 'Abonnementen', description: 'Septemberlicentie', frequency: 'monthly', amount: 111 },
    ];
    monthDetails['2026-10-01'] = october;
    const rendered = renderMonth('2026-10-01', 'costs');

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();

    failedMonth = '2026-11-01';
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    const errorMessage = screen.getByText('Kon maandgegevens niet laden.');
    await waitFor(() => expect(document.activeElement).toBe(errorMessage));
  });

  it.each([
    ['input', 'Invoer oktober 2026'],
    ['results', 'Maandresultaat'],
  ] as const)('sluit het kosten-kopieervenster bij wisselen naar %s en herstelt focus in de nieuwe weergave', async (view, headingName) => {
    const user = userEvent.setup();
    const october = createMonthDetail({ isSaved: true });
    october.previousMonth = '2026-09-01';
    october.previousMonthFixedCosts = [
      { group: 'Abonnementen', description: 'Septemberlicentie', frequency: 'monthly', amount: 111 },
    ];
    monthDetails['2026-10-01'] = october;
    const rendered = renderMonth('2026-10-01', 'costs');

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();

    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-10-01"
          view={view}
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    const focusTarget = screen.getByRole('heading', { name: headingName });
    await waitFor(() => expect(document.activeElement).toBe(focusTarget));
  });

  it('sluit het kosten-kopieervenster bij seizoenwisselen en opent daarna alleen met de vorige kosten van het nieuwe seizoen', async () => {
    const user = userEvent.setup();
    const oldSeasonOctober = createMonthDetail({ isSaved: true });
    oldSeasonOctober.previousMonth = '2026-09-01';
    oldSeasonOctober.previousMonthFixedCosts = [
      { group: 'Abonnementen', description: 'Licentie oud seizoen', frequency: 'monthly', amount: 111 },
    ];
    const newSeasonOctober = createMonthDetail({ isSaved: true });
    newSeasonOctober.previousMonth = '2026-09-01';
    newSeasonOctober.previousMonthFixedCosts = [
      { group: 'Marketing', description: 'Campagne nieuw seizoen', frequency: 'monthly', amount: 222 },
    ];
    seasonMonthDetails = {
      4: { '2026-10-01': oldSeasonOctober },
      5: { '2026-10-01': newSeasonOctober },
    };
    const rendered = renderMonth('2026-10-01', 'costs');

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Licentie oud seizoen')).not.toBeNull();

    delayedMonth = '2026-10-01';
    delayedSeasonId = 5;
    staleMonthDetail = oldSeasonOctober;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={5}
          month="2026-10-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const loadingStatus = screen.getByText('Maandgegevens laden...');
    expect(loadingStatus).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(loadingStatus));

    delayedMonth = null;
    delayedSeasonId = null;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={5}
          month="2026-10-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Vorige maand overnemen' })).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Kosten oktober 2026' })));

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Campagne nieuw seizoen')).not.toBeNull();
    expect(screen.queryByText('Licentie oud seizoen')).toBeNull();
  });

  it('sluit het kosten-kopieervenster bij maandwisselen en opent daarna alleen met de nieuwe vorige kosten', async () => {
    const user = userEvent.setup();
    const october = createMonthDetail({ isSaved: true });
    october.previousMonth = '2026-09-01';
    october.previousMonthFixedCosts = [
      { group: 'Abonnementen', description: 'Septemberlicentie', frequency: 'monthly', amount: 111 },
    ];
    const november = createMonthDetail({ month: '2026-11-01', isSaved: true });
    november.previousMonth = '2026-10-01';
    november.previousMonthFixedCosts = [
      { group: 'Marketing', description: 'Oktobercampagne', frequency: 'monthly', amount: 222 },
    ];
    monthDetails = {
      '2026-10-01': october,
      '2026-11-01': november,
    };
    const rendered = renderMonth('2026-10-01', 'costs');

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Septemberlicentie')).not.toBeNull();

    delayedMonth = '2026-11-01';
    staleMonthDetail = october;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const loadingStatus = screen.getByText('Maandgegevens laden...');
    expect(loadingStatus).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(loadingStatus));

    delayedMonth = null;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Vorige maand overnemen' })).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Kosten november 2026' })));

    await user.click(screen.getByRole('button', { name: 'Vorige maand overnemen' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Oktobercampagne')).not.toBeNull();
    expect(screen.queryByText('Septemberlicentie')).toBeNull();
  });

  it('verbergt oude kosten en toont na laden alleen de kosten van de gekozen maand', async () => {
    const october = createMonthDetail({ isSaved: true });
    october.fixedCosts = [
      { group: 'Abonnementen', description: 'Oude softwarelicentie', frequency: 'monthly', amount: 111 },
    ];
    const november = createMonthDetail({ month: '2026-11-01', isSaved: true });
    november.fixedCosts = [
      { group: 'Marketing', description: 'Nieuwe campagne', frequency: 'one_time', amount: 222 },
    ];
    monthDetails = {
      '2026-10-01': october,
      '2026-11-01': november,
    };
    const rendered = renderMonth('2026-10-01', 'costs');

    expect(screen.getByDisplayValue('Oude softwarelicentie')).not.toBeNull();
    expect(screen.getAllByText(/€\s*111,00/)).not.toHaveLength(0);

    delayedMonth = '2026-11-01';
    staleMonthDetail = october;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Maandgegevens laden...')).not.toBeNull();
    expect(screen.queryByDisplayValue('Oude softwarelicentie')).toBeNull();
    expect(screen.queryAllByText(/€\s*111,00/)).toHaveLength(0);

    delayedMonth = null;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="costs"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByDisplayValue('Nieuwe campagne')).not.toBeNull();
    expect(screen.getAllByText(/€\s*222,00/)).not.toHaveLength(0);
    expect(screen.queryByDisplayValue('Oude softwarelicentie')).toBeNull();
    expect(screen.queryAllByText(/€\s*111,00/)).toHaveLength(0);
  });

  it('verbergt oude resultaten en toont na laden alleen de bedragen van de gekozen maand', async () => {
    const october = createMonthDetail({ isSaved: true });
    october.revenue = 1111;
    october.costs = 222;
    october.grossProfit = 889;
    october.netProfit = 777;
    const november = createMonthDetail({ month: '2026-11-01', isSaved: true });
    november.revenue = 3333;
    november.costs = 444;
    november.grossProfit = 2889;
    november.netProfit = 2555;
    monthDetails = {
      '2026-10-01': october,
      '2026-11-01': november,
    };
    const rendered = renderMonth('2026-10-01', 'results');

    expect(screen.getByText(/€\s*1\.111,00/)).not.toBeNull();
    expect(screen.getByText(/€\s*777,00/)).not.toBeNull();

    delayedMonth = '2026-11-01';
    staleMonthDetail = october;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="results"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Maandgegevens laden...')).not.toBeNull();
    expect(screen.queryByText(/€\s*1\.111,00/)).toBeNull();
    expect(screen.queryByText(/€\s*777,00/)).toBeNull();

    delayedMonth = null;
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MonthView
          seasonId={4}
          month="2026-11-01"
          view="results"
          onSelectMonth={vi.fn()}
          onUnsavedChangesChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/€\s*3\.333,00/)).not.toBeNull();
    expect(screen.getByText(/€\s*2\.555,00/)).not.toBeNull();
    expect(screen.queryByText(/€\s*1\.111,00/)).toBeNull();
    expect(screen.queryByText(/€\s*777,00/)).toBeNull();
  });
});
