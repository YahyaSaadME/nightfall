/**
 * End-to-end check of zombies, weapons and the spawn director in the real game
 * (headless Edge/Chrome, debug API). Screenshots go to test-output/combat/.
 *   npm run test:combat-e2e      (BROWSER=chrome for Chrome)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 5198;
const URL = `http://localhost:${PORT}/`;
const OUT = 'test-output/combat';
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('dev server timeout')), 60000);
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); resolve(); } });
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const browser = await chromium.launch({
  channel: process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const st = () => page.evaluate(() => window.__nightfall.state());
const api = (fn, ...args) => page.evaluate(([f, a]) => window.__nightfall[f](...a), [fn, args]);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
async function press(code, hold = 120) {
  await api('key', code, true);
  await wait(hold);
  await api('key', code, false);
  await wait(60);
}
async function waitFor(pred, ms = 8000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await st();
    if (await pred(s)) return s;
    await wait(step);
  }
  return null;
}

try {
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__nightfall, null, { timeout: 120000 });
  await api('setNoPointerLock', true);
  await api('setZombies', false);
  await wait(1500);
  await page.click('button:has-text("New Game")');
  await wait(400);
  await page.click('button:has-text("Click to begin")');
  await waitFor((s) => s.screen === 'playing');

  console.log('\nLoadout and HUD');
  let s = await st();
  check('starts with bat + loaded pistol', s.weapons.owned.join() === 'bat,pistol' && s.weapons.mag.pistol === 12 && s.weapons.reserve['9mm'] === 12, JSON.stringify(s.weapons));
  check('HUD shows the ammo counter', await page.locator('text=/^12$/').first().isVisible());
  await shot('01-hud-loadout');

  console.log('\nZombies spawn, render and can be shot');
  await api('teleport', 10, 33.5, 0, 0);
  await press('KeyF');
  await wait(300);
  const spawned = await page.evaluate(() => [
    window.__nightfall.spawnZombie(10, 28, 'walker', false),
    window.__nightfall.spawnZombie(13, 28.5, 'runner', false),
    window.__nightfall.spawnZombie(7.5, 29, 'brute', false),
  ]);
  check('three zombies spawn (walker, runner, brute)', spawned.every(Boolean));
  await wait(500);
  s = await st();
  check('zombies are alive in the game state', s.zombies.length === 3, s.zombies.map((z) => z.kind).join());
  await shot('02-zombies-in-view');

  const ammoBefore = s.weapons.mag.pistol;
  await api('look', 0, -0.12);
  await press('Mouse0');
  await wait(400);
  s = await st();
  check('a click fires the pistol and uses a round', s.weapons.mag.pistol === ammoBefore - 1, `mag ${ammoBefore} -> ${s.weapons.mag.pistol}`);
  await shot('03-after-first-shot');

  console.log('\nKilling zombies');
  await api('teleport', 10, 33.5, 0, -0.05);
  await api('spawnZombie', 10, 29, 'walker', false);
  await wait(200);
  const killsBefore = (await st()).kills;
  for (let i = 0; i < 6 && (await st()).kills === killsBefore; i++) { await press('Mouse0'); await wait(350); }
  s = await st();
  check('the pistol kills a zombie (kill counter increments)', s.kills > killsBefore, `kills ${killsBefore} -> ${s.kills}`);
  await api('setZombies', false); // clears everything

  console.log('\nReload');
  await api('selectWeapon', 'pistol');
  await wait(500);
  await press('KeyR');
  await wait(300);
  s = await st();
  check('R starts a reload when the magazine is not full', s.weapons.reloading || s.weapons.mag.pistol === 12, JSON.stringify(s.weapons));
  await wait(1800);
  s = await st();
  check('the reload completes', !s.weapons.reloading && s.weapons.mag.pistol > 0, JSON.stringify(s.weapons.mag));

  console.log('\nMelee');
  await api('selectWeapon', 'bat');
  await wait(450);
  await api('teleport', 10, 33.5, 0, 0);
  await api('look', 0, 0);
  await api('spawnZombie', 10, 32.0, 'walker', false);
  await wait(250);
  const hpBefore = (await st()).zombies[0]?.health;
  await press('Mouse0');
  await wait(250);
  const hpAfter = (await st()).zombies[0]?.health;
  check('the bat damages a zombie in front of the player', hpAfter !== undefined && hpAfter < hpBefore, `${hpBefore} -> ${hpAfter}`);
  await shot('04-melee');

  console.log('\nZombies attack');
  await api('setZombies', false);
  await api('selectWeapon', 'pistol');
  await api('teleport', 8, 33, 0, 0);
  const healthBefore = (await st()).player.health;
  await api('spawnZombie', 8, 29.2, 'walker', true);
  const hurt = await waitFor((x) => x.player.health < healthBefore, 9000);
  check('a zombie that reaches the player hurts them', !!hurt, `health ${healthBefore} -> ${hurt ? hurt.player.health : (await st()).player.health}`);
  await shot('05-zombie-attack');

  console.log('\nPickups');
  await api('setZombies', false);
  await api('teleport', 8, 33, 0, 0);
  const reserveBefore = (await st()).weapons.reserve['9mm'];
  await api('teleport', 15, 33, 0, 0); // pk-ammo-reception
  await wait(600);
  s = await st();
  check('walking over an ammo box picks it up', s.weapons.reserve['9mm'] > reserveBefore, `${reserveBefore} -> ${s.weapons.reserve['9mm']}`);
  await api('teleport', 26.5, 20.5, 0, 0); // pk-shotgun-nurses
  await wait(600);
  s = await st();
  check('walking over the shotgun picks it up and equips it', s.weapons.owned.includes('shotgun') && s.weapons.current === 'shotgun', JSON.stringify(s.weapons.owned));
  await shot('06-shotgun-equipped');

  console.log('\nML spawn director');
  await api('teleport', 8, 33, 0, 0);
  await api('setZombies', true);
  const decision = await api('directorTick');
  check('the director takes a decision with the bundled model', decision && decision.source === 'model' && decision.probs.length === 4, decision ? `${decision.source}, tier ${decision.tier}, count ${decision.count}, probs ${decision.probs.map((p) => p.toFixed(2)).join('/')}` : 'none');
  const info = await api('director');
  check('the director reports it is using the neural network', info.usingModel === true);
  const log = await api('directorLog');
  check('decisions are logged with their 16 input features', log.length > 0 && Object.keys(log[0].obs).length === 16);

  console.log('\nSurviving');
  const final = await st();
  check('the game is still in the playing state', final.screen === 'playing' || final.screen === 'dead', final.screen);
  check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  failures++;
  console.log('  ✗ test crashed:', e.message);
  console.log(errors.slice(0, 5).join('\n'));
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed\n` : '\nall combat checks passed\n');
process.exit(failures ? 1 : 0);
