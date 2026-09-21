import type { FinancialMonthDetail, FinancialMonthInput } from '@workspace/api-client-react';

export function financialMonthFormFromDetail(detail: FinancialMonthDetail): FinancialMonthInput {
  const lessonInputs = detail.lessonInputs.map(lesson => ({ ...lesson }));
  detail.lessonProfitability?.forEach(lesson => {
    if (!lessonInputs.some(input => input.lessonId === lesson.lessonId)) {
      lessonInputs.push({
        lessonId: lesson.lessonId,
        attendance: null,
        attendanceSourceMonth: null,
        lessonCountOverride: null,
      });
    }
  });

  return {
    expectedUpdatedAt: detail.updatedAt,
    contributionRevenue: detail.contributionRevenue,
    taxArrears: detail.taxArrears ?? 0,
    salaryOverride: detail.salaryOverride ?? null,
    fixedCosts: detail.fixedCosts.map(cost => ({ ...cost })),
    activities: detail.activities.map(activity => ({ ...activity })),
    lessonInputs,
  };
}

export function cloneFinancialMonthForm(form: FinancialMonthInput): FinancialMonthInput {
  return structuredClone(form);
}

export function hasFinancialMonthChanges(
  form: FinancialMonthInput,
  savedForm: FinancialMonthInput,
): boolean {
  return JSON.stringify(form) !== JSON.stringify(savedForm);
}