const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

async function harness(count=3) {
  const store=new Map(), queued=[], writes=[], values=new Map(), excluded=new Set();
  let deny=false, queueFail=false;
  const policy={id:'p',revision:'r',status:'draft',behaviorType:'assessment',projectIds:['1'],targetFieldId:'target',runtime:{expression:'true',compiledTargetValue:9}};
  store.set('field-policies:v1',[policy]);
  const jira={
    searchTargetPage:async(jql,token)=>{
      const offset=Number(token||0),end=Math.min(offset+25,count);
      return {targets:Array.from({length:end-offset},(_,i)=>({key:`ABC-${i+offset+1}`})),nextPageToken:end<count?String(end):undefined};
    },
    evaluate:async key=>!excluded.has(key),
    readIssue:async key=>({fields:{target:values.get(key)}}),
    editmeta:async()=>({fields:deny?{}:{target:{schema:{type:'number'}}}}),
    write:async(key,field,value)=>{writes.push({key,field,value});values.set(key,value);}
  };
  const mocks={'@forge/kvs':{kvs:{get:async key=>structuredClone(store.get(key)),set:async(key,value)=>store.set(key,structuredClone(value)),delete:async key=>store.delete(key)}},'@forge/events':{Queue:class{async push(item){if(queueFail)throw new Error('queue unavailable');queued.push(item);}}},'./relationship-worker':{jiraAccess:()=>jira,calculateTarget:async(p,key)=>({current:values.get(key),value:9})}};
  const context=vm.createContext({crypto:{randomUUID},console});
  const mod=new vm.SourceTextModule(fs.readFileSync('src/runtime/population.js','utf8'),{context});
  await mod.link(async name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await mod.evaluate();
  const m=mod.namespace;
  const drain=async()=>{let n=0;while(queued.length){if(++n>500)throw new Error('unbounded queue');await m.runPopulationJob(queued.shift());}};
  const activate=async id=>{policy.status='active';store.set('field-policies:v1',[structuredClone(policy)]);await m.startPopulation(await m.readPopulation(id));};
  return {m,store,queued,writes,values,excluded,policy,drain,activate,deny:v=>deny=v,failQueue:v=>queueFail=v};
}

test('population selection is scoped, defaults to excluding Done and accepts explicit inclusion',async()=>{
 const h=await harness();assert.match(h.m.populationSelection(h.policy,{mode:'all'}).jql,/project in \("1"\).*statusCategory != Done/);
 assert.doesNotMatch(h.m.populationSelection(h.policy,{mode:'all',includeDone:true}).jql,/statusCategory/);
 h.policy.skipDoneTargets=true;assert.match(h.m.populationSelection(h.policy,{mode:'all',includeDone:true}).jql,/statusCategory != Done/);
 assert.throws(()=>h.m.populationSelection(h.policy,{mode:'keys',keys:'ABC-1) OR project=2'}));
 const jql=h.m.populationSelection(h.policy,{mode:'dates',from:'2026-09-01',to:'2026-09-24'}).jql;
 assert.match(jql,/created >= "2026-09-01" AND created < "2026-09-25"/);
 assert.throws(()=>h.m.populationSelection(h.policy,{mode:'dates',from:'2026-02-30',to:'2026-03-01'}));
});
test('preparation counts all 61 targets without writing; activation uses fixed list',async()=>{
 const h=await harness(61),run=await h.m.createPopulation(h.policy,{mode:'all'});await h.drain();
 const prepared=await h.m.readPopulation(run.id);assert.equal(prepared.total,61);assert.equal(prepared.phase,'ready');assert.equal(h.writes.length,0);
 await h.activate(run.id);await h.drain();assert.equal(h.writes.length,61);assert.equal((await h.m.readPopulation(run.id)).phase,'complete');
});
test('Done and equivalent targets are skipped for both assessment and relationship',async()=>{
 for(const type of ['assessment','relationship']){
 const h=await harness();h.policy.behaviorType=type;h.store.set('field-policies:v1',[h.policy]);
 const run=await h.m.createPopulation(h.policy,{mode:'all'});await h.drain();h.excluded.add('ABC-1');h.values.set('ABC-2',9);
 await h.activate(run.id);await h.drain();const result=await h.m.readPopulation(run.id);
 assert.equal(result.skipped,1);assert.equal(result.unchanged,1);assert.equal(result.updated,1);assert.equal(h.writes[0].field,'target');assert.equal(h.writes[0].key,'ABC-3');
 }
});
test('deactivation and revision changes cancel population before writes',async()=>{
 for(const revision of [false,true]){const h=await harness(),run=await h.m.createPopulation(h.policy,{mode:'all'});await h.drain();await h.activate(run.id);
 if(revision)h.policy.revision='new';else h.policy.status='validated';h.store.set('field-policies:v1',[h.policy]);await h.drain();assert.equal(h.writes.length,0);assert.equal((await h.m.readPopulation(run.id)).phase,'cancelled');}
});
test('failure pauses at target and retry resumes with unchanged suppression',async()=>{
 const h=await harness(),run=await h.m.createPopulation(h.policy,{mode:'all'});await h.drain();await h.activate(run.id);h.deny(true);await h.drain();
 let result=await h.m.readPopulation(run.id);assert.equal(result.phase,'error');assert.equal(result.offset,0);assert.equal(h.writes.length,0);
 h.deny(false);await h.m.startPopulation(result);await h.drain();result=await h.m.readPopulation(run.id);assert.equal(result.phase,'complete');assert.equal(h.writes.length,3);
});
test('empty selection completes and replaced snapshot is cleaned',async()=>{
 const h=await harness(0),old=await h.m.createPopulation(h.policy,{mode:'all'});await h.drain();const run=await h.m.createPopulation(h.policy,{mode:'all'});await h.drain();assert.equal(await h.m.readPopulation(old.id),undefined);
 await h.activate(run.id);await h.drain();assert.equal((await h.m.readPopulation(run.id)).phase,'complete');assert.equal(h.writes.length,0);
});
test('queue outage is exposed without pretending population started',async()=>{
 const h=await harness();h.failQueue(true);const run=await h.m.createPopulation(h.policy,{mode:'all'});assert.equal(run.phase,'error');assert.equal(h.writes.length,0);
});

test('reactivation at same revision cancels an old pending population',async()=>{
 const h=await harness(),run=await h.m.createPopulation(h.policy,{mode:'all'});await h.drain();
 h.policy.activatedAt='first';await h.activate(run.id);h.policy.activatedAt='second';h.store.set('field-policies:v1',[h.policy]);
 await h.drain();assert.equal(h.writes.length,0);assert.equal((await h.m.readPopulation(run.id)).phase,'cancelled');
});
