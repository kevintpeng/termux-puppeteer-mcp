const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions'
    ],
    headless: true
  });

  console.log('Browser launched successfully!');

  const page = await browser.newPage();
  await page.goto('https://example.com');

  const title = await page.title();
  console.log('Page title:', title);

  await page.screenshot({ path: '/root/screenshot.png' });
  console.log('Screenshot saved to /root/screenshot.png');

  await browser.close();
  console.log('Test completed successfully!');
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
