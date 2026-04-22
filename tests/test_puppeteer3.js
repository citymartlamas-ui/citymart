const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', request => {
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText);
  });
  
  await page.goto('https://usuarios-citymart-lamas.web.app/index.html');
  await page.evaluate(() => { localStorage.setItem('userLogedIn', 'true') });
  await page.goto('https://usuarios-citymart-lamas.web.app/index.html', {waitUntil: 'networkidle2'});
  
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
})();
