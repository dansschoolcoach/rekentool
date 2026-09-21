const BASE_KEY = '__financialUnsavedBase';
const TOP_KEY = '__financialUnsavedTop';

export const FINANCIAL_HISTORY_EXIT_DELTA = -2;

export function financialHistoryGuardStates(
  state: unknown,
  guardId: string,
): { base: Record<string, unknown>; top: Record<string, unknown> } {
  const existing = state && typeof state === 'object' ? state as Record<string, unknown> : {};
  return {
    base: { ...existing, [BASE_KEY]: guardId },
    top: { ...existing, [TOP_KEY]: guardId },
  };
}

export function isFinancialHistoryGuardBase(state: unknown, guardId: string): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[BASE_KEY] === guardId;
}

export function isFinancialHistoryGuardTop(state: unknown, guardId: string): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[TOP_KEY] === guardId;
}