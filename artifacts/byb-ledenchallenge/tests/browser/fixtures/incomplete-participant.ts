import { test as base } from '@playwright/test';

type IncompleteParticipantFixture = {
  incompleteParticipant: void;
};

export const test = base.extend<IncompleteParticipantFixture>({
  incompleteParticipant: [
    async ({ page }, use) => {
      await page.route('**/api/dashboard', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            participant: {
              country: 'Nederland',
              startingMembers: null,
              targetNewMembers: null,
              revision: 1,
            },
          }),
        });
      });

      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';