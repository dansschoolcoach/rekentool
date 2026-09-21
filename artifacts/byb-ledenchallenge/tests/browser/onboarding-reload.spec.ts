import { expect, test } from './fixtures/incomplete-participant';
import { test as standaloneTest } from '@playwright/test';
import type { Page } from '@playwright/test';

async function expectOnboarding(page: Page) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId('form-onboarding')).toBeVisible();
  await expect(page.getByText('Zet je vertrekpunt')).toBeVisible();
}

for (const route of ['/cijfers', '/financien']) {
  test(`stuurt ${route} ook na een volledige browserherlaadactie naar onboarding`, async ({ page }) => {
    await page.goto(route);
    await expectOnboarding(page);

    await page.reload();
    await expectOnboarding(page);
  });
}

standaloneTest('behoudt opgeslagen startwaarden na een volledige dashboardherlaadactie', async ({ page }) => {
  let participant = {
    country: 'Nederland',
    startingMembers: null as number | null,
    targetNewMembers: null as number | null,
    revision: 1,
  };

  await page.route('**/api/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        participant,
        challenge: null,
        totals: { signups: 0, attendance: 0, enrolled: 0 },
        scores: { growthPercent: 0, conversionPercent: 0, attendancePercent: 0 },
        entries: [],
      }),
    });
  });

  await page.route('**/api/profile/preferences', async (route) => {
    const body = route.request().postDataJSON() as {
      startingMembers: number;
      targetNewMembers: number;
      revision: number;
    };
    participant = {
      ...participant,
      startingMembers: body.startingMembers,
      targetNewMembers: body.targetNewMembers,
      revision: participant.revision + 1,
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(participant),
    });
  });

  const expectSavedValues = async () => {
    await expect(page.getByTestId('text-metric-doel-nieuwe-leden')).toHaveText('0 van 8');
    await expect(page.getByTestId('card-metric-groei')).toContainText('t.o.v. 42 startleden');
  };

  await page.goto('/onboarding');
  await expect(page.getByTestId('form-onboarding')).toBeVisible();
  await page.getByTestId('input-onboarding-starting-members').fill('42');
  await page.getByTestId('input-onboarding-target-new-members').fill('8');
  await page.getByTestId('button-save-onboarding').click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expectSavedValues();

  await page.reload();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expectSavedValues();
});