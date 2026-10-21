import { test, expect } from '@playwright/test';
test('phone assistant consent, safe rendering, plan preview, approval and logout isolation',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const user='ai_'+crypto.randomUUID().slice(0,8);
 await page.goto('/');await page.locator('#authSignupBtn').click();
 await page.locator('#authUser').fill(user);await page.locator('#authEmail').fill(user+'@example.com');
 await page.locator('#authPass').fill('test-long-password');await page.locator('#authPass2').fill('test-long-password');await page.locator('#authGo').click();
 await expect(page.locator('#appMain')).toBeVisible();
 let state={enabled:true,revision:0,messages:[],proposals:[]}; let sends=0,accepted=0;
 await page.route('**/api/v2/assistant**',async route=>{
  const req=route.request();const url=new URL(req.url());
  if(url.pathname.endsWith('/chat')){
   const b=req.postDataJSON();expect(b.consent).toBe(true);expect(b.includeHistory).toBe(false);sends++;
   const plan={id:'11111111-1111-1111-1111-111111111111',title:'A steady start',accepted:false,workouts:[{id:'test-ai-plan',date:new Date().toISOString(),day:'Push',notes:'Start light.',entries:[{exercise:'Wall push-up',note:'2 × 6–10 reps · Rest 90s',sets:[]}]}]};
   state={enabled:true,revision:1,messages:[{role:'user',content:b.message},{role:'assistant',content:'Here is a draft. <img src=x onerror=alert(1)>',proposalId:plan.id}],proposals:[plan]};
  }
  if(url.pathname.endsWith('/accept')){accepted++;state.proposals[0].accepted=true;return route.fulfill({json:{ok:true}});}
  await route.fulfill({json:state});
 });
 await page.locator('#tab-assistant').click();await expect(page.locator('#aiStatus')).toContainText('20 messages');
 await page.getByRole('button',{name:'Build a routine',exact:true}).click();await expect(page.locator('#aiSend')).toBeDisabled();
 await page.locator('#aiConsent').check();await page.locator('#aiSend').click();
 await expect(page.locator('.ai-plan')).toContainText('A steady start');expect(sends).toBe(1);expect(accepted).toBe(0);
 await expect(page.locator('#aiMessages img')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/mobile-assistant.png',fullPage:true});
 await page.getByRole('button',{name:'Add to my plan',exact:true}).click();await expect(page.getByRole('button',{name:'Added to your plan',exact:true})).toBeDisabled();expect(accepted).toBe(1);
 await page.locator('#logoutBtn').click();await expect(page.locator('#aiMessages')).not.toContainText('A steady start');
 expect(errors).toEqual([]);
});
