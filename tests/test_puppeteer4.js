const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('https://usuarios-citymart-lamas.web.app/index.html');
  await page.evaluate(() => { localStorage.setItem('userLogedIn', 'true') });
  await page.goto('https://usuarios-citymart-lamas.web.app/index.html', {waitUntil: 'networkidle2'});
  
  await new Promise(r => setTimeout(r, 4000));
  
  const allBiz = await page.evaluate(() => { 
    return typeof allBusinesses !== 'undefined' ? allBusinesses.length : 'undefined'; 
  });
  console.log('ALL BIZ LENGTH:', allBiz);
  
  await browser.close();
})();
