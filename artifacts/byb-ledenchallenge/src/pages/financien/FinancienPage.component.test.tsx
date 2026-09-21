import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/toaster';
import { ApiError } from '@workspace/api-client-react';
import { FinancienPage } from './FinancienPage';

expect.extend(toHaveNoViolations);

const navigate = vi.fn();
const upsertMutate = vi.fn();
const createSeasonMutate = vi.fn();
const updateSeasonMutate = vi.fn();
const updateTaxYearMutate = vi.fn();
const updateProfilePreferencesMutate = vi.fn();
let activeParticipantUserId = 'test-user';
let serverMasterDataRoute: 'manual' | 'excel' | null = null;
let deferProfilePreferenceResponses = false;
const deferredProfilePreferenceRequests: Array<{
  participantUserId: string;
  resolve: (value: { masterDataRoute: 'manual' | 'excel' | null }) => void;
  reject: (reason?: unknown) => void;
}> = [];
let latestSeasonIsEmpty = false;
let latestAdminSeasonIsEmpty = false;
type FinancialMonthQueryOverride = {
  isLoading: boolean;
  isError: boolean;
  data?: typeof monthDetail | typeof previousSeasonMonthDetail;
  queryKey: readonly unknown[];
};
let financialMonthQueryOverrides: Map<number, FinancialMonthQueryOverride> | null = null;
let adminFinancialMonthQueryOverrides: Map<number, FinancialMonthQueryOverride> | null = null;
let adminFinancialSeasonQueryOverride: {
  isLoading: boolean;
  data?: Record<string, any>;
  queryKey: readonly unknown[];
} | null = null;

const seasons = [
  { id: 1, name: '2025/2026', startDate: '2025-09-01', endDate: '2026-07-01' },
  { id: 2, name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-01' },
];

const monthDetail = {
  month: '2026-09-01',
  isSaved: true,
  updatedAt: '2026-09-10T12:00:00.000Z',
  contributionRevenue: 1200,
  taxArrears: 0,
  salaryOverride: null,
  revenue: 1111,
  costs: 222,
  grossProfit: 889,
  taxReserve: 100,
  netProfit: 789,
  salary: 500,
  bankBalance: 0,
  fixedCosts: [],
  previousMonth: null,
  previousMonthFixedCosts: [],
  activities: [],
  lessonInputs: [],
  lessonProfitability: [],
  cumulative: null,
};

const octoberDetail = {
  ...monthDetail,
  month: '2026-10-01',
  updatedAt: '2026-10-10T12:00:00.000Z',
  contributionRevenue: 1400,
  revenue: 2222,
  costs: 333,
  grossProfit: 1889,
  netProfit: 1689,
};

const previousSeasonMonthDetail = {
  ...monthDetail,
  month: '2025-09-01',
  updatedAt: '2025-09-10T12:00:00.000Z',
  contributionRevenue: 9876,
  taxArrears: 876,
  revenue: 9876,
  costs: 4321,
  grossProfit: 5555,
  netProfit: 4444,
  fixedCosts: [{
    group: 'Marketing',
    description: 'Campagne vorig seizoen',
    frequency: 'monthly',
    amount: 321,
  }],
  activities: [{
    name: 'Workshop vorig seizoen',
    amount: 654,
  }],
};

const emptySeasonMonthDetail = {
  ...monthDetail,
  isSaved: false,
  updatedAt: null,
  contributionRevenue: 0,
  revenue: 0,
  costs: 0,
  grossProfit: 0,
  taxReserve: 0,
  netProfit: 0,
  salary: 0,
};

const taxYearSummary = {
  calculationVersion: '2026',
  preliminaryPayments: 0,
  coveredMonths: [],
  missingMonths: [],
  hasCountryConflict: false,
  isComplete: true,
  grossProfit: 0,
  estimatedTax: 0,
  effectiveReservePercentage: 0,
  extraToSave: 0,
  updatedAt: null,
};

vi.mock('wouter', () => ({
  useLocation: () => ['/financien', navigate],
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ userId: activeParticipantUserId }),
}));

vi.mock('@workspace/api-client-react', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;

    constructor(response: Response, data: unknown) {
      super(`HTTP ${response.status}`);
      this.status = response.status;
      this.data = data;
    }
  },
  getGetFinancialMonthQueryKey: (seasonId: number, month: string) => ['financial-month', seasonId, month],
  getGetFinancialSeasonQueryKey: (seasonId: number) => ['financial-season', seasonId],
  getGetFinancialSeasonsQueryKey: () => ['financial-seasons'],
  getGetFinancialFileSubmissionsQueryKey: (seasonId: number) => ['financial-file-submissions', seasonId],
  getGetFinancialTaxYearQueryKey: (calendarYear: number) => ['financial-tax-year', calendarYear],
  getGetProfilePreferencesQueryKey: () => ['profile-preferences'],
  getGetAdminFinancialSeasonsQueryKey: (participantId: number) => ['admin-financial-seasons', participantId],
  getGetAdminFinancialSeasonQueryKey: (participantId: number, seasonId: number) => ['admin-financial-season', participantId, seasonId],
  getGetAdminFinancialMonthQueryKey: (participantId: number, seasonId: number, month: string) => ['admin-financial-month', participantId, seasonId, month],
  getGetAdminFinancialTaxYearQueryKey: (participantId: number, calendarYear: number) => ['admin-financial-tax-year', participantId, calendarYear],
  useGetDashboard: () => ({
    isLoading: false,
    isError: false,
    data: { participant: { country: 'Nederland' } },
  }),
  useGetProfilePreferences: (options?: {
    query?: { queryKey?: readonly unknown[]; enabled?: boolean };
  }) => useQuery({
    queryKey: options?.query?.queryKey ?? ['profile-preferences'],
    enabled: options?.query?.enabled ?? true,
    retry: false,
    queryFn: () => {
      if (!deferProfilePreferenceResponses) {
        return Promise.resolve({ masterDataRoute: serverMasterDataRoute });
      }
      return new Promise<{ masterDataRoute: 'manual' | 'excel' | null }>((resolve, reject) => {
        const participantUserId = String(options?.query?.queryKey?.at(-1) ?? 'anonymous');
        deferredProfilePreferenceRequests.push({ participantUserId, resolve, reject });
      });
    },
  }),
  useUpdateProfilePreferences: () => ({
    mutate: updateProfilePreferencesMutate,
  }),
  useGetFinancialSeasons: () => ({ isLoading: false, isError: false, data: seasons }),
  useGetAdminFinancialSeasons: () => ({ isLoading: false, isError: false, data: seasons }),
  useGetFinancialFileSubmissions: () => ({
    isLoading: false,
    isError: false,
    data: [{
      id: 10,
      seasonId: 2,
      seasonName: '2026/2027',
      fileType: 'teachers',
      filename: 'ingevulde-docenten.xlsx',
      sizeBytes: 1200,
      status: 'in_progress',
      submittedAt: '2026-09-15T10:00:00.000Z',
      downloadUrl: '/api/financial/file-submissions/10/download',
    }],
  }),
  useRequestFinancialFileSubmissionUpload: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateFinancialFileSubmission: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGetFinancialSeason: (seasonId: number) => ({
    isLoading: false,
    data: {
      ...seasons.find(season => season.id === seasonId),
      country: 'Nederland',
      hasStarterDeduction: false,
      defaultSalary: 0,
      teachers: [],
      locations: [],
      subscriptions: [],
      lessons: [],
      closures: [],
      months: seasonId === 1
        ? [previousSeasonMonthDetail]
        : latestSeasonIsEmpty ? [] : [monthDetail, octoberDetail],
      costTrends: [],
      lessonSeasonForecast: {
        months: [],
        lessons: [],
        locationRentBreakdowns: [],
        unallocatedLocations: [],
        overallocatedLocations: [],
      },
    },
  }),
  useGetAdminFinancialSeason: (participantId: number, seasonId: number) => adminFinancialSeasonQueryOverride ?? ({
    isLoading: false,
    queryKey: ['admin-financial-season', participantId, seasonId],
    data: {
      ...seasons.find(season => season.id === seasonId),
      country: 'Nederland',
      hasStarterDeduction: false,
      defaultSalary: 0,
      teachers: [],
      locations: [],
      subscriptions: [],
      lessons: [],
      closures: [],
      months: seasonId === 1
        ? [previousSeasonMonthDetail]
        : latestAdminSeasonIsEmpty ? [] : [monthDetail, octoberDetail],
      costTrends: [],
      lessonSeasonForecast: {
        months: [],
        lessons: [],
        locationRentBreakdowns: [],
        unallocatedLocations: [],
        overallocatedLocations: [],
      },
    },
  }),
  useGetFinancialMonth: (seasonId: number, month: string) => financialMonthQueryOverrides?.get(seasonId) ?? ({
    isLoading: false,
    isError: false,
    queryKey: ['financial-month', seasonId, month],
    data: seasonId === 1
      ? previousSeasonMonthDetail
      : latestSeasonIsEmpty
        ? emptySeasonMonthDetail
        : month === octoberDetail.month ? octoberDetail : monthDetail,
  }),
  useGetAdminFinancialMonth: (participantId: number, seasonId: number, month: string) => adminFinancialMonthQueryOverrides?.get(seasonId) ?? ({
    isLoading: false,
    isError: false,
    queryKey: ['admin-financial-month', participantId, seasonId, month],
    data: seasonId === 1
      ? previousSeasonMonthDetail
      : latestAdminSeasonIsEmpty
        ? emptySeasonMonthDetail
        : month === octoberDetail.month ? octoberDetail : monthDetail,
  }),
  useCreateFinancialSeason: () => ({ isPending: false, mutate: createSeasonMutate }),
  useUpdateFinancialSeason: () => ({ isPending: false, mutate: updateSeasonMutate }),
  useCreateAdminFinancialSeason: () => ({ isPending: false, mutate: createSeasonMutate }),
  useUpdateAdminFinancialSeason: () => ({ isPending: false, mutate: updateSeasonMutate }),
  useUpsertFinancialMonth: () => ({ isPending: false, mutate: upsertMutate }),
  useUpsertAdminFinancialMonth: () => ({ isPending: false, mutate: upsertMutate }),
  useGetFinancialTaxYear: () => ({
    isLoading: false,
    isError: false,
    data: taxYearSummary,
  }),
  useUpdateFinancialTaxYear: () => ({ isPending: false, mutate: updateTaxYearMutate }),
  useGetAdminFinancialTaxYear: () => ({
    isLoading: false,
    isError: false,
    data: taxYearSummary,
  }),
  useUpdateAdminFinancialTaxYear: () => ({ isPending: false, mutate: updateTaxYearMutate }),
}));

