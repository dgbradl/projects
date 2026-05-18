import { expect, test } from '@playwright/test';

test.describe('Phase 4 flavor surfaces', () => {
  test('an NPC tooltip shows the cached arrival tagline; rumors render as prose; an interaction bubble appears', async ({
    page,
  }) => {
    await page.goto('/');

    // Wait for the debug panel and bootstrap to settle.
    await expect(page.getByTestId('debug-panel')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('debug-flavor')).toBeVisible();

    // Within 10s, at least one NPC tooltip should reveal a tagline. We hover
    // the first sprite and look at its tooltip text.
    const firstNpc = page.locator('.npc').first();
    await expect(firstNpc).toBeVisible({ timeout: 10_000 });
    await firstNpc.hover();
    const tooltip = firstNpc.locator('.npc-tooltip');
    await expect(tooltip).toBeVisible();
    // The cached arrival garnish sets a tagline (or, in placeholder mode, a
    // deterministic one) — either way the tagline span should exist.
    await expect(tooltip.locator('.npc-tooltip-tagline')).toHaveCount(1);

    // Open the rumors section in the debug panel. Any text we see should NOT
    // include the placeholder `{` substitution marker.
    const rumorsSection = page.getByTestId('debug-rumors');
    await rumorsSection.locator('summary').click();
    const rumorText = await rumorsSection.textContent();
    expect(rumorText ?? '').not.toContain('{');

    // Wait up to 10s for an interaction bubble to appear at least once.
    const bubble = page.locator('.interaction-bubble').first();
    try {
      await expect(bubble).toBeVisible({ timeout: 10_000 });
    } catch {
      // Flaky in fast-tick configs; the next try should catch one.
      await expect(page.locator('.interaction-bubble').first()).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});
