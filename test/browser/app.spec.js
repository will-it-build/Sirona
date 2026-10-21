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

test('planner separates earlier plans; history searches and filters newest first', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await signup(page);
  await page.evaluate(async () => {
    const user = JSON.parse(localStorage.getItem('sirona-active-user'));
    const date = offset => { const d = new Date(); d.setDate(d.getDate()+offset); d.setHours(12,0,0,0); return d.toISOString(); };
    const records = [
      {id:'old-plan',day:'Push',status:'planned',date:date(-60)},
      {id:'recent-plan',day:'Pull',status:'planned',date:date(-2)},
      {id:'today-plan',day:'Legs',status:'planned',date:date(0)},
      {id:'later-plan',day:'Pull',status:'planned',date:date(20)},
      {id:'old-workout',day:'Push',status:'done',date:date(-30),exercise:'Bench press'},
      {id:'recent-workout',day:'Pull',status:'done',date:date(-1),exercise:'Dumbbell row'},
      {id:'rest-plan',day:'Rest',status:'planned',date:date(-3)},
    ];
    for(const record of records){
      const {exercise,...data} = record;
      data.entries = record.day === 'Rest' ? [] : [{exercise:exercise||'Example exercise',group:'Chest',sets:record.status==='done'?[{w:40,r:8}]:[],note:''}];
      const result = await fetch('/api/v2/records/session:'+record.id,{method:'PUT',headers:{'Content-Type':'application/json','X-Sirona-User':user.id},body:JSON.stringify({data,revision:0,mutationId:crypto.randomUUID()})});
      if(!result.ok) throw new Error('Fixture failed: '+result.status);
    }
  });
  await page.reload(); await expect(page.locator('#appMain')).toBeVisible();
  await page.locator('#tab-week').click();
  await expect(page.locator('#todayPlanList .record-row').first()).toHaveAttribute('data-row','today-plan');
  await expect(page.locator('[data-row="old-plan"]')).toHaveCount(0);
  await expect(page.locator('[data-row="later-plan"]')).toHaveCount(1);
  await page.screenshot({path:'test-results/mobile-plan.png',fullPage:true});
  await page.locator('#earlierPlans').click();
  await expect(page.locator('#todayPlanList .record-row').first()).toHaveAttribute('data-row','today-plan');
  await expect(page.locator('#earlierPlans')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#weekList .record-row').first()).toHaveAttribute('data-row','recent-plan');
  const recent = page.locator('[data-row="recent-plan"]');
  await recent.locator('summary').click();
  await expect(recent.getByRole('button',{name:'Start workout'})).toBeVisible();
  await page.evaluate(()=>window.renderWeek());
  await expect(recent).toHaveAttribute('open','');
  await expect(recent.locator('summary')).toBeFocused();
  await page.locator('[data-row="rest-plan"] summary').click();
  await expect(page.locator('[data-row="rest-plan"]').getByRole('button',{name:'Start workout'})).toHaveCount(0);
  await page.screenshot({path:'test-results/mobile-earlier-plans.png',fullPage:true});
  await page.locator('#upcomingPlans').click();
  await expect(page.locator('#upcomingPlans')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-row="recent-plan"]')).toHaveCount(0);
  await expect(page.locator('#todayPlanList .record-row').first()).toHaveAttribute('data-row','today-plan');
  await page.locator('#tab-history').click();
  await expect(page.locator('.h-session').first()).toHaveAttribute('data-row','recent-workout');
  await page.locator('#historySearch').fill('bench');
  await expect(page.locator('.h-session')).toHaveCount(1);
  await expect(page.locator('.h-session')).toHaveAttribute('data-row','old-workout');
  await page.locator('#historyType').selectOption('Pull');
  await expect(page.locator('#historyList')).toContainText('No matching sessions');
  await page.locator('#historySearch').fill('');
  await expect(page.locator('.h-session')).toHaveAttribute('data-row','recent-workout');
  await page.locator('#historyType').selectOption('');
  await page.locator('.h-session').first().locator('summary').click();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile-history.png',fullPage:true});
});
