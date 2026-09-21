import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinancialMonthDetail, FinancialMonthInput } from '@workspace/api-client-react';
import {
  cloneFinancialMonthForm,
  financialMonthFormFromDetail,
  hasFinancialMonthChanges,
} from './financialMonthFormState.ts';

function createForm(): FinancialMonthInput {
  return {
    contributionRevenue: 100,
    taxArrears: 0,
    salaryOverride: null,
    fixedCosts: [{ group: 'Marketing', description: 'Advertentie', frequency: 'monthly', amount: 25 }],
    activities: [{ name: 'Workshop', amount: 50 }],
    lessonInputs: [{ lessonId: 1, attendance: 12, lessonCountOverride: null }],
  };
}

test('detecteert een wijziging aan een bestaande kostenregel', () => {
  const form = createForm();
  const savedForm = cloneFinancialMonthForm(form);
  form.fixedCosts[0] = { ...form.fixedCosts[0], amount: 30 };
  assert.equal(hasFinancialMonthChanges(form, savedForm), true);
});

test('detecteert een wijziging aan een bestaande activiteit', () => {
  const form = createForm();
  const savedForm = cloneFinancialMonthForm(form);
  form.activities[0] = { ...form.activities[0], name: 'Extra workshop' };
  assert.equal(hasFinancialMonthChanges(form, savedForm), true);
});

test('detecteert een wijziging aan bestaande lesinvoer', () => {
  const form = createForm();
  const savedForm = cloneFinancialMonthForm(form);
  form.lessonInputs[0] = { ...form.lessonInputs[0], attendance: 13 };
  assert.equal(hasFinancialMonthChanges(form, savedForm), true);
});

test('behoudt een nieuwere wijziging die tijdens het opslaan is gemaakt', () => {
  const submittedForm = createForm();
  const latestForm = cloneFinancialMonthForm(submittedForm);
  latestForm.contributionRevenue = 125;
  assert.equal(hasFinancialMonthChanges(latestForm, submittedForm), true);
});

test('zet alle financiële maandinvoer via één omzetting om naar bewerkbare formulierdata', () => {
  const detail = {
    updatedAt: '2026-10-10T12:00:00.000Z',
    contributionRevenue: 1200,
    taxArrears: 175,
    salaryOverride: 900,
    fixedCosts: [{ group: 'Marketing', description: 'Campagne', frequency: 'monthly', amount: 80 }],
    activities: [{ name: 'Workshop', amount: 240 }],
    lessonInputs: [{ lessonId: 1, attendance: 12, attendanceSourceMonth: '2026-09-01', lessonCountOverride: 4 }],
    lessonProfitability: [{ lessonId: 1 }, { lessonId: 2 }],
  } as FinancialMonthDetail;

  const form = financialMonthFormFromDetail(detail);

  assert.deepEqual(form, {
    expectedUpdatedAt: detail.updatedAt,
    contributionRevenue: detail.contributionRevenue,
    taxArrears: detail.taxArrears,
    salaryOverride: detail.salaryOverride,
    fixedCosts: detail.fixedCosts,
    activities: detail.activities,
    lessonInputs: [
      detail.lessonInputs[0],
      { lessonId: 2, attendance: null, attendanceSourceMonth: null, lessonCountOverride: null },
    ],
  });
  assert.notEqual(form.fixedCosts, detail.fixedCosts);
  assert.notEqual(form.activities, detail.activities);
  assert.notEqual(form.lessonInputs, detail.lessonInputs);
});
