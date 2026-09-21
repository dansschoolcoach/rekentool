import type { FinancialMonthDetail } from '@workspace/api-client-react';

const METRICS = [
  { key: 'revenue', label: 'Inkomsten' },
  { key: 'costs', label: 'Kosten' },
  { key: 'grossProfit', label: 'Bruto winst' },
  { key: 'taxReserve', label: 'Belastingreservering' },
  { key: 'netProfit', label: 'Netto winst' },
  { key: 'salary', label: 'Salaris' },
] as const;

function fmtEuro(amount: number) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function DifferenceIndicator({
  difference,
  testId,
}: {
  difference: number;
  testId: string;
}) {
  if (difference === 0) {
    return (
      <span
        data-testid={testId}
        className="mt-0.5 block text-[10px] font-medium leading-none text-muted-foreground"
      >
        — gelijk
      </span>
    );
  }

  const increased = difference > 0;

  return (
    <span
      data-testid={testId}
      className={`mt-0.5 block text-[10px] font-semibold leading-none ${
        increased ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'
      }`}
      aria-label={`${increased ? 'Stijging' : 'Daling'} van ${fmtEuro(Math.abs(difference))} ten opzichte van de vorige maand`}
    >
      <span aria-hidden="true">{increased ? '▲ +' : '▼ −'}</span>
      {fmtEuro(Math.abs(difference))}
    </span>
  );
}

function monthLabel(month: string) {
  return new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('nl-NL', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export function MonthResultsComparison({
  months,
  selectedMonth,
  onSelectMonth,
}: {
  months: FinancialMonthDetail[];
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
}) {
  if (months.length === 0) return null;

  const sortedMonths = [...months].sort((a, b) => a.month.localeCompare(b.month));

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="p-5 sm:p-6">
        <h3 className="serif text-2xl text-primary">Maandresultaten vergelijken</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Selecteer een opgeslagen maand om het volledige resultaat te bekijken.
        </p>
      </div>

      <div className="overflow-x-auto border-t border-border/60">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 min-w-36 border-b border-r border-border/60 bg-card px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:min-w-48 sm:px-6">
                Resultaat
              </th>
              {sortedMonths.map(item => {
                const selected = selectedMonth?.slice(0, 7) === item.month.slice(0, 7);
                return (
                  <th
                    key={item.month}
                    className={`min-w-32 border-b border-border/60 px-2 py-2 text-center ${selected ? 'bg-accent/10' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectMonth(item.month)}
                      data-testid={`button-compare-month-${item.month.slice(0, 7)}`}
                      aria-pressed={selected}
                      className={`min-h-10 w-full rounded-lg px-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                        selected
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-secondary/40 hover:text-primary'
                      }`}
                    >
                      {monthLabel(item.month)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric, index) => (
              <tr key={metric.key}>
                <th className={`sticky left-0 z-10 border-r border-border/60 bg-card px-4 py-3 text-left text-xs font-semibold text-primary sm:px-6 ${index < METRICS.length - 1 ? 'border-b' : ''}`}>
                  {metric.label}
                </th>
                {sortedMonths.map((item, monthIndex) => {
                  const selected = selectedMonth?.slice(0, 7) === item.month.slice(0, 7);
                  const previousMonth = sortedMonths[monthIndex - 1];
                  const difference = previousMonth
                    ? item[metric.key] - previousMonth[metric.key]
                    : null;
                  return (
                    <td
                      key={item.month}
                      data-testid={`value-compare-${metric.key}-${item.month.slice(0, 7)}`}
                      className={`px-4 py-3 text-right tabular-nums ${index < METRICS.length - 1 ? 'border-b border-border/60' : ''} ${
                        selected ? 'bg-accent/10 font-bold text-primary' : 'text-muted-foreground'
                      } ${metric.key === 'taxReserve' ? 'text-destructive' : ''}`}
                    >
                      <span
                        data-testid={`amount-compare-${metric.key}-${item.month.slice(0, 7)}`}
                        className="block whitespace-nowrap"
                      >
                        {fmtEuro(item[metric.key])}
                      </span>
                      {difference !== null && (
                        <DifferenceIndicator
                          difference={difference}
                          testId={`difference-compare-${metric.key}-${item.month.slice(0, 7)}`}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground sm:px-6">
        Veeg horizontaal om meer opgeslagen maanden te zien.
      </p>
    </section>
  );
}