// End-to-end smoke: the built game boots, renders, simulates, and takes input.
import { test, expect } from '@playwright/test';

test('boots clean and simulates', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();
  await page.click('#btn-welcome-close');   // fresh profile shows the welcome card
  await expect(page.locator('#stat-cash')).toContainText('$');

  // Fast-forward 10 game days in-page; the chain should function.
  const result = await page.evaluate(() => {
    const g = window.game;
    for (let i = 0; i < 600 * 10; i++) g.tick(1 / 600);
    return {
      day: g.day(),
      cash: g.cash,
      history: g.history.length,
      finite: Number.isFinite(g.cash),
    };
  });
  expect(result.day).toBeGreaterThanOrEqual(10);
  expect(result.finite).toBe(true);
  expect(result.history).toBeGreaterThan(5);

  expect(errors).toEqual([]);
});

test('map click selects a store and tabs switch', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(300);
  const welcome = page.locator('#btn-welcome-close');
  if (await welcome.isVisible()) await welcome.click();
  await expect(page.locator('#modal-backdrop')).toBeHidden();   // backdrop clears next frame

  // Click store #1's tile via the renderer's own projection.
  const pos = await page.evaluate(() => {
    const site = window.game.site('s1');
    const { sx, sy } = window.renderer.toScreen(site.x, site.y);
    const rect = document.getElementById('game').getBoundingClientRect();
    return { x: rect.left + sx, y: rect.top + sy };
  });
  await page.mouse.click(pos.x, pos.y);
  await expect(page.locator('#store-detail')).toContainText('Market St. #1');

  for (const tab of ['supply', 'vendors', 'hq', 'books', 'stores']) {
    await page.click(`[data-tab="${tab}"]`);
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
  }
});

test('layout adapts to a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(400);
  const welcome2 = page.locator('#btn-welcome-close');
  if (await welcome2.isVisible()) await welcome2.click();
  const widths = await page.evaluate(() => ({
    canvas: document.getElementById('game').getBoundingClientRect().width,
    sidebar: document.getElementById('sidebar').getBoundingClientRect().width,
  }));
  // Stacked layout: both the map and the panels get the full width.
  expect(widths.canvas).toBeGreaterThan(300);
  expect(widths.sidebar).toBeGreaterThan(300);
});

test('new systems are reachable from the UI', async ({ page }) => {
  await page.goto('/');
  const welcome = page.locator('#btn-welcome-close');
  if (await welcome.isVisible()) await welcome.click();

  // Settings modal round-trip.
  await page.click('#btn-settings');
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.click('#btn-settings-close');

  // Vendor contracts UI exists.
  await page.click('[data-tab="vendors"]');
  await expect(page.locator('[data-sign="freshfields"]')).toBeVisible();

  // HQ has campaigns and records.
  await page.click('[data-tab="hq"]');
  await expect(page.locator('#campaigns')).toBeVisible();
  await expect(page.locator('#rec-achievements')).toBeVisible();

  // Zoom controls work without errors.
  await page.click('#zoom-in');
  await page.click('#zoom-reset');

  // Books shows the by-product table after a simulated day.
  await page.evaluate(() => {
    for (let i = 0; i < 700; i++) window.game.tick(1 / 600);
  });
  await page.click('[data-tab="books"]');
  await expect(page.locator('#bproducts')).toContainText('Produce');
});
