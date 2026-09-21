import type { FinancialMonthDetail } from '@workspace/api-client-react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthResultsComparison } from './MonthResultsComparison';

function financialMonth(
  month: string,
  values: Pick<
    FinancialMonthDetail,
    'revenue' | 'costs' | 'grossProfit' | 'taxReserve' | 'netProfit' | 'salary'
  >,
): FinancialMonthDetail {
  return {
    month,
    isSaved: true,
    updatedAt: '2026-10-10T12:00:00.000Z',
    contributionRevenue: 0,
    taxArrears: 0,
    salaryOverride: null,
    bankBalance: 0,
    fixedCosts: [],
    previousMonth: null,
    previousMonthFixedCosts: [],
    activities: [],
    lessonInputs: [],
    lessonProfitability: [],
    cumulative: {} as FinancialMonthDetail['cumulative'],
    ...values,
  };
}

afterEach(cleanup);

describe('MonthResultsComparison', () => {
  it('toont maanden chronologisch met de juiste bedragen en activeert de aangeklikte maand', async () => {
    const onSelectMonth = vi.fn();
    const user = userEvent.setup();
    const september = financialMonth('2026-09-01', {
      revenue: 1111,
      costs: 222,
      grossProfit: 889,
      taxReserve: 333,
      netProfit: 556,
      salary: 444,
    });
    const october = financialMonth('2026-10-01', {
      revenue: 2111,
      costs: 122,
      grossProfit: 1989,
      taxReserve: 333,
      netProfit: 1056,
      salary: 844,
    });

    render(
      <MonthResultsComparison
        months={[october, september]}
        selectedMonth={september.month}
        onSelectMonth={onSelectMonth}
      />,
    );

    const monthButtons = screen.getAllByTestId(/^button-compare-month-/);
    expect(monthButtons.map(button => button.dataset.testid)).toEqual([
      'button-compare-month-2026-09',
      'button-compare-month-2026-10',
    ]);

    const expectedValues = {
      revenue: ['€ 1.111', '€ 2.111'],
      costs: ['€ 222', '€ 122'],
      grossProfit: ['€ 889', '€ 1.989'],
      taxReserve: ['€ 333', '€ 333'],
      netProfit: ['€ 556', '€ 1.056'],
      salary: ['€ 444', '€ 844'],
    };

    for (const [metric, amounts] of Object.entries(expectedValues)) {
      expect(screen.getByTestId(`amount-compare-${metric}-2026-09`).textContent).toBe(amounts[0]);
      expect(screen.getByTestId(`amount-compare-${metric}-2026-10`).textContent).toBe(amounts[1]);
      expect(screen.queryByTestId(`difference-compare-${metric}-2026-09`)).toBeNull();
    }

    const revenueDifference = screen.getByTestId('difference-compare-revenue-2026-10');
    expect(revenueDifference.textContent).toBe('▲ +€ 1.000');
    expect(revenueDifference.getAttribute('aria-label')).toBe(
      'Stijging van € 1.000 ten opzichte van de vorige maand',
    );
    const costsDifference = screen.getByTestId('difference-compare-costs-2026-10');
    expect(costsDifference.textContent).toBe('▼ −€ 100');
    expect(costsDifference.getAttribute('aria-label')).toBe(
      'Daling van € 100 ten opzichte van de vorige maand',
    );
    expect(screen.getByTestId('difference-compare-taxReserve-2026-10').textContent).toBe('— gelijk');

    const septemberButton = screen.getByTestId('button-compare-month-2026-09');
    const octoberButton = screen.getByTestId('button-compare-month-2026-10');
    expect(septemberButton.getAttribute('aria-pressed')).toBe('true');
    expect(septemberButton.classList.contains('bg-primary')).toBe(true);
    expect(septemberButton.classList.contains('text-primary-foreground')).toBe(true);
    const selectedValue = screen.getByTestId('value-compare-netProfit-2026-09');
    expect(selectedValue.classList.contains('bg-accent/10')).toBe(true);
    expect(selectedValue.classList.contains('font-bold')).toBe(true);
    expect(selectedValue.classList.contains('text-primary')).toBe(true);
    expect(octoberButton.getAttribute('aria-pressed')).toBe('false');
    expect(octoberButton.classList.contains('bg-primary')).toBe(false);

    await user.click(octoberButton);

    expect(onSelectMonth).toHaveBeenCalledOnce();
    expect(onSelectMonth).toHaveBeenCalledWith(october.month);
  });
});