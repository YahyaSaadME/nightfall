/**
 * End-to-end test: boots the dev server, drives the real game in headless Edge/Chrome
 * through the debug API and real UI clicks, and saves screenshots to test-output/.
 *   npm run test:e2e            (uses Microsoft Edge; set BROWSER=chrome for Chrome)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`  ${ok ? 'âœ“' : 'âœ—'} ${name}${detail ? `  (${detail})` : ''}`);
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
async function waitFor(pred, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred(await st())) return true;
    await wait(step);
  }
  return false;
}
async function hold(code, ms) {
  await api('key', code, true);
  await wait(ms);
  await api('key', code, false);
}
async function press(code) {
  await api('key', code, true);
  await wait(120);
  await api('key', code, false);
  await wait(80);
}

try {
  console.log('\nBoot & menu');
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__nightfall, null, { timeout: 120000 });
  check('game launches to the main menu', (await st()).screen === 'menu');
  await wait(2500);
  await shot('01-main-menu');
  const continueDisabled = await page.locator('button:has-text("Continue")').isDisabled();
  check('Continue is disabled without a checkpoint', continueDisabled);

  await page.click('button:has-text("Settings")');
  await wait(400);
  await shot('02-settings');
  const slider = page.locator('input[type=range]').first();
  await slider.fill('2');
  const sens = await page.evaluate(() => JSON.parse(localStorage.getItem('nightfall.settings.v1')).sensitivity);
  check('settings change and persist', sens === 2, `sensitivity=${sens}`);
  await slider.fill('1');
  await page.click('button:has-text("Low")');
  await wait(800);
  const low = await page.evaluate(() => JSON.parse(localStorage.getItem('nightfall.settings.v1')).quality);
  await page.click('button:has-text("High")');
  await wait(800);
  check('quality setting switches at runtime', low === 'low');
  await page.click('button:has-text("Back")');
  await page.click('button:has-text("Credits")');
  await wait(300);
  check('credits open', await page.locator('h2:has-text("Credits")').isVisible());
  await page.click('button:has-text("Back")');

  console.log('\nNew game');
  await api('setNoPointerLock', true);
  await api('setZombies', false); // scripted run: the zombie director would interrupt it (covered by tests/combat.test.ts)
  await page.click('button:has-text("New Game")');
  await wait(400);
  check('controls are shown on first launch', await page.locator('h2:has-text("Controls")').isVisible());
  await shot('03-controls');
  await page.click('button:has-text("Click to begin")');
  await wait(600);
  let s = await st();
  check('new game starts a playable session', s.screen === 'playing' && s.objective === 'explore');
  await wait(1500);
  s = await st();
  console.log(`    perf: ~${s.fps} fps (headless rAF), ${s.drawCalls} draw calls, ${s.triangles} triangles`);

  // Movement
  const p0 = s.player;
  await hold('KeyW', 1000);
  s = await st();
  const moved = Math.hypot(s.player.x - p0.x, s.player.z - p0.z);
  check('walking moves the player', moved > 1.5, `${moved.toFixed(2)} m in 1s`);
  await api('teleport', 8, 31, -0.65, 0);
  await api('key', 'ShiftLeft', true);
  const sp0 = (await st()).player;
  await hold('KeyW', 1000);
  await api('key', 'ShiftLeft', false);
  s = await st();
  const sprintMoved = Math.hypot(s.player.x - sp0.x, s.player.z - sp0.z);
  check('sprinting is faster than walking', sprintMoved > moved * 1.3, `${sprintMoved.toFixed(2)} m vs ${moved.toFixed(2)} m`);
  check('sprinting drains stamina', s.player.stamina < 95, `stamina=${s.player.stamina.toFixed(0)}`);
  await press('KeyC');
  check('crouch toggles', (await st()).player.crouched === true);
  await press('KeyC');

  // Collision
  await api('teleport', 4, 31, Math.PI / 2, 0); // facing -X (west wall at x=2)
  await hold('KeyW', 1500);
  s = await st();
  check('walls block movement', s.player.x >= 2.29, `x=${s.player.x.toFixed(3)}`);

  // Flashlight
  await api('teleport', 8, 31, -0.65, 0);
  await press('KeyF');
  const b0 = (await st()).battery;
  check('flashlight toggles on', (await st()).flashlightOn);
  await wait(3000);
  const b1 = (await st()).battery;
  check('flashlight drains battery', b1 < b0, `${b0.toFixed(2)} -> ${b1.toFixed(2)}`);
  await shot('04-reception-flashlight');
  await api('setBattery', 30);
  check('battery pickup restores power', await api('interactWith', 'item-bat-reception') && (await st()).battery > 70);

  // Raycast interaction with the night log
  await api('teleport', 26, 30.1, 0, -0.34);
  await wait(300);
  s = await st();
  check('aiming at the log focuses it', s.focused === 'patient-log', `focused=${s.focused}`);
  await press('KeyE');
  await wait(200);
  s = await st();
  check('reading the log completes "explore"', s.objective === 'findFuse');
  await shot('05-objective-complete');

  // Doors
  await api('teleport', 19.2, 7, Math.PI / 2, 0); // facing -X toward the storage door
  await wait(300);
  s = await st();
  check('door prompt appears', (s.prompt ?? '').includes('Open'), `prompt=${s.prompt}`);
  await press('KeyE');
  await wait(900);
  s = await st();
  const storageDoor = s.doors.find((d) => d.id === 'door-8-3');
  check('doors open', storageDoor.open > 0.9);
  await hold('KeyW', 1400);
  s = await st();
  check('player can walk through the open door', s.player.x < 16, `x=${s.player.x.toFixed(2)}`);
  await shot('06-storage');

  // Fuse -> stalker wakes
  check('fuse pickup', await api('interactWith', 'item-fuse'));
  s = await st();
  check('objective advances to restore power', s.objective === 'restorePower' && s.inventory.includes('fuse'));
  check('stalker awakens after the fuse is taken', s.enemy.active);

  // Locked power door before power
  check('nurses door is power-locked', s.doors.find((d) => d.id === 'door-11-9').locked);

  // Hiding
  await api('teleport', 3.3, 4.6, Math.PI / 2, 0);
  await wait(300);
  check('locker hide prompt', ((await st()).prompt ?? '').includes('Hide'), (await st()).prompt);
  await press('KeyE');
  await wait(600);
  s = await st();
  check('player can hide', s.player.hidden === 'locker-storage');
  await shot('07-hidden-locker');
  await press('KeyE');
  await wait(300);
  s = await st();
  check('player can leave the hiding place', s.player.hidden === null);

  // Power
  check('fuse box accepts the fuse', await api('interactWith', 'fuse-box'));
  s = await st();
  check('power restored, nurses door unlocked', s.power && !s.doors.find((d) => d.id === 'door-11-9').locked && s.objective === 'keycard');
  await api('teleport', 20, 22, 0, 0.05);
  await wait(1500);
  await shot('08-corridor-emergency-power');

  // Enemy AI in the real game
  console.log('\nStalker');
  await api('teleport', 20, 22, 0, 0);
  await api('enemyTo', 20, 30, true);
  await api('enemyNoise', 20, 22, 20);
  s = await st();
  check('stalker investigates noises', s.enemy.state === 'Investigate', s.enemy.state);
  await api('teleport', 20, 18, Math.PI, 0); // looking toward the reception (+Z)
  await press('KeyF');
  if (!(await st()).flashlightOn) await press('KeyF');
  const chased = await waitFor((x) => x.enemy.state === 'Chase' || x.enemy.state === 'Attack', 12000);
  check('stalker detects and chases a visible player', chased, (await st()).enemy.state);
  await shot('09-stalker-chase');
  const attacked = await waitFor((x) => x.player.health < 100, 12000);
  check('stalker attacks within range', attacked, `health=${(await st()).player.health}`);
  await shot('10-damage');

  // Pause / resume
  console.log('\nPause & death');
  await page.keyboard.press('Escape');
  await wait(400);
  s = await st();
  check('Escape pauses', s.screen === 'paused');
  const e0 = s.enemy;
  await wait(1200);
  const e1 = (await st()).enemy;
  check('enemy is frozen while paused', e0.x === e1.x && e0.z === e1.z);
  await shot('11-pause');
  await page.click('button:has-text("Resume")');
  await wait(300);
  check('resume returns to play', (await st()).screen === 'playing');

  // Death
  await api('damage', 500);
  const died = await waitFor((x) => x.screen === 'dead', 6000);
  check('death screen appears', died);
  await wait(800);
  check('death screen is visible (not covered by the fade)', await page.locator('h2:has-text("IT FOUND YOU")').isVisible()
    && (await page.evaluate(() => getComputedStyle(document.querySelector('h2')).opacity)) !== '0');
  await shot('12-death');
  await page.click('button:has-text("Restart checkpoint")');
  await wait(800);
  s = await st();
  check('checkpoint restart works', s.screen === 'playing' && s.power && s.objective === 'keycard' && s.player.health >= 60,
    `obj=${s.objective} power=${s.power}`);
  const restoredEnemyDist = Math.hypot(s.enemy.x - s.player.x, s.enemy.z - s.player.z);
  check('stalker respawns away from the player', restoredEnemyDist > 10, `${restoredEnemyDist.toFixed(1)} m`);

  // Progression to the exit
  console.log('\nProgression');
  await api('enemyTo', 45, 31, false);
  check('keycard pickup', await api('interactWith', 'item-keycard'));
  check('keycard door opens with the card', await api('interactWith', 'door-17-15'));
  await wait(800);
  await api('teleport', 33, 31, -Math.PI / 2, 0);
  await hold('KeyW', 1800);
  s = await st();
  check('reaching the restricted corridor completes the objective', s.objective === 'exitKey', `obj=${s.objective} x=${s.player.x.toFixed(1)}`);
  await api('teleport', 38, 20, 0, 0);
  await press('KeyF');
  if (!(await st()).flashlightOn) await press('KeyF');
  await wait(800);
  await shot('13-restricted-wing');
  check('exit key pickup', await api('interactWith', 'item-exitKey'));
  check('main exit unlocks', await api('interactWith', 'door-9-18'));
  s = await st();
  check('final encounter starts (alarm, shutter rising)', s.objective === 'escape' && s.enemy.active, `obj=${s.objective}`);
  await api('enemyTo', 45, 31, false);
  await api('teleport', 19, 33, Math.PI, 0.05);
  await wait(1000);
  await shot('14-exit-shutter');
  await api('openExitNow');
  await api('teleport', 19, 35.2, Math.PI, 0);
  await hold('KeyW', 1000);
  const escaped = await waitFor((x) => x.screen === 'escaped', 9000);
  check('escape ending plays and completion screen shows', escaped);
  await wait(1500);
  check('completion screen is visible with stats', await page.locator('h2:has-text("ESCAPED")').isVisible() && await page.locator('text=Times hidden').isVisible());
  await shot('15-escaped');

  // Repeated restarts
  console.log('\nRobustness');
  for (let i = 0; i < 3; i++) {
    await page.click('button:has-text("Play again"), button:has-text("New Game")').catch(() => {});
    await wait(500);
    if ((await page.locator('button:has-text("Click to begin")').count()) > 0) await page.click('button:has-text("Click to begin")');
    await wait(300);
    await hold('KeyW', 300);
    await page.keyboard.press('Escape');
    await wait(300);
    await page.click('button:has-text("Main menu")');
    await wait(500);
  }
  s = await st();
  check('playable after repeated restarts', s.screen === 'menu');
  check('Continue enabled once a checkpoint exists', !(await page.locator('button:has-text("Continue")').isDisabled()));
  await page.click('button:has-text("Continue")');
  await wait(600);
  check('Continue resumes a session', (await st()).screen === 'playing');
} catch (e) {
  check('e2e run completed without exceptions', false, e.message);
} finally {
  const unexpected = errors.filter((e) => !/pointer ?lock|PointerLock/i.test(e));
  check('no page or console errors', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));
  console.log(`\n${results.length - failures} passed, ${failures} failed â€” screenshots in ${OUT}/\n`);
  await browser.close();
  server.kill();
  process.exit(failures ? 1 : 0);
}
