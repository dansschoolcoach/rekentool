import { TrendingUp } from 'lucide-react';
import type { FinancialSeasonDetail } from '@workspace/api-client-react';

type CostTrend = FinancialSeasonDetail['costTrends'][number];

function fmtEuro(amount: number) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount);
}

function monthLabel(month: string) {
  return new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('nl-NL', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export function CostCategoryTrends({ trends }: { trends: CostTrend[] }) {
  if (trends.length === 0) return null;

  const risingCount = trends.filter(trend => trend.change > 0).length;

  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="serif text-2xl text-primary">Kosten door het seizoen</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Maandtotaal per categorie, rechtstreeks uit de opgeslagen kosten.
          </p>
        </div>
        {risingCount > 0 && (
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <TrendingUp className="size-4" />
            {risingCount} {risingCount === 1 ? 'categorie stijgt' : 'categorieën stijgen'}
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="pb-3 pr-6 font-semibold">Categorie</th>
              {trends[0].monthlyAmounts.map(item => (
                <th key={item.month} className="px-3 pb-3 text-right font-semibold">{monthLabel(item.month)}</th>
              ))}
              <th className="px-3 pb-3 text-right font-semibold">Totaal</th>
              <th className="pb-3 pl-3 text-right font-semibold">Verloop</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {trends.map(trend => (
              <tr key={trend.category} className={trend.change > 0 ? 'bg-destructive/[0.035]' : undefined}>
                <td className="py-3 pr-6 font-medium text-primary">{trend.category}</td>
                {trend.monthlyAmounts.map(item => (
                  <td key={item.month} className="px-3 py-3 text-right text-muted-foreground">
                    {item.amount === 0 ? '—' : fmtEuro(item.amount)}
                  </td>
                ))}
                <td className="px-3 py-3 text-right font-semibold text-primary">{fmtEuro(trend.total)}</td>
                <td className={`py-3 pl-3 text-right font-semibold ${trend.change > 0 ? 'text-destructive' : trend.change < 0 ? 'text-[#557b5b]' : 'text-muted-foreground'}`}>
                  {trend.change > 0 ? '+' : ''}{fmtEuro(trend.change)}
                  {trend.changePercentage != null ? (
                    <span className="ml-1 text-[10px] font-normal">({trend.changePercentage > 0 ? '+' : ''}{trend.changePercentage.toFixed(0)}%)</span>
                  ) : trend.change > 0 ? (
                    <span className="ml-1 text-[10px] font-normal">(nieuw)</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Verloop vergelijkt de eerste en laatste opgeslagen maand van het seizoen. Een ontbrekende categorie telt als €0.</p>
    </section>
  );
}