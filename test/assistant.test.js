import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { assistantChat, assistantState, acceptSuggestion, clearAssistant, validateSuggestion, AI_LIMITS } from '../assistant.js';
import worker from '../worker.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const f of ['0001_private_accounts.sql','0002_assistant.sql'])sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const prepare=s=>{const query=(args=[])=>({bind:(...a)=>query(a),first:async()=>sql.prepare(s).get(...args)||null,
 all:async()=>({results:sql.prepare(s).all(...args)}),run:async()=>({meta:{changes:sql.prepare(s).run(...args).changes}}),sql:s,args});return query();};
 const DB={prepare,batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>/RETURNING|^SELECT/i.test(s.sql)?{results:sql.prepare(s.sql).all(...s.args)}:{results:[],meta:{changes:sql.prepare(s.sql).run(...s.args).changes}});sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 for(const id of ['alice','bob']) sql.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,id+'@example.com','salt','hash',new Date().toISOString());
 const env={DB,AI_ENABLED:'true',QWEN_API_KEY:'sk-test-only',QWEN_BASE_URL:'https://maas.qwencloudapi.com/compatible-mode/v1'};
 return {sql,env,user:{id:'alice'},other:{id:'bob'}};
}
const today=()=>new Date().toISOString().slice(0,10);
const input=(extra={})=>({message:'Make a beginner workout for today.',requestId:crypto.randomUUID(),revision:0,consent:true,includeHistory:false,today:today(),...extra});
const plan=()=>({title:'A steady start',workouts:[{date:today(),day:'Push',notes:'Start light.',exercises:[{name:'Wall push-up',sets:2,repsMin:6,repsMax:10,restSeconds:90,cue:'Move slowly.'}]}]});
const response=(data={reply:'Here is a suggested plan for review.',plan:plan()})=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]}));
test('AI proposals are private, do not write workouts until accepted, and acceptance is idempotent',async()=>{
 const {env,user,other,sql}=fixture(); const s=await assistantChat(env,user,input(),async()=>response());
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM records').get().n,0);assert.equal(s.messages.length,2);
 const id=s.proposals[0].id;
 assert.equal((await assistantState(env,other)).messages.length,0);
 await assert.rejects(acceptSuggestion(env,other,{proposalId:id}),e=>e.status===404);
 await acceptSuggestion(env,user,{proposalId:id});await acceptSuggestion(env,user,{proposalId:id});
 const rows=sql.prepare('SELECT * FROM records').all();assert.equal(rows.length,1);assert.equal(rows[0].user_id,user.id);
 const workout=JSON.parse(rows[0].data);assert.equal(workout.status,'planned');assert.deepEqual(workout.entries[0].sets,[]);
 await clearAssistant(env,user);assert.equal((await assistantState(env,user)).messages.length,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM records').get().n,1);
});
test('consent, kill switch, invalid inputs and stale conversation reject before billing',async()=>{
 const {env,user}=fixture();const fetcher=()=>assert.fail('No paid request');
 await assert.rejects(assistantChat(env,user,input({consent:false}),fetcher),e=>e.status===400);
 await assert.rejects(assistantChat({...env,AI_ENABLED:'false'},user,input(),fetcher),e=>e.status===503);
 await assert.rejects(assistantChat(env,user,input({message:'x'.repeat(1001)}),fetcher),e=>e.status===400);
 await assert.rejects(assistantChat(env,user,input({revision:3}),fetcher),e=>e.status===412);
});
test('only opted-in, user-owned limited exercise data reaches Qwen',async()=>{
 const {env,user,sql}=fixture();
 for(const id of ['alice','bob'])sql.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?)').run(id,'session:fixture',JSON.stringify({id:'fixture',date:today(),day:'Push',status:'done',notes:'private medical note',meta:{bodyweight:107.4},entries:[{exercise:id+' exercise',note:'private note',sets:[{w:20,r:8}]}]}),1,0,crypto.randomUUID(),new Date().toISOString());
 let sent;
 await assistantChat(env,user,input(),async(_u,init)=>{sent=JSON.parse(init.body);return response({reply:'What equipment do you have?',plan:null});});
 assert(!JSON.stringify(sent).includes('alice exercise'));
 await assistantChat(env,user,input({includeHistory:true,revision:1}),async(_u,init)=>{sent=JSON.parse(init.body);return response();});
 const content=JSON.stringify(sent);assert(content.includes('alice exercise'));assert(!content.includes('bob exercise'));assert(!content.includes('private medical note'));assert(!content.includes('107.4'));assert(!content.includes('private note'));
});
test('concurrent requests and duplicate request IDs cannot multiply paid calls',async()=>{
 const {env,user}=fixture();let release;let calls=0;const firstInput=input();
 const first=assistantChat(env,user,firstInput,async()=>{calls++;await new Promise(r=>release=r);return response();});
 while(!release)await new Promise(r=>setImmediate(r));
 await assert.rejects(assistantChat(env,user,input(),async()=>{calls++;return response();}),e=>e.status===429);
 release();await first;
 await assert.rejects(assistantChat(env,user,{...firstInput,revision:1},async()=>{calls++;return response();}),e=>e.status===429);
 assert.equal(calls,1);
});
test('user/day, global/day and monthly ceilings each block calls, including failed reservations',async()=>{
 for(const scope of ['userDay','globalDay','globalMonth']){
  const {env,user,sql}=fixture();const month=today().slice(0,7);const time=scope==='globalMonth'?month+'-01T00:00:00.000Z':new Date().toISOString();
  // On the first day monthly fixture also hits daily cap; either must fail closed.
  for(let i=0;i<AI_LIMITS[scope];i++)sql.prepare('INSERT INTO ai_requests VALUES (?,?,?,?)').run(scope==='userDay'?'alice':'bob',crypto.randomUUID(),time,'failed');
  await assert.rejects(assistantChat(env,user,input(),()=>assert.fail('Quota must block before provider')),e=>e.status===429);
 }
});
test('clearing a chat during an in-flight reply cannot restore deleted chat or suggestions',async()=>{
 const {env,user}=fixture();let release;
 const pending=assistantChat(env,user,input(),async()=>{await new Promise(r=>release=r);return response();});
 while(!release)await new Promise(r=>setImmediate(r));await clearAssistant(env,user);release();
 await assert.rejects(pending,e=>e.status===412);
 const state=await assistantState(env,user);assert.deepEqual(state.messages,[]);assert.deepEqual(state.proposals,[]);
});
test('malformed plans, impossible dates and dangerous numeric targets are rejected',()=>{
 for(const mutate of [p=>p.workouts[0].date='2026-02-30',p=>p.workouts[0].exercises[0].sets=900,p=>p.workouts[0].exercises[0].repsMin=-1,p=>p.workouts[0].day='Delete',p=>p.workouts[0].exercises[0].name='']){
  const p=plan();mutate(p);assert.throws(()=>validateSuggestion(p,today()));
 }
});
test('AI HTTP routes require authentication and same-origin requests',async()=>{
 const {env}=fixture();
 for(const path of ['/api/v2/assistant','/api/v2/assistant/accept']){
 const r=await worker.fetch(new Request('https://gymspear.com'+path),env);assert.equal(r.status,401);}
 const r=await worker.fetch(new Request('https://gymspear.com/api/v2/assistant/chat',{method:'POST',headers:{Origin:'https://evil.example'}}),env);assert.equal(r.status,403);
});
test('provider failures keep quota reservation without changing records or chat',async()=>{
 const {env,user,sql}=fixture();await assert.rejects(assistantChat(env,user,input(),async()=>new Response('private error',{status:500})),e=>e.status===502&&!e.message.includes('private'));
 assert.equal(sql.prepare('SELECT state FROM ai_requests').get().state,'failed');assert.equal((await assistantState(env,user)).messages.length,0);
});
test('follow-up planning includes the prior proposal for collaborative revisions',async()=>{
 const {env,user}=fixture();await assistantChat(env,user,input(),async()=>response());
 await assistantChat(env,user,input({message:'Make this easier.',revision:1}),async(_url,init)=>{
  const payload=JSON.parse(init.body);const context=JSON.parse(payload.messages[1].content);
  assert.equal(context.lastProposedPlan.title,'A steady start');assert.equal(context.lastProposedPlan.workouts[0].entries[0].exercise,'Wall push-up');
  return response({reply:'Try fewer reps, staying comfortable.',plan:null});
 });
});
