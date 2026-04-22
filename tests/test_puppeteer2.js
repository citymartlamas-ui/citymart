const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('https://citymart.vip');
  
  // Set localStorage to fake login to avoid redirect
  await page.evaluate(() => {
    localStorage.setItem('userLogedIn', 'true');
  });
  
  await page.goto('https://citymart.vip', {waitUntil: 'networkidle2'});
  
  // Let's add some wait for async loads
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
