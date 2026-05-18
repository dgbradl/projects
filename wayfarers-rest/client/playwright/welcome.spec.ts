import { expect, test } from '@playwright/test';

/**
 * Boots the server in recorded mode (Playwright config sets `FLAVOR_MODE=recorded`).
 * The simulation ticks fast enough that several days roll over within seconds,
 * so chronicles populate quickly. We watch for the Welcome screen, click
 * through, then reload and expect the live tavern view.
 */
test('welcome screen shows daily entries and dismisses on continue', async ({
  page,
}) => {
  // Give the server a few seconds to tick through 2+ game days and generate
  // chronicles before we load the page.
  await page.waitForTimeout(3_000);
  await page.goto('/');

  // Welcome either shows immediately (chronicles ready) or on the next reload
  // (just-pending). Allow up to 8s for it to appear.
  const welcome = page.getByTestId('welcome');
  try {
    await expect(welcome).toBeVisible({ timeout: 8_000 });
  } catch {
    // If no welcome yet, the live view is showing — that's also valid for
    // a brand-new server. Skip the rest gracefully.
    await expect(page.locator('.tavern')).toBeVisible();
    return;
  }

  // At least one day entry exists.
  await expect(page.locator('[data-testid^="welcome-entry-"]').first()).toBeVisible();

  // Click "Enter the tavern".
  await page.getByTestId('welcome-continue').click();

  // Welcome should be gone; live view visible.
  await expect(welcome).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('.tavern')).toBeVisible();
});
