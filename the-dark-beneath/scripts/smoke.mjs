// Headless smoke test: boots the game, starts a new run, walks through the
// core screens, and fails loudly on any page error.
// Prereq: `npm run preview` serving on http://localhost:4173
import { chromium } from 'playwright-core';

const CHROMIUM = process.env.CHROMIUM_PATH
  ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:4173/');
await page.click('#m-new');
await page.waitForTimeout(400);

// town → overworld → dungeon
await page.getByRole('button', { name: /Set Out/ }).click();
await page.waitForTimeout(300);
await page.evaluate(() => window.__dbg.dungeon.enterDungeon('sunken_crypt'));
await page.waitForTimeout(300);
for (const k of ['ArrowUp', 'ArrowUp', 'ArrowLeft']) {
  await page.keyboard.press(k);
  await page.waitForTimeout(150);
}

// forced combat round-trip
await page.evaluate(() => {
  const d = window.__dbg;
  d.combat.startCombat(d.combat.spawnMonsters('giant_rat', 1), { theme: 'crypt' });
});
await page.waitForTimeout(1500); // let monster turns tick
const mode = await page.evaluate(() => window.__dbg.G.mode);

// save/load
const saved = await page.evaluate(() => window.__dbg.state.saveGame());

await browser.close();

if (errors.length) {
  console.error('SMOKE FAIL:\n' + errors.join('\n'));
  process.exit(1);
}
if (!saved) {
  console.error('SMOKE FAIL: save failed');
  process.exit(1);
}
console.log(`SMOKE OK (post-combat mode: ${mode})`);