function ParticipantPageTestShell() {
  return (
    <main>
      <a
        href="/dashboard"
        data-testid="sidebar-dashboard"
        onClick={(event) => {
          event.preventDefault();
          navigate('/dashboard');
        }}
      >
        Overzicht
      </a>
      <FinancienPage />
    </main>
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <ParticipantPageTestShell />
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

async function expectCurrentFinancialViewToBeAccessible() {
  const results = await axe(document.body, {
    rules: {
      // JSDOM cannot calculate styles and layout reliably enough for contrast checks.
      'color-contrast': { enabled: false },
    },
  });
  expect(results).toHaveNoViolations();
}

function renderAdminPage(participantId = 42) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <main>
        <FinancienPage
          adminParticipantId={participantId}
          adminParticipantName="Beheer deelnemer"
          adminParticipantCountry="Nederland"
        />
      </main>
      <Toaster />
    </QueryClientProvider>,
  );
}

async function changeContribution(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = await screen.findByLabelText('Contributie-inkomsten (€ incl. btw)');
  await user.clear(input);
  await user.type(input, value);
}

function expectDiscardDialog() {
  return expect(screen.getByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' }));
}

async function stayEditing(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Blijven bewerken' }));
  expect(screen.queryByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeNull();
}

beforeEach(() => {
  latestSeasonIsEmpty = false;
  latestAdminSeasonIsEmpty = false;
  financialMonthQueryOverrides = null;
  adminFinancialMonthQueryOverrides = null;
  adminFinancialSeasonQueryOverride = null;
  window.history.replaceState(null, '', '/financien');
  navigate.mockReset();
  upsertMutate.mockReset();
  createSeasonMutate.mockReset();
  updateSeasonMutate.mockReset();
  updateTaxYearMutate.mockReset();
  updateProfilePreferencesMutate.mockReset();
  activeParticipantUserId = 'test-user';
  serverMasterDataRoute = null;
  deferProfilePreferenceResponses = false;
  deferredProfilePreferenceRequests.length = 0;
  localStorage.clear();
});


afterEach(cleanup);

describe('bescherming van niet-opgeslagen financiële maandinvoer', () => {
  it.each([
    { name: 'Invoer', testId: 'tab-input' },
    { name: 'Kosten', testId: 'tab-costs' },
    { name: 'Resultaten', testId: 'tab-results' },
    { name: 'Stamgegevens', testId: 'tab-stamgegevens' },
  ])('heeft geen automatisch detecteerbare toegankelijkheidsfouten in $name', async ({ testId }) => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(screen.getByTestId(testId));
    await expectCurrentFinancialViewToBeAccessible();
  });

  it('maakt de actieve financiële weergave herkenbaar en laat toetsenbordnavigatie werken', async () => {
    const user = userEvent.setup();
    renderPage();

    const viewGroup = screen.getByRole('group', { name: 'Financiële weergave' });
    const inputButton = screen.getByRole('button', { name: 'Invoer' });
    const costsButton = screen.getByRole('button', { name: 'Kosten' });
    const resultsButton = screen.getByRole('button', { name: 'Resultaten' });

    expect(viewGroup.contains(inputButton)).toBe(true);
    expect(inputButton.getAttribute('aria-pressed')).toBe('true');
    expect(costsButton.getAttribute('aria-pressed')).toBe('false');
    expect(resultsButton.getAttribute('aria-pressed')).toBe('false');

    inputButton.focus();
    await user.tab();
    expect(document.activeElement).toBe(costsButton);
    await user.keyboard('{Enter}');
    expect(inputButton.getAttribute('aria-pressed')).toBe('false');
    expect(costsButton.getAttribute('aria-pressed')).toBe('true');

    await user.tab();
    expect(document.activeElement).toBe(resultsButton);
    await user.keyboard(' ');
    expect(costsButton.getAttribute('aria-pressed')).toBe('false');
    expect(resultsButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('laat bij wisselen naar een leeg seizoen geen maand of resultaatcijfers van het vorige seizoen staan', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    await user.click(screen.getByTestId('tab-results'));
    expect(await screen.findByTestId('button-compare-month-2025-09')).not.toBeNull();
    expect(screen.getAllByText(/€\s*9\.876,00/).length).toBeGreaterThan(0);

    latestSeasonIsEmpty = true;
    await user.selectOptions(screen.getByTestId('select-season'), '2');

    await waitFor(() => {
      expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-09');
    });
    expect(screen.queryByTestId('button-compare-month-2025-09')).toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();
    expect(screen.queryByText(/€\s*4\.321,00/)).toBeNull();
    expect(screen.queryByText(/€\s*5\.555,00/)).toBeNull();
    expect(screen.queryByText(/€\s*4\.444,00/)).toBeNull();
  });

  it('laat bij wisselen vanuit Invoer naar een leeg seizoen alleen lege invoerwaarden zien', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expect((await screen.findByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('9876');
    expect((screen.getByLabelText('Belastingschuld / achterstand (€; geen btw)') as HTMLInputElement).value).toBe('876');
    expect((screen.getByPlaceholderText('Activiteit') as HTMLInputElement).value).toBe('Workshop vorig seizoen');

    latestSeasonIsEmpty = true;
    await user.selectOptions(screen.getByTestId('select-season'), '2');

    expect((await screen.findByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Belastingschuld / achterstand (€; geen btw)') as HTMLInputElement).value).toBe('0');
    expect(screen.queryByDisplayValue('Workshop vorig seizoen')).toBeNull();
  });

  it('laat bij wisselen vanuit Kosten naar een leeg seizoen geen kostenposten of oude bedragen zien', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('tab-costs'));
    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expect((await screen.findByDisplayValue('Campagne vorig seizoen') as HTMLInputElement).value).toBe('Campagne vorig seizoen');
    expect((screen.getByLabelText('Bedrag inclusief btw van Campagne vorig seizoen') as HTMLInputElement).value).toBe('321');

    latestSeasonIsEmpty = true;
    await user.selectOptions(screen.getByTestId('select-season'), '2');

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Campagne vorig seizoen')).toBeNull();
    });
    expect(screen.queryByDisplayValue('Campagne vorig seizoen')).toBeNull();
    expect(screen.queryByLabelText('Bedrag inclusief btw van Campagne vorig seizoen')).toBeNull();
    expect(screen.getAllByText('Geen regels')).toHaveLength(10);
    expect(screen.getAllByText(/€\s*0,00/).length).toBeGreaterThan(0);
  });

  it('laat beheerders na wisselen naar een leeg seizoen geen oude maandgegevens zien', async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(screen.getByTestId('tab-input'));
    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expect((await screen.findByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('9876');
    expect((screen.getByPlaceholderText('Activiteit') as HTMLInputElement).value).toBe('Workshop vorig seizoen');
    await user.click(screen.getByTestId('tab-costs'));
    expect((await screen.findByDisplayValue('Campagne vorig seizoen') as HTMLInputElement).value).toBe('Campagne vorig seizoen');
    expect((screen.getByLabelText('Bedrag inclusief btw van Campagne vorig seizoen') as HTMLInputElement).value).toBe('321');

    latestAdminSeasonIsEmpty = true;
    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-results'));

    expect(await screen.findByTestId('empty-financial-season')).not.toBeNull();
    expect(screen.getByText('Nog geen opgeslagen maanden')).not.toBeNull();
    expect(screen.queryByDisplayValue('9876')).toBeNull();
    expect(screen.queryByDisplayValue('Workshop vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('Campagne vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('321')).toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();
    expect(screen.queryByText(/€\s*4\.321,00/)).toBeNull();
  });

  it('toont bij snel wisselen alleen de laadstatus of maandgegevens van het laatst gekozen seizoen', async () => {
    const user = userEvent.setup();
    financialMonthQueryOverrides = new Map([
      [1, {
        isLoading: true,
        isError: false,
        queryKey: ['financial-month', 1, '2025-09-01'],
      }],
      [2, {
        isLoading: false,
        isError: false,
        data: monthDetail,
        queryKey: ['financial-month', 2, '2026-09-01'],
      }],
    ]);
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expect(await screen.findByText('Maandgegevens laden...')).not.toBeNull();

    financialMonthQueryOverrides.set(2, {
      isLoading: true,
      isError: false,
      queryKey: ['financial-month', 2, '2026-09-01'],
    });
    await user.selectOptions(screen.getByTestId('select-season'), '2');
    expect(await screen.findByText('Maandgegevens laden...')).not.toBeNull();

    // Het eerdere seizoen antwoordt pas nadat seizoen 2 al gekozen is.
    financialMonthQueryOverrides.set(1, {
      isLoading: false,
      isError: false,
      data: previousSeasonMonthDetail,
      queryKey: ['financial-month', 1, '2025-09-01'],
    });
    await user.click(screen.getByTestId('tab-costs'));

    expect(screen.getByText('Maandgegevens laden...')).not.toBeNull();
    expect(screen.queryByDisplayValue('9876')).toBeNull();
    expect(screen.queryByDisplayValue('Workshop vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('Campagne vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('321')).toBeNull();

    financialMonthQueryOverrides.set(2, {
      isLoading: false,
      isError: false,
      data: monthDetail,
      queryKey: ['financial-month', 2, '2026-09-01'],
    });
    await user.click(screen.getByTestId('tab-input'));

    await waitFor(() => {
      expect((screen.getByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('1200');
    });
    expect(screen.queryByDisplayValue('9876')).toBeNull();
    expect(screen.queryByDisplayValue('Workshop vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('Campagne vorig seizoen')).toBeNull();
  });

  it('toont beheerders bij snel wisselen alleen de laadstatus of maandgegevens van het laatst gekozen seizoen', async () => {
    const user = userEvent.setup();
    adminFinancialMonthQueryOverrides = new Map([
      [1, {
        isLoading: true,
        isError: false,
        queryKey: ['admin-financial-month', 42, 1, '2025-09-01'],
      }],
      [2, {
        isLoading: false,
        isError: false,
        data: octoberDetail,
        queryKey: ['admin-financial-month', 42, 2, '2026-10-01'],
      }],
    ]);
    renderAdminPage();

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expect(await screen.findByText('Maandgegevens laden...')).not.toBeNull();

    adminFinancialMonthQueryOverrides.set(2, {
      isLoading: true,
      isError: false,
      queryKey: ['admin-financial-month', 42, 2, '2026-10-01'],
    });
    await user.selectOptions(screen.getByTestId('select-season'), '2');
    expect(await screen.findByText('Maandgegevens laden...')).not.toBeNull();

    // Het eerdere beheerverzoek antwoordt pas nadat seizoen 2 al gekozen is.
    adminFinancialMonthQueryOverrides.set(1, {
      isLoading: false,
      isError: false,
      data: previousSeasonMonthDetail,
      queryKey: ['admin-financial-month', 42, 1, '2025-09-01'],
    });
    await user.click(screen.getByTestId('tab-costs'));

    expect(screen.getByText('Maandgegevens laden...')).not.toBeNull();
    expect(screen.queryByDisplayValue('9876')).toBeNull();
    expect(screen.queryByDisplayValue('Workshop vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('Campagne vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('321')).toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();
    expect(screen.queryByText(/€\s*4\.321,00/)).toBeNull();

    adminFinancialMonthQueryOverrides.set(2, {
      isLoading: false,
      isError: false,
      data: octoberDetail,
      queryKey: ['admin-financial-month', 42, 2, '2026-10-01'],
    });
    await user.click(screen.getByTestId('tab-input'));

    await waitFor(() => {
      expect((screen.getByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('1400');
    });
    expect(screen.queryByDisplayValue('9876')).toBeNull();
    expect(screen.queryByDisplayValue('Workshop vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('Campagne vorig seizoen')).toBeNull();
    expect(screen.queryByDisplayValue('321')).toBeNull();
  });

  it('laat een vertraagd seizoensoverzicht de beheermaand van het laatst gekozen seizoen niet terugzetten', async () => {
    const user = userEvent.setup();
    adminFinancialSeasonQueryOverride = {
      isLoading: true,
      queryKey: ['admin-financial-season', 42, 2],
    };
    renderAdminPage();

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-results'));

    adminFinancialSeasonQueryOverride = {
      isLoading: false,
      queryKey: ['admin-financial-season', 42, 1],
      data: {
        ...seasons[0],
        country: 'Nederland',
        hasStarterDeduction: false,
        defaultSalary: 0,
        teachers: [],
        locations: [],
        subscriptions: [],
        lessons: [],
        closures: [],
        months: [previousSeasonMonthDetail],
        costTrends: [],
        lessonSeasonForecast: {
          months: [],
          lessons: [],
          locationRentBreakdowns: [],
          unallocatedLocations: [],
          overallocatedLocations: [],
        },
      },
    };
    await user.click(screen.getByTestId('tab-costs'));

    expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('button-compare-month-2025-09')).toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();

    adminFinancialSeasonQueryOverride = {
      isLoading: false,
      queryKey: ['admin-financial-season', 42, 2],
      data: {
        ...seasons[1],
        country: 'Nederland',
        hasStarterDeduction: false,
        defaultSalary: 0,
        teachers: [],
        locations: [],
        subscriptions: [],
        lessons: [],
        closures: [],
        months: [monthDetail, octoberDetail],
        costTrends: [],
        lessonSeasonForecast: {
          months: [],
          lessons: [],
          locationRentBreakdowns: [],
          unallocatedLocations: [],
          overallocatedLocations: [],
        },
      },
    };
    await user.click(screen.getByTestId('tab-results'));

    await waitFor(() => {
      expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-10');
    });
    expect(screen.getByTestId('button-compare-month-2026-09')).not.toBeNull();
    expect(screen.getByTestId('button-compare-month-2026-10')).not.toBeNull();
    expect(screen.queryByTestId('button-compare-month-2025-09')).toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();
  });

  it('laat een laat seizoensoverzicht van de vorige deelnemer de beheermaand en vergelijking niet bepalen', async () => {
    const user = userEvent.setup();
    const previousParticipantSeason = {
      ...seasons[1],
      months: [previousSeasonMonthDetail],
    };
    const currentParticipantSeason = {
      ...seasons[1],
      months: [monthDetail, octoberDetail],
    };
    const rendered = renderAdminPage(1);

    adminFinancialSeasonQueryOverride = {
      isLoading: true,
      queryKey: ['admin-financial-season', 1, 2],
    };
    await user.selectOptions(screen.getByTestId('select-season'), '2');

    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <main>
          <FinancienPage
            adminParticipantId={2}
            adminParticipantName="Nieuwe deelnemer"
            adminParticipantCountry="Nederland"
          />
        </main>
        <Toaster />
      </QueryClientProvider>,
    );
    await waitFor(() => expect((screen.getByTestId('select-season') as HTMLSelectElement).value).toBe('2'));

    adminFinancialSeasonQueryOverride = {
      isLoading: false,
      queryKey: ['admin-financial-season', 1, 2],
      data: previousParticipantSeason,
    };
    await user.click(screen.getByTestId('tab-results'));

    expect(screen.getByText('Maandgegevens laden...')).not.toBeNull();
    expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-09');
    expect(screen.queryByTestId('button-compare-month-2025-09')).toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();

    adminFinancialSeasonQueryOverride = {
      isLoading: false,
      queryKey: ['admin-financial-season', 2, 2],
      data: currentParticipantSeason,
    };
    await user.click(screen.getByTestId('tab-costs'));
    await user.click(screen.getByTestId('tab-results'));

    await waitFor(() => {
      expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-10');
    });
    expect(screen.getByTestId('button-compare-month-2026-09')).not.toBeNull();
    expect(screen.getByTestId('button-compare-month-2026-10')).not.toBeNull();
    expect(screen.queryByTestId('button-compare-month-2025-09')).toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();
  });

  it('negeert een laat maandantwoord van de vorige deelnemer bij dezelfde seizoen-ID', async () => {
    const user = userEvent.setup();
    const previousParticipantMonth = {
      ...previousSeasonMonthDetail,
      month: '2026-10-01',
      fixedCosts: [{
        group: 'Marketing',
        description: 'Kosten vorige deelnemer',
        frequency: 'monthly',
        amount: 321,
      }],
      contributionRevenue: 9876,
      revenue: 9876,
      costs: 4321,
      grossProfit: 5555,
      netProfit: 4444,
    };
    const currentParticipantMonth = {
      ...octoberDetail,
      fixedCosts: [{
        group: 'Marketing',
        description: 'Kosten nieuwe deelnemer',
        frequency: 'monthly',
        amount: 654,
      }],
      contributionRevenue: 1400,
      revenue: 2222,
      costs: 333,
      grossProfit: 1889,
      netProfit: 1689,
    };
    const rendered = renderAdminPage(1);

    adminFinancialMonthQueryOverrides = new Map([
      [2, {
        isLoading: true,
        isError: false,
        queryKey: ['admin-financial-month', 1, 2, '2026-10-01'],
      }],
    ]);
    await user.selectOptions(screen.getByTestId('select-season'), '2');

    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <main>
          <FinancienPage
            adminParticipantId={2}
            adminParticipantName="Nieuwe deelnemer"
            adminParticipantCountry="Nederland"
          />
        </main>
        <Toaster />
      </QueryClientProvider>,
    );

    await waitFor(() => expect((screen.getByTestId('select-season') as HTMLSelectElement).value).toBe('2'));

    adminFinancialMonthQueryOverrides.set(2, {
      isLoading: false,
      isError: false,
      data: previousParticipantMonth,
      queryKey: ['admin-financial-month', 1, 2, '2026-10-01'],
    });
    await user.click(screen.getByTestId('tab-costs'));

    expect(screen.getByText('Maandgegevens laden...')).not.toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();
    expect(screen.queryByText(/€\s*4\.321,00/)).toBeNull();
    expect(screen.queryByDisplayValue('Kosten vorige deelnemer')).toBeNull();
    expect(screen.queryByText(/€\s*321,00/)).toBeNull();

    adminFinancialMonthQueryOverrides.set(2, {
      isLoading: false,
      isError: false,
      data: currentParticipantMonth,
      queryKey: ['admin-financial-month', 2, 2, '2026-10-01'],
    });
    await user.click(screen.getByTestId('tab-results'));

    expect(await screen.findByText(/€\s*2\.222,00/)).not.toBeNull();
    expect(screen.getByText(/€\s*1\.689,00/)).not.toBeNull();
    expect(screen.queryByText(/€\s*9\.876,00/)).toBeNull();
    expect(screen.queryByText(/€\s*4\.444,00/)).toBeNull();

    await user.click(screen.getByTestId('tab-input'));
    expect((await screen.findByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('1400');
    expect(screen.queryByDisplayValue('9876')).toBeNull();

    await user.click(screen.getByTestId('tab-costs'));
    expect(screen.getByDisplayValue('Kosten nieuwe deelnemer')).not.toBeNull();
    expect(screen.queryByDisplayValue('Kosten vorige deelnemer')).toBeNull();
    expect(screen.getAllByText(/€\s*654,00/)).not.toHaveLength(0);
    expect(screen.queryByText(/€\s*321,00/)).toBeNull();
  });

  it('toont handmatige stamgegevens direct met een compacte keuze voor de twee Excel-sjablonen', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    expect(screen.getByTestId('participant-master-data-choice')).not.toBeNull();
    expect(screen.getByLabelText('Naam seizoen')).not.toBeNull();
    expect(screen.getByTestId('choose-master-data-manual').getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByTestId('choose-master-data-excel'));
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/niet automatisch geïmporteerd/i)).not.toBeNull();
    const teacherDownload = screen.getByTestId('download-template-teachers') as HTMLAnchorElement;
    const subscriptionDownload = screen.getByTestId('download-template-subscriptions') as HTMLAnchorElement;
    expect(teacherDownload.getAttribute('href')).toMatch(/templates\/ByB-Cijfers-sjabloon-docenten\.xlsx$/);
    expect(teacherDownload.getAttribute('download')).toBe('ByB-Cijfers-sjabloon-docenten.xlsx');
    expect(subscriptionDownload.getAttribute('href')).toMatch(/templates\/ByB-Cijfers-sjabloon-abonnementen-en-rittenkaarten\.xlsx$/);
    expect(subscriptionDownload.getAttribute('download')).toBe('ByB-Cijfers-sjabloon-abonnementen-en-rittenkaarten.xlsx');
    const teacherFile = new File(['xlsx'], 'ingevulde-docenten.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await user.upload(screen.getByTestId('input-submit-teachers'), teacherFile);
    expect(screen.getByText('ingevulde-docenten.xlsx')).not.toBeNull();
    expect((screen.getByTestId('button-submit-financial-files') as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByTestId('choose-master-data-manual'));
    expect(screen.getByTestId('participant-master-data-manual')).not.toBeNull();
    expect(screen.getByLabelText('Naam seizoen')).not.toBeNull();
    expect(screen.getByTestId('button-save-season-general')).not.toBeNull();
  });

  it('houdt de Excelroute zichtbaar en gekozen wanneer het eerste seizoen wordt opgeslagen', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('btn-new-season'));
    expect(screen.getByRole('heading', { name: 'Nieuw seizoen inrichten' })).not.toBeNull();

    await user.click(screen.getByTestId('choose-master-data-excel'));
    expect(screen.getByTestId('download-template-teachers')).not.toBeNull();
    expect(screen.getByTestId('download-template-subscriptions')).not.toBeNull();
    expect(screen.getByTestId('excel-save-season-notice').textContent).toContain('Sla hieronder eerst je seizoen op');
    expect(screen.queryByTestId('input-submit-teachers')).toBeNull();
    expect(screen.getByLabelText('Naam seizoen')).not.toBeNull();
    expect(screen.getByLabelText('Land')).not.toBeNull();
    expect(screen.getByLabelText('Startdatum')).not.toBeNull();
    expect(screen.getByLabelText('Einddatum')).not.toBeNull();
    expect(screen.queryByLabelText('Bruto standaard maandsalaris (€)')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Docenten' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Locaties' })).toBeNull();

    fireEvent.submit(screen.getByTestId('button-save-season-general').closest('form')!);
    expect(createSeasonMutate).toHaveBeenCalledTimes(1);
    expect(createSeasonMutate.mock.calls[0][0].data).toMatchObject({
      hasStarterDeduction: false,
      defaultSalary: 0,
      teachers: [],
      locations: [],
      subscriptions: [],
      lessons: [],
      closures: [],
    });
    act(() => createSeasonMutate.mock.calls[0][1].onSuccess({ id: 2, updatedAt: '2026-09-20T08:00:00.000Z' }));

    await waitFor(() => expect(screen.getByTestId('tab-stamgegevens').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('input-submit-teachers')).not.toBeNull();
    expect(screen.queryByTestId('excel-save-season-notice')).toBeNull();
    expect(localStorage.getItem('byb:financial-season-draft:v2:participant:test-user:season:2')).toBeNull();

    await user.click(screen.getByTestId('choose-master-data-manual'));
    expect(screen.queryByTestId('season-draft-notice')).toBeNull();
  });

  it('opent stamgegevens na terugkeer op de laatst gekozen route van de deelnemer', async () => {
    const user = userEvent.setup();
    const firstRender = renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));

    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('excel');
    firstRender.unmount();

    renderPage();
    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));

    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-choice')).not.toBeNull();
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(updateProfilePreferencesMutate.mock.calls[0][0]).toEqual({
      data: { masterDataRoute: 'excel' },
    });
  });

  it('houdt een route lokaal actief en laat mislukte synchronisatie opnieuw proberen', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));

    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('excel');

    act(() => updateProfilePreferencesMutate.mock.calls[0][1].onError());

    expect(screen.getByText(/kon niet worden gesynchroniseerd/i)).not.toBeNull();
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Synchronisatie opnieuw proberen' }));

    expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(2);
    expect(updateProfilePreferencesMutate.mock.calls[1][0]).toEqual({
      data: { masterDataRoute: 'excel' },
    });

    act(() => updateProfilePreferencesMutate.mock.calls[1][1].onSuccess());
    expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
  });

  it('houdt de gekozen Excelroute actief wanneer browseropslag niet beschikbaar is', async () => {
    const user = userEvent.setup();
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Browseropslag is tijdelijk niet beschikbaar.');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Browseropslag is tijdelijk niet beschikbaar.');
    });

    try {
      renderPage();

      await user.selectOptions(screen.getByTestId('select-season'), '2');
      await user.click(screen.getByTestId('tab-stamgegevens'));
      await user.click(screen.getByTestId('choose-master-data-excel'));

      expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
      expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(1);

      act(() => updateProfilePreferencesMutate.mock.calls[0][1].onError());

      expect(screen.getByText(/kon niet worden gesynchroniseerd/i)).not.toBeNull();
      expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();

      await user.click(screen.getByRole('button', { name: 'Synchronisatie opnieuw proberen' }));

      expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(2);
      expect(updateProfilePreferencesMutate.mock.calls[1][0]).toEqual({
        data: { masterDataRoute: 'excel' },
      });
      expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();

      act(() => updateProfilePreferencesMutate.mock.calls[1][1].onSuccess());

      expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
      expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
      expect(getItemSpy).toHaveBeenCalled();
      expect(setItemSpy).toHaveBeenCalled();
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });

  it('toont een nieuwe synchronisatiewaarschuwing wanneer ook de eerste herkansing faalt', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));

    const routeStorageKey = 'byb:master-data-route:v1:participant:test-user';
    const firstRequestCallbacks = updateProfilePreferencesMutate.mock.calls[0][1];
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem(routeStorageKey)).toBe('excel');

    act(() => firstRequestCallbacks.onError());
    expect(screen.getByText(/kon niet worden gesynchroniseerd/i)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Synchronisatie opnieuw proberen' })).not.toBeNull();
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem(routeStorageKey)).toBe('excel');

    await user.click(screen.getByRole('button', { name: 'Synchronisatie opnieuw proberen' }));
    expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(2);
    expect(updateProfilePreferencesMutate.mock.calls[1][0]).toEqual({
      data: { masterDataRoute: 'excel' },
    });
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem(routeStorageKey)).toBe('excel');

    act(() => updateProfilePreferencesMutate.mock.calls[1][1].onError());
    expect(screen.getByText(/kon niet worden gesynchroniseerd/i)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Synchronisatie opnieuw proberen' })).not.toBeNull();
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem(routeStorageKey)).toBe('excel');

    await user.click(screen.getByRole('button', { name: 'Synchronisatie opnieuw proberen' }));
    expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(3);
    expect(updateProfilePreferencesMutate.mock.calls[2][0]).toEqual({
      data: { masterDataRoute: 'excel' },
    });
    act(() => updateProfilePreferencesMutate.mock.calls[2][1].onSuccess());

    expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem(routeStorageKey)).toBe('excel');
  });

  it('negeert late callbacks van een mislukte route-opslag na een geslaagde herkansing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));

    const firstRequestCallbacks = updateProfilePreferencesMutate.mock.calls[0][1];
    act(() => firstRequestCallbacks.onError());
    expect(screen.getByText(/kon niet worden gesynchroniseerd/i)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Synchronisatie opnieuw proberen' }));
    expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(2);

    act(() => updateProfilePreferencesMutate.mock.calls[1][1].onSuccess());
    expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('excel');

    act(() => {
      firstRequestCallbacks.onError();
      firstRequestCallbacks.onSuccess();
    });

    expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-excel')).not.toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('excel');
  });

  it('negeert een late synchronisatiefout van een oudere routekeuze', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));
    await user.click(screen.getByTestId('choose-master-data-manual'));

    expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(2);
    expect(updateProfilePreferencesMutate.mock.calls[0][0]).toEqual({
      data: { masterDataRoute: 'excel' },
    });
    expect(updateProfilePreferencesMutate.mock.calls[1][0]).toEqual({
      data: { masterDataRoute: 'manual' },
    });

    act(() => updateProfilePreferencesMutate.mock.calls[1][1].onSuccess());
    act(() => updateProfilePreferencesMutate.mock.calls[0][1].onError());

    expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
    expect(screen.getByTestId('choose-master-data-manual').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-manual')).not.toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('manual');
  });

  it('laat een late synchronisatiesuccess van een oudere routekeuze de nieuwste fout niet wissen', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));
    await user.click(screen.getByTestId('choose-master-data-manual'));

    expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(2);
    expect(updateProfilePreferencesMutate.mock.calls[0][0]).toEqual({
      data: { masterDataRoute: 'excel' },
    });
    expect(updateProfilePreferencesMutate.mock.calls[1][0]).toEqual({
      data: { masterDataRoute: 'manual' },
    });

    act(() => updateProfilePreferencesMutate.mock.calls[1][1].onError());
    expect(screen.getByText(/kon niet worden gesynchroniseerd/i)).not.toBeNull();

    act(() => updateProfilePreferencesMutate.mock.calls[0][1].onSuccess());

    expect(screen.getByText(/kon niet worden gesynchroniseerd/i)).not.toBeNull();
    expect(screen.getByTestId('choose-master-data-manual').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-manual')).not.toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('manual');
  });

  it('negeert late route-callbacks nadat de financiële context naar een andere deelnemer wisselt', async () => {
    const user = userEvent.setup();
    const rendered = renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));

    const participantACallbacks = updateProfilePreferencesMutate.mock.calls[0][1];
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('excel');

    localStorage.setItem('byb:master-data-route:v1:participant:participant-b', 'manual');
    activeParticipantUserId = 'participant-b';
    rendered.rerender(
      <QueryClientProvider client={rendered.client}>
        <ParticipantPageTestShell />
        <Toaster />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));

    expect(screen.getByTestId('choose-master-data-manual').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-manual')).not.toBeNull();
    expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:participant-b')).toBe('manual');

    act(() => participantACallbacks.onError());
    act(() => participantACallbacks.onSuccess());

    expect(screen.queryByText(/kon niet worden gesynchroniseerd/i)).toBeNull();
    expect(screen.getByTestId('choose-master-data-manual').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-manual')).not.toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:participant-b')).toBe('manual');
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('excel');
  });

  it.each([
    {
      name: 'fout',
      finish: (request: (value: { masterDataRoute: 'manual' | 'excel' | null }) => void, reject: (reason?: unknown) => void) => {
        reject(new Error('Profielvoorkeur kon niet worden geladen.'));
      },
    },
    {
      name: 'succes',
      finish: (request: (value: { masterDataRoute: 'manual' | 'excel' | null }) => void) => {
        request({ masterDataRoute: 'excel' });
      },
    },
  ])('laat een late profielvoorkeur van deelnemer A de route van deelnemer B niet overschrijven bij $name', async ({ finish }) => {
    const user = userEvent.setup();
    deferProfilePreferenceResponses = true;
    const rendered = renderPage();

    // The first query belongs to participant A and remains unresolved while
    // the financial context moves to participant B.
    await waitFor(() => expect(deferredProfilePreferenceRequests).toHaveLength(1));
    expect(deferredProfilePreferenceRequests[0].participantUserId).toBe('test-user');

    localStorage.setItem('byb:master-data-route:v1:participant:participant-b', 'manual');
    activeParticipantUserId = 'participant-b';
    rendered.rerender(
      <QueryClientProvider client={rendered.client}>
        <ParticipantPageTestShell />
        <Toaster />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(deferredProfilePreferenceRequests).toHaveLength(2));
    expect(deferredProfilePreferenceRequests[1].participantUserId).toBe('participant-b');

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    expect(screen.getByTestId('choose-master-data-manual').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('byb:master-data-route:v1:participant:participant-b')).toBe('manual');

    await act(async () => {
      finish(deferredProfilePreferenceRequests[0].resolve, deferredProfilePreferenceRequests[0].reject);
    });

    expect(screen.getByTestId('choose-master-data-manual').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('participant-master-data-manual')).not.toBeNull();
    expect(localStorage.getItem('byb:master-data-route:v1:participant:participant-b')).toBe('manual');
  });

  it('laadt de servervoorkeur op een apparaat zonder lokale voorkeur', async () => {
    serverMasterDataRoute = 'excel';
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));

    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('byb:master-data-route:v1:participant:test-user')).toBe('excel');
    expect(updateProfilePreferencesMutate).not.toHaveBeenCalled();
  });

  it('migreert een bestaande lokale voorkeur wanneer de server nog geen voorkeur heeft', async () => {
    localStorage.setItem('byb:master-data-route:v1:participant:test-user', 'excel');
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));

    expect(screen.getByTestId('choose-master-data-excel').getAttribute('aria-pressed')).toBe('true');
    expect(updateProfilePreferencesMutate).toHaveBeenCalledTimes(1);
    expect(updateProfilePreferencesMutate.mock.calls[0][0]).toEqual({
      data: { masterDataRoute: 'excel' },
    });
  });

  it('neemt als beheerder de opgeslagen routevoorkeur van een deelnemer niet over', async () => {
    localStorage.setItem('byb:master-data-route:v1:participant:test-user', 'excel');
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(screen.getByTestId('tab-stamgegevens'));

    expect(screen.queryByTestId('participant-master-data-choice')).toBeNull();
    expect(screen.queryByTestId('participant-master-data-excel')).toBeNull();
    expect(screen.getByLabelText('Naam seizoen')).not.toBeNull();
    expect(updateProfilePreferencesMutate).not.toHaveBeenCalled();
  });

  it('toont deelnemers de actuele status van hun eigen aanlevering', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-season'), '2');
    await user.click(screen.getByTestId('tab-stamgegevens'));
    await user.click(screen.getByTestId('choose-master-data-excel'));

    expect(screen.getByText(/ingevulde-docenten\.xlsx/)).not.toBeNull();
    expect(screen.getByText('Status: In behandeling')).not.toBeNull();
  });

  it('opent vanuit Resultaten precies de gekozen opgeslagen maand en houdt die actief in de vergelijking', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('tab-results'));
    await user.click(screen.getByTestId('button-compare-month-2026-10'));

    expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-10');
    expect(screen.getAllByText(/€\s*2\.222,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€\s*1\.689,00/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('button-compare-month-2026-10').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('button-compare-month-2026-09').getAttribute('aria-pressed')).toBe('false');
  });

  it('waarschuwt bij maand-, seizoen- en zijbalknavigatie en ondersteunt blijven of verwerpen', async () => {
    const user = userEvent.setup();
    renderPage();
    await changeContribution(user, '1300');

    fireEvent.change(screen.getByTestId('input-month'), { target: { value: '2026-10' } });
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-09');

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect((screen.getByTestId('select-season') as HTMLSelectElement).value).toBe('2');

    await user.click(screen.getByTestId('btn-new-season'));
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect(screen.queryByRole('heading', { name: 'Nieuw seizoen inrichten' })).toBeNull();

    await user.click(screen.getByTestId('sidebar-dashboard'));
    expectDiscardDialog().toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('confirm-discard-financial-month'));
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('behoudt afgewezen maandinvoer bij geannuleerde maand-, seizoen- en weergavewissels en verlaat die alleen na bevestiging', async () => {
    const user = userEvent.setup();
    upsertMutate.mockImplementation((_variables, options) => {
      const response = new Response(JSON.stringify({ error: 'conflict' }), { status: 409, statusText: 'Conflict' });
      options.onError(new ApiError(response, { error: 'conflict' }, { method: 'PUT', url: '/financial/month' }));
    });
    renderPage();
    await changeContribution(user, '1300');

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Deze maand is intussen gewijzigd' })).not.toBeNull();

    fireEvent.change(screen.getByTestId('input-month'), { target: { value: '2026-10' } });
    expect(screen.getByRole('dialog', { name: 'Conflictherstel verlaten?' })).not.toBeNull();
    expect(screen.getByText(/afgewezen maandinvoer is tijdelijk bewaard/i)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Conflictherstel behouden' }));
    expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-09');
    expect(screen.getByRole('dialog', { name: 'Deze maand is intussen gewijzigd' })).not.toBeNull();

    fireEvent.change(screen.getByTestId('select-season'), { target: { value: '1' } });
    expect(screen.getByRole('dialog', { name: 'Conflictherstel verlaten?' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Conflictherstel behouden' }));
    expect((screen.getByTestId('select-season') as HTMLSelectElement).value).toBe('2');
    expect(screen.getByRole('dialog', { name: 'Deze maand is intussen gewijzigd' })).not.toBeNull();

    fireEvent.click(screen.getByTestId('tab-results'));
    expect(screen.getByRole('dialog', { name: 'Conflictherstel verlaten?' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Invoer verlaten en doorgaan' }));

    expect(screen.getByTestId('tab-results').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('dialog', { name: 'Deze maand is intussen gewijzigd' })).toBeNull();
  });

  it('bewaart belastinginvoer tussen tabs en bewaakt maand-, seizoen-, zijbalk- en browsernavigatie tot opslaan of verwerpen', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('tab-results'));

    const payment = await screen.findByLabelText(/Reeds betaalde voorlopige inkomstenbelasting/);
    await user.clear(payment);
    await user.type(payment, '275');
    expect(screen.getByRole('status', { name: 'Opslagstatus belastinginvoer' }).textContent).toBe('Niet opgeslagen');

    await user.click(screen.getByTestId('tab-costs'));
    await user.click(screen.getByTestId('tab-results'));
    expect(screen.getByText('Niet opgeslagen')).toBeTruthy();

    fireEvent.change(screen.getByTestId('input-month'), { target: { value: '2026-10' } });
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);

    const blockedUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(blockedUnload)).toBe(false);

    await user.click(screen.getByTestId('sidebar-dashboard'));
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);

    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));
    act(() => updateTaxYearMutate.mock.calls[0][1].onSuccess({
      ...taxYearSummary,
      preliminaryPayments: 275,
      updatedAt: '2026-09-15T10:00:00.000Z',
    }));

    await waitFor(() => expect(screen.getByRole('status', { name: 'Opslagstatus belastinginvoer' }).textContent).toBe('Opgeslagen'));
    expect(screen.queryByText('Niet opgeslagen')).toBeNull();
    await user.click(screen.getByTestId('sidebar-dashboard'));
    expect(screen.queryByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith('/dashboard');
  });

  it('bewaakt Nieuw seizoen en voert die keuze pas na bewust verwerpen uit', async () => {
    const user = userEvent.setup();
    renderPage();
    await changeContribution(user, '1300');

    await user.click(screen.getByTestId('btn-new-season'));
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect((screen.getByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('1300');

    await user.click(screen.getByTestId('btn-new-season'));
    await user.click(screen.getByTestId('confirm-discard-financial-month'));

    expect(screen.getByRole('heading', { name: 'Nieuw seizoen inrichten' })).toBeTruthy();
    expect(screen.getByTestId('season-template-notice')).toBeTruthy();
  });

  it('bewaakt maandkeuze vanuit Resultaten en voert die pas na bewust verwerpen uit', async () => {
    const user = userEvent.setup();
    renderPage();
    await changeContribution(user, '1300');
    await user.click(screen.getByTestId('tab-results'));

    await user.click(screen.getByTestId('button-compare-month-2026-10'));
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-09');

    await user.click(screen.getByTestId('button-compare-month-2026-10'));
    await user.click(screen.getByTestId('confirm-discard-financial-month'));

    expect((screen.getByTestId('input-month') as HTMLInputElement).value).toBe('2026-10');
  });

  it('waarschuwt bij browser-terug, bewaart nieuwere invoer tijdens opslaan en laat navigatie na opslaan vrij', async () => {
    const user = userEvent.setup();
    renderPage();
    await changeContribution(user, '1300');

    const blockedUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(blockedUnload)).toBe(false);
    expect(blockedUnload.defaultPrevented).toBe(true);

    window.history.back();
    await waitFor(() => expectDiscardDialog().toBeTruthy());
    await stayEditing(user);

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    const firstSave = upsertMutate.mock.calls[0][1];

    await changeContribution(user, '1400');
    act(() => firstSave.onSuccess(monthDetail));

    await user.click(screen.getByTestId('sidebar-dashboard'));
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    const secondSave = upsertMutate.mock.calls[1][1];
    act(() => secondSave.onSuccess(monthDetail));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeNull());
    const allowedUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(allowedUnload)).toBe(true);
    expect(allowedUnload.defaultPrevented).toBe(false);

    await user.click(screen.getByTestId('sidebar-dashboard'));
    expect(screen.queryByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith('/dashboard');
  });

  it('legt een tijdelijke opslagfout uit en blijft gewijzigde cijfers bewaken tot een latere opslag slaagt', async () => {
    const user = userEvent.setup();
    renderPage();
    await changeContribution(user, '1300');

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    act(() => upsertMutate.mock.calls[0][1].onError(new Error('server unavailable')));

    expect(await screen.findByText('Opslaan tijdelijk niet gelukt')).toBeTruthy();
    expect(screen.getByText('De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.')).toBeTruthy();
    expect((screen.getByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('1300');

    fireEvent.change(screen.getByTestId('input-month'), { target: { value: '2026-10' } });
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect(screen.getByText('Opslaan tijdelijk niet gelukt')).toBeTruthy();

    await user.selectOptions(screen.getByTestId('select-season'), '1');
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect(screen.getByText('Opslaan tijdelijk niet gelukt')).toBeTruthy();

    await user.click(screen.getByTestId('sidebar-dashboard'));
    expectDiscardDialog().toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    await stayEditing(user);
    expect(screen.getByText('Opslaan tijdelijk niet gelukt')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(upsertMutate).toHaveBeenCalledTimes(2);
    act(() => upsertMutate.mock.calls[1][1].onSuccess({
      ...monthDetail,
      updatedAt: '2026-09-10T12:05:00.000Z',
      contributionRevenue: 1300,
    }));

    await user.click(screen.getByTestId('sidebar-dashboard'));
    expect(screen.queryByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith('/dashboard');
  });

  it('toont veilige validatie-uitleg en bewaart de afgewezen maandinvoer en navigatiebewaking', async () => {
    const user = userEvent.setup();
    renderPage();
    await changeContribution(user, '1300');

    await user.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    const { ApiError } = await import('@workspace/api-client-react');
    act(() => upsertMutate.mock.calls[0][1].onError(
      new ApiError(
        new Response(null, { status: 400 }),
        { error: 'Een lesinvoer hoort niet bij dit seizoen.', debug: 'internal detail' },
        { method: 'PUT', url: '/api/financial/seasons/2/months/2026-09-01' },
      ),
    ));

    expect(await screen.findByText('Controleer de maandinvoer')).toBeTruthy();
    expect(screen.getByText('Een lesinvoer hoort niet bij dit seizoen.')).toBeTruthy();
    expect(screen.queryByText('internal detail')).toBeNull();
    expect((screen.getByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('1300');

    fireEvent.change(screen.getByTestId('input-month'), { target: { value: '2026-10' } });
    expectDiscardDialog().toBeTruthy();
    await stayEditing(user);
    expect((screen.getByLabelText('Contributie-inkomsten (€ incl. btw)') as HTMLInputElement).value).toBe('1300');
  });

  it('legt tijdelijke fouten bij seizoenstamgegevens uit en behoudt de invoer', async () => {
    const user = userEvent.setup();
    renderAdminPage();
    await user.click(screen.getByTestId('tab-stamgegevens'));

    const name = screen.getByLabelText('Naam seizoen') as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'Mijn aangepaste seizoen');
    await user.click(screen.getByTestId('button-save-season-general'));
    act(() => updateSeasonMutate.mock.calls[0][1].onError(new Error('network unavailable')));

    expect(await screen.findByText('Opslaan tijdelijk niet gelukt')).toBeTruthy();
    expect(screen.getByText('De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.')).toBeTruthy();
    expect(name.value).toBe('Mijn aangepaste seizoen');
  });

  it('toont alleen bekende validatietekst bij seizoenstamgegevens en behoudt de invoer', async () => {
    const user = userEvent.setup();
    renderAdminPage();
    await user.click(screen.getByTestId('tab-stamgegevens'));

    const name = screen.getByLabelText('Naam seizoen') as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'Afgewezen seizoen');
    await user.click(screen.getByTestId('button-save-season-general'));
    const { ApiError } = await import('@workspace/api-client-react');
    act(() => updateSeasonMutate.mock.calls[0][1].onError(new ApiError(
      new Response(null, { status: 422 }),
      { error: 'De einddatum moet na de startdatum liggen.', debug: 'database detail' },
      { method: 'PUT', url: '/api/financial/seasons/2' },
    )));

    expect(await screen.findByText('Controleer de seizoenstamgegevens')).toBeTruthy();
    expect(screen.getByText('De einddatum moet na de startdatum liggen.')).toBeTruthy();
    expect(screen.queryByText('database detail')).toBeNull();
    expect(name.value).toBe('Afgewezen seizoen');
  });

  it('behoudt beheerinvoer bij fouten tijdens het aanmaken van een nieuw seizoen via de beheerhook', async () => {
    const user = userEvent.setup();
    renderAdminPage();
    await user.click(screen.getByTestId('btn-new-season'));

    const name = screen.getByLabelText('Naam seizoen') as HTMLInputElement;
    const startDate = screen.getByLabelText('Startdatum') as HTMLInputElement;
    const endDate = screen.getByLabelText('Einddatum') as HTMLInputElement;
    await user.type(name, 'Nieuw beheerseizoen');
    await user.type(startDate, '2027-09-01');
    await user.type(endDate, '2028-07-01');
    await user.click(screen.getByTestId('button-save-season-general'));

    expect(createSeasonMutate).toHaveBeenCalledTimes(1);
    expect(createSeasonMutate.mock.calls[0][0]).toMatchObject({
      participantId: 42,
      data: {
        name: 'Nieuw beheerseizoen',
        startDate: '2027-09-01',
        endDate: '2028-07-01',
      },
    });
    expect(updateSeasonMutate).not.toHaveBeenCalled();
    act(() => createSeasonMutate.mock.calls[0][1].onError(new Error('network unavailable')));

    expect(await screen.findByText('Opslaan tijdelijk niet gelukt')).toBeTruthy();
    expect(screen.getByText('De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.')).toBeTruthy();
    expect(name.value).toBe('Nieuw beheerseizoen');
    expect(startDate.value).toBe('2027-09-01');
    expect(endDate.value).toBe('2028-07-01');

    await user.click(screen.getByTestId('button-save-season-general'));
    const { ApiError } = await import('@workspace/api-client-react');
    act(() => createSeasonMutate.mock.calls[1][1].onError(new ApiError(
      new Response(null, { status: 422 }),
      { error: 'De einddatum moet na de startdatum liggen.', debug: 'database detail' },
      { method: 'POST', url: '/api/participants/42/financial/seasons' },
    )));

    expect(await screen.findByText('Controleer de seizoenstamgegevens')).toBeTruthy();
    expect(screen.getByText('De einddatum moet na de startdatum liggen.')).toBeTruthy();
    expect(screen.queryByText('database detail')).toBeNull();
    expect(name.value).toBe('Nieuw beheerseizoen');
    expect(startDate.value).toBe('2027-09-01');
    expect(endDate.value).toBe('2028-07-01');
    expect(createSeasonMutate).toHaveBeenCalledTimes(2);
  });

  it('onderscheidt tijdelijke en veilige validatiefouten bij belastingvooruitbetalingen en behoudt het bedrag', async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const payment = screen.getByLabelText(/Reeds betaalde voorlopige inkomstenbelasting/) as HTMLInputElement;
    await user.clear(payment);
    await user.type(payment, '275');
    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));
    act(() => updateTaxYearMutate.mock.calls[0][1].onError(new Error('server unavailable')));
    expect(await screen.findByText('Opslaan tijdelijk niet gelukt')).toBeTruthy();
    expect(payment.value).toBe('275');

    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));
    const { ApiError } = await import('@workspace/api-client-react');
    act(() => updateTaxYearMutate.mock.calls[1][1].onError(new ApiError(
      new Response(null, { status: 400 }),
      { error: 'Het vooruitbetaalde bedrag mag niet negatief zijn.', internal: 'stack trace' },
      { method: 'PUT', url: '/api/financial/tax-years/2026' },
    )));

    expect(await screen.findByText('Controleer de vooruitbetaling')).toBeTruthy();
    expect(screen.getByText('Het vooruitbetaalde bedrag mag niet negatief zijn.')).toBeTruthy();
    expect(screen.queryByText('stack trace')).toBeNull();
    expect(payment.value).toBe('275');

    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));
    act(() => updateTaxYearMutate.mock.calls[2][1].onError(new ApiError(
      new Response(null, { status: 409 }),
      { error: 'Het belastingjaar is intussen gewijzigd.' },
      { method: 'PUT', url: '/api/financial/tax-years/2026' },
    )));

    expect(await screen.findByText('Bedrag intussen gewijzigd')).toBeTruthy();
    expect(payment.value).toBe('275');
  });

  it('behoudt nieuwere belastinginvoer wanneer een ouder opslagverzoek slaagt', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('tab-results'));

    const payment = screen.getByLabelText(/Reeds betaalde voorlopige inkomstenbelasting/) as HTMLInputElement;
    await user.clear(payment);
    await user.type(payment, '275');
    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));

    expect(updateTaxYearMutate.mock.calls[0][0].data.preliminaryPayments).toBe(275);

    await user.clear(payment);
    await user.type(payment, '325');
    act(() => updateTaxYearMutate.mock.calls[0][1].onSuccess({
      ...taxYearSummary,
      preliminaryPayments: 275,
      updatedAt: '2026-09-15T10:00:00.000Z',
    }));

    expect(payment.value).toBe('325');
    expect(screen.getByText('Niet opgeslagen')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));
    expect(updateTaxYearMutate.mock.calls[1][0].data.preliminaryPayments).toBe(325);
  });
});