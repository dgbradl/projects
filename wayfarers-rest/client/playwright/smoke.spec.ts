import { expect, test } from '@playwright/test';

test('a traveler appears, has a name, and visibly moves', async ({ page }) => {
  await page.goto('/');

  // Status bar renders day + sub-tick.
  const statusBar = page.getByTestId('status-bar');
  await expect(statusBar).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('status-day')).toHaveText(/\d+/);
  await expect(page.getByTestId('status-subtick')).toHaveText(/\d+\s*\/\s*\d+/);

  // At least one NPC sprite appears.
  const firstNpc = page.locator('.npc').first();
  await expect(firstNpc).toBeVisible({ timeout: 5_000 });
  await expect(firstNpc.locator('.npc-label')).not.toHaveText('');

  // Capture position, wait, assert it has changed (proof of motion).
  const beforeId = await firstNpc.getAttribute('data-npc-id');
  const before = await firstNpc.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { left: s.left, top: s.top };
  });

  await page.waitForTimeout(2_500);

  // Re-locate by the original id; it may have been removed if it departed —
  // in that case, ANY sprite still on screen counts as motion.
  const sameNpc = beforeId
    ? page.locator(`.npc[data-npc-id="${beforeId}"]`).first()
    : firstNpc;
  if ((await sameNpc.count()) > 0) {
    const after = await sameNpc.evaluate((el) => {
      const s = (el as HTMLElement).style;
      return { left: s.left, top: s.top };
    });
    expect(after.left !== before.left || after.top !== before.top).toBe(true);
  } else {
    // Original NPC departed; assert some NPC is still there to prove things
    // kept moving.
    await expect(page.locator('.npc').first()).toBeVisible();
  }
});
