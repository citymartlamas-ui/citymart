const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  
  await page.goto('https://usuarios-citymart-lamas.web.app/index.html');
  await page.evaluate(() => { localStorage.setItem('userLogedIn', 'true') });
  await page.goto('https://usuarios-citymart-lamas.web.app/index.html', {waitUntil: 'networkidle2'});
  
  await new Promise(r => setTimeout(r, 4000));
  
  const innerHTMLs = await page.evaluate(() => { 
    return {
       ranking: document.getElementById('ranking-container') ? document.getElementById('ranking-container').innerHTML.trim().substring(0, 50) : 'null',
       premium1: document.getElementById('premium-track-1') ? document.getElementById('premium-track-1').innerHTML.trim().substring(0, 50) : 'null'
    };
  });
  console.log('RESULTS:', JSON.stringify(innerHTMLs));
  
  await browser.close();
})();
