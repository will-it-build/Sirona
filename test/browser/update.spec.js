import {test, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

// Reproduce a phone still controlled by a cache-first worker from an old release.
// Fresh HTML must never run that worker's obsolete app.js after a deployment.
test('an old cached app updates without clearing device drafts and stays available offline', async ({page,context}) => {
  let released = false;
  const oldScript = `document.body.dataset.oldApp='true'; navigator.serviceWorker.register('/sw.js');`;
  const oldWorker = `
    self.addEventListener('install',e=>e.waitUntil(caches.open('sirona-shell-old-test').then(c=>c.addAll(['/','/app.js']))));
    self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
    self.addEventListener('fetch',e=>{
      const u=new URL(e.request.url);
      if(u.search || u.pathname.startsWith('/api/')) return;
      if(e.request.mode==='navigate') e.respondWith(fetch(e.request).catch(()=>caches.match('/')));
      else if(u.pathname==='/app.js') e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));
    });`;
  const server = createServer(async (request,response) => {
    try {
      const url = new URL(request.url,'http://localhost');
      response.setHeader('Cache-Control','no-store');
      if(url.pathname.startsWith('/api/')){
        response.writeHead(401,{'Content-Type':'application/json'});
        response.end(JSON.stringify({error:'Please log in.',signup:false})); return;
      }
      const file = url.pathname === '/' ? '/index.html' : url.pathname;
      response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
      if(!released && file==='/index.html') response.end('<body><script src="/app.js"></script></body>');
      else if(!released && file==='/app.js') response.end(oldScript);
      else if(!released && file==='/sw.js') response.end(oldWorker);
      else response.end(await readFile(new URL('../../public'+file,import.meta.url)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const origin = 'http://127.0.0.1:'+server.address().port;
    await page.goto(origin);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-old-app','true');
    const draft = JSON.stringify({pending:{'draft:active':{data:{day:'Push',entries:[]}}}});
    await page.evaluate(value=>localStorage.setItem('sirona-v2:update-test',value),draft);
    released = true;
    await page.reload();
    await expect(page.locator('#authTitle')).toHaveText('Welcome back');
    await expect(page.locator('body')).not.toHaveAttribute('data-old-app','true');
    await expect(page.locator('#appUpdate')).toBeVisible();
    await page.locator('#applyAppUpdate').click();
    await expect(page.locator('#appUpdate')).toBeHidden();
    await expect(page.locator('#authTitle')).toHaveText('Welcome back');
    expect(await page.evaluate(()=>localStorage.getItem('sirona-v2:update-test'))).toBe(draft);
    await expect.poll(()=>page.evaluate(async()=> (await caches.keys()).includes('sirona-shell-old-test'))).toBe(false);
    await context.setOffline(true); await page.reload();
    await expect(page.locator('#authTitle')).toHaveText('Welcome back');
    await expect(page.locator('.build-label')).toContainText('planner 2');
    expect(await page.evaluate(()=>localStorage.getItem('sirona-v2:update-test'))).toBe(draft);
  } finally { await context.setOffline(false); await new Promise(resolve=>server.close(resolve)); }
});
