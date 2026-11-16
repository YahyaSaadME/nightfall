/** GPU frame-cost benchmark at 1280x720 and 1920x1080 for each quality level.  node tests/bench.mjs */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 5196;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const vp of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  const page = await browser.newPage({ viewport: vp });
  await page.addInitScript(() => localStorage.setItem('nightfall.seenControls', '1'));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!window.__nightfall, null, { timeout: 120000 });
  await page.evaluate(() => window.__nightfall.setNoPointerLock(true));
  await page.click('button:has-text("New Game")');
  await page.waitForTimeout(500);
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  for (const q of ['high', 'medium', 'low']) {
    await page.evaluate((qq) => {
      const s = JSON.parse(localStorage.getItem('nightfall.settings.v1') || '{}');
      localStorage.setItem('nightfall.settings.v1', JSON.stringify({ ...s, quality: qq }));
    }, q);
    // Apply via the settings UI path: reload is simplest and matches a real user.
    await page.reload();
    await page.waitForFunction(() => !!window.__nightfall, null, { timeout: 120000 });
    await page.evaluate(() => window.__nightfall.setNoPointerLock(true));
    await page.click('button:has-text("New Game")');
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__nightfall.teleport(20, 24, 0, 0); window.__nightfall.key('KeyF', true); });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__nightfall.key('KeyF', false));
    await page.waitForTimeout(500);
    const ms = await page.evaluate(() => window.__nightfall.bench(150));
    console.log(`${vp.width}x${vp.height}  ${q.padEnd(6)}  ${ms.toFixed(2)} ms/frame  (~${Math.round(1000 / ms)} fps GPU-bound)  [${gpu}]`);
  }
  await page.close();
}
await browser.close();
server.kill();
process.exit(0);
