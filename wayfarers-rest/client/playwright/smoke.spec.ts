import { expect, test } from '@playwright/test';

test('a traveler appears, has a name, and visibly moves', async ({ page }) => {
  await page.goto('/');

  const statusBar = page.getByTestId('status-bar');
  await expect(statusBar).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('status-day')).toHaveText(/\d+/);
  await expect(page.getByTestId('status-subtick')).toHaveText(/\d+\s*\/\s*\d+/);

  const firstNpc = page.locator('.npc').first();
  await expect(firstNpc).toBeVisible({ timeout: 5_000 });
  await expect(firstNpc.locator('.npc-label')).not.toHaveText('');

  const beforeId = await firstNpc.getAttribute('data-npc-id');
  const before = await firstNpc.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { left: s.left, top: s.top };
  });

  await page.waitForTimeout(2_500);

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
    await expect(page.locator('.npc').first()).toBeVisible();
  }
});

test('debug panel shows seeded world tags and tooltip appears on NPC hover', async ({
  page,
}) => {
  await page.goto('/');

  const panel = page.getByTestId('debug-panel');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // Seeded world tags should appear.
  const tags = page.getByTestId('debug-tags');
  await expect(tags).toContainText('season');
  await expect(tags).toContainText('war_in_north');

  // After ~5s of running, the recent events buffer should have grown.
  await page.waitForTimeout(5_000);
  const events = page.getByTestId('debug-events');
  await expect(events).toContainText(/\(\d+\)/);

  // Hover the first NPC and expect tooltip visibility.
  const firstNpc = page.locator('.npc').first();
  await expect(firstNpc).toBeVisible({ timeout: 5_000 });
  await firstNpc.hover();
  const tooltip = firstNpc.locator('.npc-tooltip');
  await expect(tooltip).toHaveCSS('opacity', '1', { timeout: 2_000 });
});
