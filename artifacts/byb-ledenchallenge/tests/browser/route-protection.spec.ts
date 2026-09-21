import { expect, test } from '@playwright/test';

test('blokkeert beschermde deelnemerinhoud bij een profielcontrolefout en kan opnieuw proberen', async ({ page }) => {
  let dashboardRequests = 0;

  await page.route('**/api/dashboard', async (route) => {
    dashboardRequests += 1;
    if (dashboardRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'tijdelijke profielcontrolefout' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        participant: {
          country: 'Nederland',
          startingMembers: 42,
          targetNewMembers: 8,
        },
      }),
    });
  });

  await page.goto('/route-protection.html');

  await expect(page.getByTestId('status-error')).toBeVisible();
  await expect(page.getByTestId('status-error')).toContainText(
    'Je profiel kon niet worden gecontroleerd',
  );
  await expect(page.getByTestId('button-retry')).toBeVisible();
  await expect(page.getByTestId('text-page-title')).toHaveCount(0);
  await expect(page.getByText('Jouw beweging')).toHaveCount(0);

  await page.getByTestId('button-retry').click();

  await expect.poll(() => dashboardRequests).toBe(2);
  await expect(page.getByTestId('status-error')).toHaveCount(0);
  await expect(page.getByTestId('text-page-title')).toBeVisible();
  await expect(page.getByText('Jouw beweging')).toBeVisible();
});