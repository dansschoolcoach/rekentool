import assert from "node:assert/strict";
import test from "node:test";
import { calculateFinancialCostTrends } from "./financialCostTrends.ts";

test("cost trends exactly total stored category costs and omit empty categories", () => {
  const trends = calculateFinancialCostTrends([
    {
      month: "2026-01-01",
      fixedCosts: [
        { group: "Marketing", amount: 100.25 },
        { group: "Marketing", amount: 49.75 },
        { group: "Bankkosten", amount: 20 },
        { group: "Leeg", amount: 0 },
      ],
    },
    {
      month: "2026-02-01",
      fixedCosts: [
        { group: "Marketing", amount: 225 },
        { group: "Bankkosten", amount: 15 },
      ],
    },
    { month: "2026-03-01", fixedCosts: [] },
  ]);

  assert.deepEqual(trends, [
    {
      category: "Bankkosten",
      total: 35,
      change: -20,
      changePercentage: -100,
      monthlyAmounts: [
        { month: "2026-01-01", amount: 20 },
        { month: "2026-02-01", amount: 15 },
        { month: "2026-03-01", amount: 0 },
      ],
    },
    {
      category: "Marketing",
      total: 375,
      change: -150,
      changePercentage: -100,
      monthlyAmounts: [
        { month: "2026-01-01", amount: 150 },
        { month: "2026-02-01", amount: 225 },
        { month: "2026-03-01", amount: 0 },
      ],
    },
  ]);
});

test("cost trends mark categories that appear or disappear during the season", () => {
  const trends = calculateFinancialCostTrends([
    {
      month: "2026-01-01",
      fixedCosts: [{ group: "Gestopt", amount: 80 }],
    },
    { month: "2026-02-01", fixedCosts: [] },
    {
      month: "2026-03-01",
      fixedCosts: [{ group: "Nieuw", amount: 120 }],
    },
  ]);

  assert.deepEqual(trends.map(trend => ({
    category: trend.category,
    change: trend.change,
    changePercentage: trend.changePercentage,
  })), [
    { category: "Nieuw", change: 120, changePercentage: null },
    { category: "Gestopt", change: -80, changePercentage: -100 },
  ]);
});