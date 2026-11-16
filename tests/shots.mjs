/**
 * Visual review helper: renders a set of fixed camera views to test-output/shots/.
 *   node tests/shots.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 5197;
const OUT = 'test-output/shots';
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => localStorage.setItem('nightfall.seenControls', '1'));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__nightfall, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/menu.png` });

const api = (fn, ...args) => page.evaluate(([f, a]) => window.__nightfall[f](...a), [fn, args]);
await api('setNoPointerLock', true);
await page.click('button:has-text("New Game")');
await page.waitForTimeout(800);
console.log(JSON.stringify(await page.evaluate(() => { const s = window.__nightfall.state(); return { fps: s.fps, calls: s.drawCalls, tris: s.triangles }; })));

const views = (process.argv[2] ? JSON.parse(process.argv[2]) : [
  { name: 'start', x: 8, z: 31, yaw: -0.65, pitch: -0.05, light: true },
  { name: 'reception-desk', x: 22, z: 33.5, yaw: -0.9, pitch: -0.1, light: true },
  { name: 'corridor-dark', x: 20, z: 24, yaw: 0, pitch: 0, light: true },
  { name: 'storage', x: 12, z: 9, yaw: 0.9, pitch: -0.1, light: true },
  { name: 'ward-a', x: 43, z: 7, yaw: -1.9, pitch: -0.15, light: true },
  { name: 'office', x: 43, z: 19, yaw: -2.2, pitch: -0.2, light: true },
]);
for (const v of views) {
  await api('teleport', v.x, v.z, v.yaw, v.pitch);
  const on = (await page.evaluate(() => window.__nightfall.state().flashlightOn));
  if (on !== v.light) { await api('key', 'KeyF', true); await page.waitForTimeout(100); await api('key', 'KeyF', false); }
  if (v.enemy) await api('enemyTo', v.enemy[0], v.enemy[1], true);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${v.name}.png` });
}
await browser.close();
server.kill();
process.exit(0);
