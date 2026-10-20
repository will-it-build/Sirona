import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordStore } from '../public/sync.js';
const workout = { id: 'one', day: 'Push', date: '2026-10-20T12:00:00Z', entries: [{ exercise: 'Bench', sets: [{ w: 50, r: 8 }] }] };
function memory() { const map=new Map(); return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)}; }
function server() {
  const data = {};
  let failResponse = false;
  const request = async (path, method, body) => {
    if (method === 'GET') return { records: Object.values(data), next: null };
    const key = decodeURIComponent(path.split('/').at(-1));
    if (data[key]?.mutationId === body.mutationId) return {record:data[key]};
    if ((data[key]?.revision || 0) !== body.revision || data[key]?.deleted) throw Object.assign(new Error('Conflict'),{status:409,data:{conflict:true,record:data[key]}});
    data[key] = { ...structuredClone(body), key, revision: body.revision+1 };
    if(failResponse) {failResponse=false; throw new Error('Connection lost after write');}
    return {record:structuredClone(data[key])};
  };
  return {data,request,loseNextResponse(){failResponse=true}};
}
test('offline drafts survive refresh and stay isolated by user', async()=>{
 const storage=memory(), request=async()=>{throw new Error('offline')};
 const a=new RecordStore({id:'a'},storage,request);a.put('draft:active',{day:'Push',entries:workout.entries});await a.sync();
 const reopened=new RecordStore({id:'a'},storage,request);
 assert.equal(reopened.get('draft:active').entries[0].sets[0].w,50);
 assert.equal(new RecordStore({id:'b'},storage,request).get('draft:active'),null);
});
test('lost write response retries once with the same identity',async()=>{
 const remote=server(),store=new RecordStore({id:'a'},memory(),remote.request);
 store.put('session:one',workout);remote.loseNextResponse();await store.sync();assert.equal(Object.keys(store.pending).length,1);
 await store.sync();assert.equal(remote.data['session:one'].revision,1);assert.equal(Object.keys(store.pending).length,0);
});
test('two devices preserve competing edits for explicit resolution',async()=>{
 const remote=server(),a=new RecordStore({id:'a'},memory(),remote.request),b=new RecordStore({id:'a'},memory(),remote.request);
 a.put('session:one',workout);await a.sync();await b.sync();
 a.put('session:one',{...workout,notes:'device A'});b.put('session:one',{...workout,notes:'device B'});
 await a.sync();await b.sync();assert.ok(b.conflicts['session:one']);assert.equal(b.get('session:one').notes,'device B');
 b.resolve('session:one','server');assert.equal(b.get('session:one').notes,'device A');
});
test('stale devices cannot resurrect a deletion; explicit restoration creates a new identity',async()=>{
 const remote=server(),a=new RecordStore({id:'a'},memory(),remote.request),b=new RecordStore({id:'a'},memory(),remote.request);
 a.put('session:one',workout);await a.sync();await b.sync();
 a.put('session:one',null,true);await a.sync();
 b.put('session:one',{...workout,notes:'late edit'});await b.sync();assert.ok(b.conflicts['session:one']);
 b.resolve('session:one','local');await b.sync();
 assert.equal(remote.data['session:one'].deleted,true);
 const restored=b.sessions();assert.equal(restored.length,1);assert.notEqual(restored[0].id,'one');assert.equal(restored[0].notes,'late edit');
});
test('editing during an in-flight save rebases only onto its own acknowledged revision',async()=>{
 const remote=server();let resume,started;
 const ready=new Promise(r=>started=r);
 const store=new RecordStore({id:'a'},memory(),async(...args)=>{
  if(args[1]==='PUT'){started();await new Promise(r=>resume=r);}
  return remote.request(...args);
 });
 store.put('session:one',workout);const running=store.sync();await ready;
 store.put('session:one',{...workout,notes:'typed while saving'});resume();await running;
 assert.equal(store.pending['session:one'].revision,1);assert.equal(store.get('session:one').notes,'typed while saving');assert.equal(Object.keys(store.conflicts).length,0);
});
test('failed local persistence is visible and is never marked safely saved',()=>{
 const store=new RecordStore({id:'a'},{getItem:()=>null,setItem:()=>{throw new Error('quota')}},async()=>{});
 assert.throws(()=>store.put('session:one',workout),/storage is full/);assert.match(store.error,/Keep this page open/);
});
