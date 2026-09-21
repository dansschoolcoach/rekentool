import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFinancialNumberDraft } from './normalizeFinancialNumberDraft.ts';

test('removes leading zeroes from pasted and typed whole numbers', () => {
  assert.equal(normalizeFinancialNumberDraft('01500'), '1500');
  assert.equal(normalizeFinancialNumberDraft('00015'), '15');
});

test('keeps a deliberate zero and decimal values intact', () => {
  assert.equal(normalizeFinancialNumberDraft('0'), '0');
  assert.equal(normalizeFinancialNumberDraft('0.5'), '0.5');
  assert.equal(normalizeFinancialNumberDraft('00.5'), '0.5');
});

test('accepts a Dutch decimal comma without browser number-field side effects', () => {
  assert.equal(normalizeFinancialNumberDraft('80'), '80');
  assert.equal(normalizeFinancialNumberDraft('80,02'), '80.02');
  assert.equal(normalizeFinancialNumberDraft('80.02'), '80.02');
});

test('allows a number field to remain temporarily empty', () => {
  assert.equal(normalizeFinancialNumberDraft(''), '');
});