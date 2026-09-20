// Browser regression for cards and transitions. No model calls or server data writes.
// PIXEL_PLAYWRIGHT_MODULE may point to an existing Playwright index.mjs.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PIXEL_PLAYWRIGHT_MODULE || 'playwright');
const upstream = new URL(process.env.PIXEL_UI_BASE_URL || 'http://127.0.0.1:20004');
const output = process.env.PIXEL_UI_EVIDENCE || '/tmp/pixel-art-browser-evidence/fixed';
await mkdir(output, { recursive: true });
const proxy = createServer((req, res) => {
  if (!req.url.startsWith('/proxy/20002/')) { res.writeHead(404).end(); return; }
  const forwarded = request(new URL(req.url.slice('/proxy/20002'.length), upstream), {
    method: req.method, headers: { ...req.headers, host: upstream.host },
  }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
  forwarded.on('error', () => res.writeHead(502).end()); req.pipe(forwarded);
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${proxy.address().port}/proxy/20002/?demo=tools`;
const browsers = [];
const results = [];
const launch = async (noGL = false, minimumFontSize = 0) => {
  const browser = await chromium.launch({
    executablePath: process.env.PIXEL_CHROME || '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', ...(noGL ? ['--disable-webgl', '--disable-gpu'] : ['--enable-unsafe-swiftshader']),
      ...(minimumFontSize ? [`--blink-settings=minimumFontSize=${minimumFontSize}`] : [])],
  }); browsers.push(browser); return browser;
};
const browser = await launch();
async function scenario(name, run, options = {}, owner = browser) {
  const context = await owner.newContext({ viewport: { width: 2560, height: 1440 }, ...options });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const detail = await run(page);
    assert.deepEqual(errors, [], `${name}: browser exceptions`);
    results.push({ name, passed: true, detail }); console.log(`PASS ${name}`, JSON.stringify(detail ?? {}));
  } catch (error) {
    await page.screenshot({ path: `${output}/${name}-failure.png` }).catch(() => {});
    results.push({ name, passed: false, error: error.message, browserErrors: errors }); throw error;
  } finally { await context.close(); }
}
async function open(page) {
  await page.goto(url); await page.locator('.evaluation-panel').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function unlocked(page) {
  await page.waitForFunction(() => !document.querySelector('.evaluation-panel') && !document.querySelector('[inert]'), { timeout: 2500 });
  assert.ok(await page.locator('textarea').inputValue());
  assert.equal(await page.locator('.pixel-shatter-hidden').count(), 0);
}
async function settings(page) {
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
}
async function probeAnimation(page) {
  await page.evaluate(() => {
    window.cardAnimationProbe = { gpu: false, dom: false };
    const until = performance.now() + 2000;
    const sample = () => {
      const canvas = document.querySelector('.pixel-transition canvas');
      if (canvas && getComputedStyle(canvas).visibility === 'visible') {
        window.cardAnimationProbe.gpu = true;
        window.cardGpuGeometry = { bitmapWidth: canvas.width, cssWidth: canvas.getBoundingClientRect().width, dpr: devicePixelRatio };
      }
      for (const el of document.querySelectorAll('.evaluation-card-motion')) {
        if (el.getAnimations().some(animation => animation.playState === 'running')) window.cardAnimationProbe.dom = true;
      }
      if (performance.now() < until) requestAnimationFrame(sample);
    }; sample();
  });
}
try {
  // Managed-browser font policies inflate computed html.fontSize but not rem geometry.
  // Before the fix, minimumFontSize=25 produced exactly one column of 87rem at 1440p.
  for (const [minimum, dpr, noGL] of [[12, 1, false], [25, 1, false], [25, 1.5, false], [25, 1, true]]) {
    const owner = await launch(noGL, minimum);
    await scenario(`min-font-${minimum}-dpr-${dpr}${noGL ? '-no-webgl' : ''}`, async page => {
      await open(page); await page.waitForTimeout(250);
      const geometry = await page.evaluate(() => {
        const root = document.documentElement;
        const ruler = document.createElement('div');
        ruler.style.cssText = 'position:fixed;width:100rem;height:0;visibility:hidden;'; document.body.append(ruler);
        const rem = ruler.getBoundingClientRect().width / 100; ruler.remove();
        return { computedFont: parseFloat(getComputedStyle(root).fontSize), pixel: parseFloat(getComputedStyle(root).getPropertyValue('--pixel')), rem,
          columns: document.querySelector('.evaluation-panels').style.getPropertyValue('--card-columns'),
          cardWidth: document.querySelector('.evaluation-panels').style.getPropertyValue('--card-width'),
          labels: [...document.querySelectorAll('.evaluation-details dt')].map(el => {
            const range = document.createRange(); range.selectNodeContents(el);
            return { textLines: range.getClientRects().length };
          }),
          cards: [...document.querySelectorAll('.evaluation-panel')].map(el => el.getBoundingClientRect().toJSON()) };
      });
      assert.ok(geometry.computedFont >= minimum, 'font policy is active');
      assert.ok(Math.abs(geometry.pixel - geometry.rem) < 0.001, 'declared grid matches rendered rem');
      assert.equal(geometry.columns, '3'); assert.equal(geometry.cardWidth, '240rem');
      assert.equal(new Set(geometry.cards.map(card => Math.round(card.y))).size, 1);
      for (const label of geometry.labels) assert.equal(label.textLines, 1, 'short card labels must not wrap under minimum font sizes');
      await settings(page);
      await page.screenshot({ path: `${output}/min-font-${minimum}-dpr-${dpr}${noGL ? '-no-webgl' : ''}.png` });
      await page.locator('.evaluation-hit-area').first().hover(); await page.waitForTimeout(1200);
      await probeAnimation(page); await page.locator('.evaluation-hit-area').first().click(); await unlocked(page);
      const animation = await page.evaluate(() => ({ ...window.cardAnimationProbe, geometry: window.cardGpuGeometry }));
      if (noGL) assert.equal(animation.dom, true);
      else {
        assert.equal(animation.gpu, true, 'GPU animation survives minimum-font policy');
        assert.ok(Math.abs(animation.geometry.bitmapWidth - animation.geometry.cssWidth * dpr) < 2,
          'particle canvas dimensions match the CSS grid, not the inflated font size');
      }
      return { ...geometry, animation };
    }, { viewport: { width: Math.floor(2560 / dpr), height: Math.floor(1440 / dpr) }, deviceScaleFactor: dpr }, owner);
  }
  for (const [name, width, height, dpr] of [
    ['1440p', 2560, 1440, 1], ['1440p-150pct', 1706, 900, 1.5],
    ['desktop-1440x900', 1440, 900, 1], ['desktop-1600x900', 1600, 900, 1], ['4k', 3840, 2160, 1],
  ]) await scenario(name, async page => {
    await open(page); await page.waitForTimeout(250);
    const geometry = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector('.evaluation-panels')).gridTemplateColumns,
      area: document.querySelector('.welcome').getBoundingClientRect().toJSON(),
      cards: [...document.querySelectorAll('.evaluation-panel')].map(el => el.getBoundingClientRect().toJSON()),
    }));
    assert.equal(new Set(geometry.cards.map(rect => Math.round(rect.y))).size, 1, 'desktop cards must share a row');
    for (const card of geometry.cards) assert.ok(card.bottom <= geometry.area.bottom + 1, 'whole card fits visible area');
    await settings(page);
    await page.screenshot({ path: `${output}/${name}.png` });
    await page.locator('.evaluation-hit-area').first().click(); await unlocked(page);
    return geometry;
  }, { viewport: { width, height }, deviceScaleFactor: dpr });

  await scenario('hot-gpu-and-repeat', async page => {
    await open(page); await page.locator('.evaluation-hit-area').nth(1).hover(); await page.waitForTimeout(900);
    await probeAnimation(page); await page.locator('.evaluation-hit-area').nth(1).click(); await unlocked(page);
    const animation = await page.evaluate(() => window.cardAnimationProbe);
    assert.equal(animation.gpu, true, 'ready GPU must retain pixel shatter');
    for (let index = 0; index < 3; index++) {
      await page.getByRole('button', { name: '选择方向', exact: true }).click();
      await page.locator('.evaluation-hit-area').nth(index).click(); await unlocked(page);
    }
    await settings(page); return animation;
  });
  await scenario('motion-off-mid-animation', async page => {
    await open(page); await page.locator('.evaluation-hit-area').first().hover(); await page.waitForTimeout(900);
    await page.locator('.evaluation-hit-area').first().click();
    await page.getByRole('button', { name: '工作台设置', exact: true }).click();
    await page.getByRole('switch', { name: '界面动效' }).click();
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await unlocked(page); await settings(page);
  });
  await scenario('cold-module', async page => {
    await page.route('**/assets/pixelShatter-*.js', async route => { await new Promise(r => setTimeout(r, 800)); await route.continue(); });
    await open(page); await probeAnimation(page);
    await page.locator('.evaluation-hit-area').first().click(); await unlocked(page);
    const animation = await page.evaluate(() => window.cardAnimationProbe);
    assert.equal(animation.dom, true, 'cold module must show a GPU-independent transition'); return animation;
  });
  await scenario('blocked-graphics-module', async page => {
    await page.route('**/assets/pixelShatter-*.js', route => route.abort());
    await open(page); await probeAnimation(page);
    await page.locator('.evaluation-hit-area').first().click(); await unlocked(page); await settings(page);
    assert.equal(await page.evaluate(() => window.cardAnimationProbe.dom), true);
  });
  await scenario('resize-during-animation', async page => {
    await open(page); await page.waitForTimeout(900); await page.locator('.evaluation-hit-area').first().click();
    await page.setViewportSize({ width: 1440, height: 900 }); await unlocked(page); await settings(page);
  });
  await scenario('reduced-motion', async page => {
    await open(page); await probeAnimation(page); await page.locator('.evaluation-hit-area').first().click(); await unlocked(page);
    assert.deepEqual(await page.evaluate(() => window.cardAnimationProbe), { gpu: false, dom: false });
  }, { reducedMotion: 'reduce' });
  await scenario('no-webgl', async page => {
    await open(page); await probeAnimation(page); await page.locator('.evaluation-hit-area').first().click(); await unlocked(page); await settings(page);
    const animation = await page.evaluate(() => window.cardAnimationProbe);
    assert.equal(animation.dom, true); assert.equal(animation.gpu, false); return animation;
  }, {}, await launch(true));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await Promise.all(browsers.map(browser => browser.close()));
  await new Promise(resolve => proxy.close(resolve));
}
