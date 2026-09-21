import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINANCIAL_HISTORY_EXIT_DELTA,
  financialHistoryGuardStates,
  isFinancialHistoryGuardBase,
  isFinancialHistoryGuardTop,
} from './financialHistoryGuard.ts';

test('herkent browser-terug vanaf de beschermde financiële pagina', () => {
  const states = financialHistoryGuardStates({ existing: 'state' }, 'guard-1');
  assert.equal(isFinancialHistoryGuardBase(states.base, 'guard-1'), true);
  assert.equal(isFinancialHistoryGuardTop(states.top, 'guard-1'), true);
  assert.equal(states.base.existing, 'state');
});

test('gaat na bevestigen voorbij beide bewakingsitems in de geschiedenis', () => {
  assert.equal(FINANCIAL_HISTORY_EXIT_DELTA, -2);
});