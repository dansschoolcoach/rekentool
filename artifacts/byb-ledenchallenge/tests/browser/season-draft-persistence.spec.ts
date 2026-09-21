import { expect, test } from '@playwright/test';

const draftStorageKey = 'byb:financial-season-draft:v2:participant:contrast-test-user:season:2';

test('bewaart de laatste invoer bij verversen vóór de debounce', async ({ page }) => {
  await page.goto('/draft-test.html');
  await page.evaluate(key => localStorage.removeItem(key), draftStorageKey);
  await page.reload();

  const seasonName = page.getByLabel('Naam seizoen');
  await expect(seasonName).toHaveValue('2026/2027');

  const pendingName = `Concept ${Date.now()}`;
  await seasonName.fill(pendingName);
  await expect(page.getByTestId('season-draft-save-status')).toContainText('wacht');

  await page.reload();

  await expect(page.getByTestId('season-draft-notice')).toBeVisible();
  await page.getByTestId('button-restore-season-draft').click();
  await expect(page.getByLabel('Naam seizoen')).toHaveValue(pendingName);
});

test('bewaart de laatste invoer direct wanneer de pagina verborgen wordt', async ({ page }) => {
  await page.goto('/draft-test.html');
  await page.evaluate(key => localStorage.removeItem(key), draftStorageKey);
  await page.reload();

  const seasonName = page.getByLabel('Naam seizoen');
  await expect(seasonName).toHaveValue('2026/2027');

  const pendingName = `Verborgen concept ${Date.now()}`;
  await seasonName.fill(pendingName);
  await expect(page.getByTestId('season-draft-save-status')).toContainText('wacht');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect.poll(async () => page.evaluate(key => {
    const draft = JSON.parse(localStorage.getItem(key) ?? 'null');
    return draft?.form?.name;
  }, draftStorageKey)).toBe(pendingName);
  await expect(page.getByTestId('season-draft-save-status')).toContainText('bewaard');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.reload();

  await expect(page.getByTestId('season-draft-notice')).toBeVisible();
  await page.getByTestId('button-restore-season-draft').click();
  await expect(page.getByLabel('Naam seizoen')).toHaveValue(pendingName);
});

test('blijft bruikbaar wanneer browseropslag is geblokkeerd', async ({ page }) => {
  await page.addInitScript(() => {
    for (const operation of ['getItem', 'setItem', 'removeItem'] as const) {
      Object.defineProperty(Storage.prototype, operation, {
        configurable: true,
        value: () => {
          throw new DOMException('Browseropslag is geblokkeerd', 'SecurityError');
        },
      });
    }
  });
  await page.goto('/draft-test.html');

  const seasonName = page.getByLabel('Naam seizoen');
  await expect(seasonName).toHaveValue('2026/2027');

  const pendingName = `Geblokkeerd concept ${Date.now()}`;
  await seasonName.fill(pendingName);
  await expect(seasonName).toHaveValue(pendingName);
  await expect(page.getByTestId('season-draft-save-status')).toContainText(
    'Concept kon niet in deze browser worden bewaard',
  );

  const manualSave = page.getByRole('button', { name: 'Stamgegevens opslaan' });
  await expect(manualSave).toBeVisible();
  await expect(manualSave).toBeEnabled();
});
