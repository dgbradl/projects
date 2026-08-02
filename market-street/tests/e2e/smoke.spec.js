// End-to-end smoke: the built game boots, renders, simulates, and takes input.
import { test, expect } from '@playwright/test';

test('boots clean and simulates', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();
  // Fresh profile lands on the title screen; pick a difficulty and start.
  await expect(page.locator('#title-screen')).toBeVisible();
  await page.click('.diff-card[data-diff="standard"]');
  await page.click('#btn-title-start');
  await expect(page.locator('#title-screen')).toBeHidden();
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
  const start = page.locator('#btn-title-start');
  if (await start.isVisible()) await start.click();
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
  const start2 = page.locator('#btn-title-start');
  if (await start2.isVisible()) await start2.click();
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
  const start = page.locator('#btn-title-start');
  if (await start.isVisible()) await start.click();

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

test('weekly planning loop: stop, plan, run', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(300);
  const start = page.locator('#btn-title-start');
  if (await start.isVisible()) await start.click();

  // Fast-forward to the end of week 1 — the game must stop into planning.
  await page.evaluate(() => {
    const g = window.game;
    g.speed = 3;
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
  });
  await page.waitForTimeout(300);
  await expect(page.locator('#week-report')).toBeVisible();
  await expect(page.locator('#btn-week-run')).toBeVisible();
  const stopped = await page.evaluate(() => ({ planning: window.game.planning, speed: window.game.speed }));
  expect(stopped).toEqual({ planning: true, speed: 0 });

  // Closing the report keeps the planning pause with the plan bar up.
  await page.click('#btn-week-close');
  await expect(page.locator('#plan-bar')).toBeVisible();
  expect(await page.evaluate(() => window.game.speed)).toBe(0);

  // Running the week resumes at the pre-stop cruise speed.
  await page.click('#btn-run-week');
  await expect(page.locator('#plan-bar')).toBeHidden();
  const running = await page.evaluate(() => ({ planning: window.game.planning, speed: window.game.speed }));
  expect(running).toEqual({ planning: false, speed: 3 });
});
