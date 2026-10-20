import { test, expect } from '@playwright/test';
async function signup(page) {
  const username = 'test_' + crypto.randomUUID().slice(0,8);
  await page.goto('/');
  await page.locator('#authSignupBtn').click();
  await page.locator('#authUser').fill(username);
  await page.locator('#authEmail').fill(username+'@example.com');
  await page.locator('#authPass').fill('browser-test-password');
  await page.locator('#authPass2').fill('browser-test-password');
  await page.locator('#authGo').click();
  await expect(page.locator('#appMain')).toBeVisible();
  return username;
}
async function addSet(page) {
  await page.locator('#pGroup').selectOption({index:1});
  await page.locator('#pEx').selectOption({index:1});
  await page.locator('#pAdd').click();
  await page.locator('#w-0').fill('50');
  await page.locator('#r-0').fill('8');
  await page.locator('.add-set .go').click();
}
test('mobile signup, unfinished workout refresh, completion, new-device login and account isolation', async ({page,browser}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844});
  const user=await signup(page);
  await addSet(page);
  await page.reload();
  await expect(page.locator('#appMain')).toBeVisible();
  await expect(page.locator('.set-val')).toContainText('50 kg × 8');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.locator('#finishBtn').click();
  await expect(page.locator('.h-session')).toHaveCount(1);
  await expect(page.locator('#saveStatus')).toHaveText('All changes saved',{timeout:20000});
  await page.screenshot({path:'test-results/mobile-ledger.png',fullPage:true});
  const other=await browser.newContext();const second=await other.newPage();
  await second.goto('/');await second.locator('#authUser').fill(user);await second.locator('#authPass').fill('browser-test-password');await second.locator('#authGo').click();
  await expect(second.locator('#appMain')).toBeVisible();await second.locator('#tab-history').click();
  await expect(second.locator('.h-session')).toHaveCount(1);
  await second.locator('#logoutBtn').click();await signup(second);await second.locator('#tab-history').click();
  await expect(second.locator('.h-session')).toHaveCount(0);
  await other.close();expect(errors).toEqual([]);
});
test('offline reload preserves a draft and reconnect sends it to the server',async({page,context})=>{
  await signup(page);await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await expect(page.locator('#appMain')).toBeVisible();
  await context.setOffline(true);await addSet(page);await page.reload();
  await expect(page.locator('#appMain')).toBeVisible();await expect(page.locator('.set-val')).toContainText('50 kg × 8');
  await context.setOffline(false);
  await expect(page.locator('#saveStatus')).toHaveText('All changes saved',{timeout:20000});
});
test('exercise notes are rendered as text, and a second tab cannot silently edit the same cache',async({page,context})=>{
  await signup(page);await addSet(page);
  await page.locator('.ex-note input').fill('" autofocus onfocus="window.injected=true');
  await page.reload();await expect(page.locator('#appMain')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.injected||false)).toBe(false);
  const second=await context.newPage();await second.goto('/');
  await expect(second.locator('#authErr')).toContainText('another tab');
  await expect(second.locator('#appMain')).toBeHidden();await second.close();
});

test('an already completed draft can be cleared without removing the logged workout', async ({page}) => {
  await signup(page); await addSet(page);
  const stale = await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('sirona-active-user'));
    const cache = JSON.parse(localStorage.getItem('sirona-v2:' + user.id));
    return (cache.pending['draft:active'] || cache.base['draft:active']).data;
  });
  await page.locator('#finishBtn').click();
  await expect(page.locator('#saveStatus')).toHaveText('All changes saved');
  // Reproduce an older device bringing back an unfinished copy of a logged session.
  await page.evaluate(async draft => {
    const user = JSON.parse(localStorage.getItem('sirona-active-user'));
    const response = await fetch('/api/v2/records', {headers:{'X-Sirona-User': user.id}});
    const records = (await response.json()).records;
    const revision = records.find(r => r.key === 'draft:active').revision;
    const saved = await fetch('/api/v2/records/draft:active', {method:'PUT', headers:{'Content-Type':'application/json','X-Sirona-User':user.id},
      body:JSON.stringify({data:draft, revision, mutationId:crypto.randomUUID()})});
    if (!saved.ok) throw new Error('Could not prepare stale draft');
  }, stale);
  await page.reload(); await expect(page.locator('.set-val')).toContainText('50 kg × 8');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('already in your ledger'); await dialog.accept(); });
  await page.locator('#finishBtn').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#newWorkoutBtn').click();
  await expect(page.locator('.set-val')).toHaveCount(0);
  await page.locator('#tab-history').click();
  await expect(page.locator('.h-session')).toHaveCount(1);
  await expect(page.locator('#saveStatus')).toHaveText('All changes saved');
});
