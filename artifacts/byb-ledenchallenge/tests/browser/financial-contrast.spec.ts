import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectNoColorContrastViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .analyze();

  expect(results.violations, `${state} bevat onvoldoende kleurcontrast`).toEqual([]);
}

async function expectInteractiveContrast({
  page,
  view,
  hoverTarget,
  focusTarget,
}: {
  page: Page;
  view: string;
  hoverTarget: Locator;
  focusTarget: Locator;
}) {
  await expectNoColorContrastViolations(page, `${view} in rust`);

  await hoverTarget.hover();
  await expectNoColorContrastViolations(page, `${view} tijdens hover`);

  await focusTarget.focus();
  await expect(focusTarget).toBeFocused();
  await expectNoColorContrastViolations(page, `${view} tijdens focus`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/contrast.html');
  await expect(page.getByTestId('title-financien')).toBeVisible();
});

for (const view of [
  {
    name: 'Invoer',
    tab: 'tab-input',
    hoverTarget: 'button-add-financial-activity',
    focusTarget: 'button-save-financial-input',
  },
  {
    name: 'Kosten',
    tab: 'tab-costs',
    hoverTarget: 'button-cost-group-Abonnementen',
    focusTarget: 'button-save-financial-costs',
  },
  {
    name: 'Resultaten',
    tab: 'tab-results',
    hoverTarget: 'btn-new-season',
    focusTarget: 'button-save-preliminary-tax',
  },
]) {
  test(`${view.name} gebruikt voldoende kleurcontrast in interactieve toestanden`, async ({ page }) => {
    await page.getByTestId(view.tab).click();
    await expectInteractiveContrast({
      page,
      view: view.name,
      hoverTarget: page.getByTestId(view.hoverTarget),
      focusTarget: page.getByTestId(view.focusTarget),
    });
  });
}

test('Stamgegevens gebruikt voldoende kleurcontrast in interactieve toestanden', async ({ page }) => {
  await page.getByTestId('tab-stamgegevens').click();
  await page.getByTestId('choose-master-data-manual').click();
  await expect(page.getByTestId('participant-master-data-manual')).toBeVisible();
  await expectInteractiveContrast({
    page,
    view: 'Stamgegevens',
    hoverTarget: page.getByTestId('button-add-teacher-bottom'),
    focusTarget: page.getByTestId('button-save-season-general'),
  });
});