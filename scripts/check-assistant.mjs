// Synthetic local-only conversation against the real provider. No production records.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { assistantChat, acceptSuggestion } from '../assistant.js';
const sqlite=new DatabaseSync(':memory:');
for(const name of ['0001_private_accounts.sql','0002_assistant.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
const prepare=sql=>{const query=(args=[])=>({bind:(...a)=>query(a),first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args),sql,args});return query();};
const DB={prepare,batch:async statements=>{sqlite.exec('BEGIN');try{const results=statements.map(s=>/RETURNING|^SELECT/i.test(s.sql)?{results:sqlite.prepare(s.sql).all(...s.args)}:{results:[],meta:sqlite.prepare(s.sql).run(...s.args)});sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const now=new Date().toISOString();
sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('synthetic','synthetic','synthetic@example.com','test','test',now);
const env={...process.env,DB,AI_ENABLED:'true'},user={id:'synthetic'};
const ask=(message,revision)=>assistantChat(env,user,{message,revision,requestId:crypto.randomUUID(),today:now.slice(0,10),consent:true,includeHistory:false});
try{
 const help=await ask('How do I log a workout in GymSpear?',0);
 if(!help.messages.at(-1)?.content)throw new Error('No app help reply');
 const draft=await ask('Synthetic test: I am an adult beginner, no restrictions, dumbbells and bench, 2 days per week for 30 minutes, goal general strength. Please propose one simple Push session for today with 3 exercises. I will review it before saving.',1);
 if(!draft.proposals.length)throw new Error('No proposed workout returned');
 if(sqlite.prepare('SELECT COUNT(*) n FROM records').get().n!==0)throw new Error('Wrote before approval');
 await acceptSuggestion(env,user,{proposalId:draft.proposals[0].id});
 console.log(JSON.stringify({appHelp:true,planValidated:true,saveAfterApproval:true,workouts:sqlite.prepare('SELECT COUNT(*) n FROM records').get().n,productionDataUsed:false}));
}catch(e){console.error(e.message);process.exitCode=1;}finally{sqlite.close();}
