import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminFinancienPage } from './AdminFinancienPage';

const september = {
  month: '2026-09-01',
  isSaved: true,
  updatedAt: '2026-09-02T10:00:00.000Z',
  contributionRevenue: 1111,
  taxArrears: 0,
  salaryOverride: null,
  revenue: 1111,
  costs: 222,
  grossProfit: 889,
  taxReserve: 100,
  netProfit: 789,
  salary: 500,
  fixedCosts: [],
  previousMonth: null,
  previousMonthFixedCosts: [],
  activities: [],
  lessonInputs: [],
  lessonProfitability: [],
  bankBalance: 289,
  cumulative: null,
};

const october = {
  ...september,
  month: '2026-10-01',
  revenue: 2222,
  costs: 333,
  grossProfit: 1889,
  netProfit: 1689,
};

const january = {
  ...september,
  month: '2027-01-01',
  revenue: 3333,
  costs: 444,
  grossProfit: 2889,
  netProfit: 2689,
};

const february = {
  ...september,
  month: '2027-02-01',
  revenue: 4444,
  costs: 555,
  grossProfit: 3889,
  netProfit: 3689,
};

const updateAdminTaxYearMutate = vi.fn();
const adminSidebarNavigate = vi.fn();

vi.mock('wouter', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useParams: () => ({ id: '7' }),
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetAdminFinancialSeasonsQueryKey: (participantId: number) => ['admin-financial-seasons', participantId],
  getGetAdminFinancialSeasonQueryKey: (participantId: number, seasonId: number) => ['admin-financial-season', participantId, seasonId],
  getGetAdminFinancialMonthQueryKey: (participantId: number, seasonId: number, month: string) => ['admin-financial-month', participantId, seasonId, month],
  getGetAdminFinancialTaxYearQueryKey: (participantId: number, year: number) => ['admin-financial-tax-year', participantId, year],
  useGetParticipants: () => ({ data: [{ id: 7, schoolName: 'Dansschool Test' }] }),
  useGetAdminFinancialSeasons: () => ({
    isLoading: false,
    data: [
      { id: 4, name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-01' },
      { id: 5, name: 'Winter 2027', startDate: '2027-01-01', endDate: '2027-02-28' },
      { id: 3, name: 'Leeg seizoen', startDate: '2025-09-01', endDate: '2026-07-01' },
    ],
  }),
  useGetAdminFinancialSeason: (_participantId: number, seasonId: number) => ({
    isLoading: false,
    data: {
      id: seasonId,
      name: seasonId === 5 ? 'Winter 2027' : seasonId === 3 ? 'Leeg seizoen' : '2026/2027',
      startDate: seasonId === 5 ? '2027-01-01' : seasonId === 3 ? '2025-09-01' : '2026-09-01',
      endDate: seasonId === 5 ? '2027-02-28' : seasonId === 3 ? '2026-07-01' : '2027-07-01',
      country: 'Nederland',
      hasStarterDeduction: false,
      defaultSalary: 0,
      updatedAt: '2026-09-01T12:00:00.000Z',
      teachers: [],
      locations: [],
      subscriptions: [],
      months: seasonId === 5 ? [january, february] : seasonId === 3 ? [] : [september, october],
      lessons: [],
      closures: [],
      costTrends: [],
      lessonSeasonForecast: { months: [], lessons: [], locationRentBreakdowns: [] },
    },
  }),
  useGetAdminFinancialMonth: (_participantId: number, seasonId: number, month: string) => ({
    isLoading: false,
    isError: false,
    data: (seasonId === 5 ? [january, february] : seasonId === 3 ? [] : [september, october]).find(item => item.month === month),
    refetch: vi.fn(),
  }),
  useGetAdminFinancialTaxYear: (_participantId: number, year: number) => ({
    isLoading: false,
    isError: false,
    data: {
      calendarYear: year,
      calculationVersion: '2026',
      country: 'Nederland',
      hasCountryConflict: false,
      grossProfit: 0,
      estimatedTax: 0,
      effectiveReservePercentage: 0,
      preliminaryPayments: 0,
      extraToSave: 0,
      coveredMonths: [],
      missingMonths: [],
      isComplete: true,
      updatedAt: null,
    },
  }),
  useCreateAdminFinancialSeason: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateAdminFinancialSeason: () => ({ isPending: false, mutate: vi.fn() }),
  useUpsertAdminFinancialMonth: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateAdminFinancialTaxYear: () => ({ isPending: false, mutate: updateAdminTaxYearMutate }),
}));

vi.mock('./CostCategoryTrends', () => ({
  CostCategoryTrends: () => null,
}));

vi.mock('./LessonSeasonForecast', () => ({
  LessonSeasonForecast: () => null,
}));

afterEach(() => {
  cleanup();
  updateAdminTaxYearMutate.mockReset();
  adminSidebarNavigate.mockReset();
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <a href="/beheer/financien" data-testid="admin-sidebar" onClick={(event) => {
        event.preventDefault();
        adminSidebarNavigate();
      }}>
        Beheer
      </a>
      <AdminFinancienPage />
    </QueryClientProvider>,
  );
}

