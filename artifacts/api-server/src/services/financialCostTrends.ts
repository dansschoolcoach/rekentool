export type FinancialCostTrendMonth = {
  month: string;
  fixedCosts: Array<{ group: string; amount: number }>;
};

export function calculateFinancialCostTrends(months: FinancialCostTrendMonth[]) {
  const categoryTotals = new Map<string, Map<string, number>>();
  for (const month of months) {
    for (const cost of month.fixedCosts) {
      const monthlyAmounts = categoryTotals.get(cost.group) ?? new Map<string, number>();
      monthlyAmounts.set(month.month, (monthlyAmounts.get(month.month) ?? 0) + cost.amount);
      categoryTotals.set(cost.group, monthlyAmounts);
    }
  }

  return [...categoryTotals.entries()].map(([category, amounts]) => {
    const monthlyAmounts = months.map(month => ({ month: month.month, amount: amounts.get(month.month) ?? 0 }));
    const first = monthlyAmounts[0]?.amount ?? 0;
    const last = monthlyAmounts.at(-1)?.amount ?? 0;
    const change = last - first;
    return {
      category,
      total: monthlyAmounts.reduce((sum, item) => sum + item.amount, 0),
      change,
      changePercentage: first === 0 ? null : change / first * 100,
      monthlyAmounts,
    };
  }).filter(trend => trend.total !== 0)
    .sort((a, b) => b.change - a.change || b.total - a.total || a.category.localeCompare(b.category, "nl"));
}