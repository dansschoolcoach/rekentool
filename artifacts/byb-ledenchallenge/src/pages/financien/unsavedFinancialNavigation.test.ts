import assert from 'node:assert/strict';
import test from 'node:test';
import { getBlockedInternalNavigationTarget } from './unsavedFinancialNavigation.ts';

test('blokkeert interne navigatie als financiële invoer niet is opgeslagen', () => {
  assert.equal(
    getBlockedInternalNavigationTarget('/dashboard', 'https://app.example/financien', true),
    '/dashboard',
  );
});

test('laat interne navigatie direct doorgaan na opslaan', () => {
  assert.equal(
    getBlockedInternalNavigationTarget('/dashboard', 'https://app.example/financien', false),
    null,
  );
});

test('blokkeert de huidige pagina en externe links niet', () => {
  assert.equal(
    getBlockedInternalNavigationTarget('/financien', 'https://app.example/financien', true),
    null,
  );
  assert.equal(
    getBlockedInternalNavigationTarget('https://help.example', 'https://app.example/financien', true),
    null,
  );
});