describe('maandkeuze in het financiële beheerscherm', () => {
  it('behoudt nieuwere belastinginvoer wanneer een ouder beheerdersverzoek slaagt', async () => {
    const user = userEvent.setup();
    renderPage();

    const payment = await screen.findByLabelText(/Reeds betaalde voorlopige inkomstenbelasting/);
    await user.clear(payment);
    await user.type(payment, '275');
    const saveStatus = screen.getByRole('status', { name: 'Opslagstatus belastinginvoer' });
    expect(saveStatus.textContent).toBe('Niet opgeslagen');
    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));

    expect(updateAdminTaxYearMutate.mock.calls[0][0].data.preliminaryPayments).toBe(275);

    await user.clear(payment);
    await user.type(payment, '325');
    expect(screen.getByRole('status', { name: 'Opslagstatus belastinginvoer' })).toBe(saveStatus);
    expect(saveStatus.textContent).toBe('Niet opgeslagen');
    act(() => updateAdminTaxYearMutate.mock.calls[0][1].onSuccess({
      calendarYear: 2027,
      calculationVersion: '2026',
      country: 'Nederland',
      hasCountryConflict: false,
      grossProfit: 0,
      estimatedTax: 0,
      effectiveReservePercentage: 0,
      preliminaryPayments: 275,
      extraToSave: 0,
      coveredMonths: [],
      missingMonths: [],
      isComplete: true,
      updatedAt: '2026-09-15T10:00:00.000Z',
    }));

    expect((payment as HTMLInputElement).value).toBe('325');
    expect(screen.getByText('Niet opgeslagen')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Vooruitbetaling opslaan' }));
    expect(updateAdminTaxYearMutate.mock.calls[1][0].data.preliminaryPayments).toBe(325);
  });

  it('bewaakt belastinginvoer van beheerders bij maand-, seizoen-, zijbalk- en browsernavigatie tot bewust verwerpen', async () => {
    const user = userEvent.setup();
    renderPage();

    const payment = await screen.findByLabelText(/Reeds betaalde voorlopige inkomstenbelasting/);
    await user.clear(payment);
    await user.type(payment, '275');

    await waitFor(() => {
      const blockedUnload = new Event('beforeunload', { cancelable: true });
      expect(window.dispatchEvent(blockedUnload)).toBe(false);
    });

    const monthInput = screen.getByTestId('input-month') as HTMLInputElement;
    const nextMonth = monthInput.value === '2027-01' ? '2027-02' : '2027-01';
    fireEvent.change(monthInput, { target: { value: nextMonth } });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Blijven bewerken' }));

    await user.selectOptions(screen.getByTestId('select-season'), '4');
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Blijven bewerken' }));

    await user.click(screen.getByTestId('admin-sidebar'));
    expect(screen.getByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeTruthy();
    expect(adminSidebarNavigate).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('confirm-discard-financial-month'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Niet-opgeslagen wijzigingen verwerpen?' })).toBeNull());
    expect(window.location.pathname).toBe('/beheer/financien');

    const allowedUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(allowedUnload)).toBe(true);
  });

  it('toont beheerders direct de stamgegevens zonder deelnemerskeuze', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('tab-stamgegevens'));

    expect(screen.queryByTestId('participant-master-data-choice')).toBeNull();
    expect(screen.queryByTestId('choose-master-data-excel')).toBeNull();
    expect(screen.getByLabelText('Naam seizoen')).not.toBeNull();
  });

  it('opent precies de gekozen opgeslagen maand en houdt die actief in de vergelijking', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('button-compare-month-2027-02');
    await user.selectOptions(screen.getByRole('combobox'), '4');

    const septemberButton = await screen.findByTestId('button-compare-month-2026-09');
    await user.click(septemberButton);

    expect(screen.getByText(/€\s*1\.111,00/)).not.toBeNull();
    expect(screen.getByText(/€\s*789,00/)).not.toBeNull();
    expect(septemberButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('button-compare-month-2026-10').getAttribute('aria-pressed')).toBe('false');
  });

  it('kiest na een seizoenwissel een opgeslagen maand uit het nieuwe seizoen', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('button-compare-month-2027-02');
    await user.selectOptions(screen.getByRole('combobox'), '4');

    expect(await screen.findByText(/€\s*2\.222,00/)).not.toBeNull();
    expect(screen.getByTestId('button-compare-month-2026-10').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('button-compare-month-2027-02')).toBeNull();
  });

  it('wist de oude maand na een wissel naar een seizoen zonder opgeslagen maanden', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-compare-month-2027-02'));
    expect(await screen.findByText(/€\s*4\.444,00/)).not.toBeNull();
    await user.selectOptions(screen.getByRole('combobox'), '3');

    expect(await screen.findByTestId('empty-financial-season')).not.toBeNull();
    expect(screen.getByTestId('input-month').getAttribute('value')).toBe('');
    expect(screen.queryByTestId('button-compare-month-2027-02')).toBeNull();
    expect(screen.queryByText(/€\s*4\.444,00/)).toBeNull();
    expect(screen.queryByText(/€\s*3\.689,00/)).toBeNull();
  });
});