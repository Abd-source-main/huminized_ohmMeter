// Dev-only: renders icons/icon.svg into the PNG sizes the manifest and iOS need.
// Usage: node tools/make-icons.cjs   (needs Playwright + Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const jobs = [
  ['icon-192.png', 192, 1], ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.8], ['apple-touch-icon.png', 180, 0.9],
];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, scale] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:#0f1716;display:grid;place-items:center;height:${size}px">
      <div style="width:${size * scale}px;height:${size * scale}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: false });
    console.log('wrote', name);
  }
  await browser.close();
})();
