const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
async function harness(targetCount=1,split=false){
 const context=vm.createContext({console:{info(){},warn(){}},crypto:{randomUUID}}),store=new Map(),writes=[],queued=[],writeBodies=[],requests=[];
 let points=11,target=3,linked=true,editable=true,matching=true,eligible=true,putStatus=200,pushFailure=false,deleteFailure=false,onPut=null,queryVisible=true,routedTargets=1;
 const targetValues=new Map();
 const policy={id:'p',revision:'r',name:'Rollup',status:'active',behaviorType:'relationship',projectIds:['1'],sourceProjectIds:['2'],targetFieldId:'customfield_2',sourceFieldId:'customfield_1',aggregation:'sum',filters:[],runtime:{plan:{sourceProjectIds:['2'],targetProjectIds:['1'],sourceFieldIds:['customfield_1','status','parent','issuetype','project'],targetFieldIds:['customfield_2'],linkTypeId:'7',relatedIssueTypeIds:['9'],hierarchyDepth:1,maxTargets:50}}};store.set('field-policies:v1',[policy]);
 const requestJira=async(url,options={})=>{
 requests.push({url,options});
 let data={};
 if(url.includes('/expression/evaluate')){assert.match(JSON.parse(options.body).expression,/issue\.(status.category.key|project.id)/);data={value:eligible};}
 else if(url.includes('/search/jql')){
  const q=JSON.parse(options.body).jql;
  if(q.startsWith('project in')){
   const offset=Number(JSON.parse(options.body).nextPageToken||0),end=Math.min(offset+25,targetCount);
   data={issues:Array.from({length:end-offset},(_,i)=>({key:'IDEA-'+(offset+i+1),fields:{project:{id:'1'}}})),isLast:end===targetCount,...(end<targetCount?{nextPageToken:String(end)}:{})};
  }
  else if(q.includes('issuetype in'))data={issues:[{key:'ABC-2',fields:{project:{id:'2'}}}]};
  else if(q.startsWith('parent in'))data={issues:[{key:'ABC-1',fields:{parent:{key:'ABC-2'}}}]};
  else if(q.includes('project in ("1")'))data={issues:Array.from({length:routedTargets},(_,i)=>({key:'IDEA-'+(i+1),fields:{project:{id:'1'}}}))};
  else data={issues:matching?[{key:'ABC-1',fields:{customfield_1:points}}]:[]};
 }else if(url.endsWith('/editmeta'))data={fields:editable?{customfield_2:{schema:{type:'number'}},customfield_3:{schema:{type:'number'}}}:{}};
 else if(options.method==='PUT'){if(putStatus!==200)return {ok:false,status:putStatus};const fields=JSON.parse(options.body).fields;writeBodies.push(fields);writes.push(fields.customfield_2);targetValues.set(url.split('/issue/')[1],fields);if(onPut)await onPut(url);}
 else if(url.includes('/issue/IDEA-'))data={key:url.split('/issue/')[1].split('?')[0],fields:{project:{id:'1'},customfield_2:target,customfield_3:target,...targetValues.get(url.split('/issue/')[1].split('?')[0]),issuelinks:linked?[{type:{id:'7'},outwardIssue:{key:'ABC-2'}}]:[]}};
 else if(url.includes('/issue/ABC-1'))data={key:'ABC-1',fields:{project:{id:'2'},parent:{key:'ABC-2'}}};
 else data={key:'ABC-2',fields:{project:{id:'2'},issuelinks:Array.from({length:routedTargets},(_,i)=>({type:{id:'7'},inwardIssue:{key:'IDEA-'+(i+1)}}))}};
 return {ok:true,status:200,json:async()=>data};
 };
 const mocks={'@forge/api':{default:{asApp:()=>({requestJira}),asUser:()=>({requestJira})},route:(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'')},'@forge/kvs':{WhereConditions:{beginsWith:value=>value},kvs:{query:()=>{let prefix='',size=10;const q={where:(field,value)=>{prefix=value;return q;},limit:value=>{size=value;return q;},getMany:async()=>({results:queryVisible?[...store].filter(([key])=>key.startsWith(prefix)).slice(0,size).map(([key,value])=>({key,value:structuredClone(value)})):[]})};return q;},get:async k=>structuredClone(store.get(k)),set:async(k,v)=>store.set(k,structuredClone(v)),delete:async k=>{if(deleteFailure){deleteFailure=false;throw new Error("checkpoint unavailable");}store.delete(k);}}},'@forge/events':{Queue:class{async push(item){if(pushFailure)throw new Error("queue unavailable");queued.push(item);}}}};
 const cache=new Map();async function load(filename){if(cache.has(filename))return cache.get(filename);const mod=new vm.SourceTextModule(fs.readFileSync(filename,'utf8').replace('const SEPARATE_DISCOVERY = false;',`const SEPARATE_DISCOVERY = ${split};`),{context,identifier:filename});cache.set(filename,mod);await mod.link(async(n,parent)=>{if(mocks[n])return new vm.SyntheticModule(Object.keys(mocks[n]),function(){for(const[k,v]of Object.entries(mocks[n]))this.setExport(k,v);},{context});return load(path.resolve(path.dirname(parent.identifier),n+'.js'));});return mod;}
 const mod=await load(path.resolve('src/runtime/relationship-worker.js'));await mod.evaluate();
 const population=await load(path.resolve('src/runtime/population.js'));await population.evaluate();
 return {m:{...mod.namespace,runRelationshipJob:async event=>{
 await mod.namespace.runRelationshipJob(event);
 let count=0;
 while(queued.length){if(++count>1000)throw new Error('Queue did not drain');await mod.namespace.runRelationshipJob({body:queued.shift().body});}
 }},population:population.namespace,raw:mod.namespace,policy,store,writes,queued,writeBodies,requests,setRoutedTargets:v=>routedTargets=v,setQueryVisible:v=>queryVisible=v,setPutStatus:v=>putStatus=v,setPushFailure:v=>pushFailure=v,failDelete:()=>deleteFailure=true,onPut:fn=>onPut=fn,setPoints:v=>points=v,setTarget:v=>{target=v;targetValues.clear();},unlink:()=>linked=false,deny:()=>editable=false,setEligible:v=>eligible=v,setMatching:v=>matching=v};
}
const update={body:{eventType:'avi:jira:updated:issue',projectId:'2',key:'ABC-1',changedFields:['customfield_1']}};
test('story points update writes target once; duplicate event is a no-op',async()=>{const h=await harness();await h.m.runRelationshipJob(update);assert.deepEqual(h.writes,[11]);await h.m.runRelationshipJob(update);assert.deepEqual(h.writes,[11]);});
test('link removal recalculates old target to zero',async()=>{const h=await harness();h.unlink();await h.m.runRelationshipJob({body:{eventType:'avi:jira:deleted:issuelink',projectId:'2',destinationProjectId:'1',linkTypeId:'7',changedFields:[]}});assert.deepEqual(h.writes,[0]);});
test('deactivation prevents queued work and unrelated updates do not write',async()=>{const h=await harness();await h.m.runRelationshipJob({body:{...update.body,changedFields:['summary']}});assert.equal(h.writes.length,0);h.policy.status='validated';h.store.set('field-policies:v1',[h.policy]);await h.m.runRelationshipJob(update);assert.equal(h.writes.length,0);});
test('uneditable target fails without writing',async()=>{const h=await harness();h.deny();await h.m.runRelationshipJob(update);assert.equal(h.writes.length,0);assert.ok([...h.store.values()].some(value=>value?.outcome==='error' && value.message.includes('editable')));});
test('projection indexes link type and both project directions',async()=>{const h=await harness();const source=h.m.projectDependencies('2',[h.policy]),target=h.m.projectDependencies('1',[h.policy]);assert.deepEqual(Array.from(source.linkRoutes),['7:1']);assert.deepEqual(Array.from(target.linkRoutes),['7:2']);assert.ok(source.fieldIds.includes('customfield_1'));});
test('ingress serializes identifiers without field values',async()=>{const h=await harness();await h.m.enqueueRelationshipEvent({eventType:'avi:jira:updated:issue',issue:{key:'ABC-1',fields:{project:{id:'2'},description:'private'}},changelog:{items:[{fieldId:'customfield_1',toString:'11'}]}});assert.equal(h.queued[0].concurrency.limit,1);assert.equal(JSON.stringify(h.queued[0]).includes('private'),false);});

test('leaving a status filter removes contribution and empty points contribute zero',async()=>{
 const h=await harness();h.policy.filters=[{fieldId:'statusCategory',operator:'equals',value:'To Do'}];h.store.set('field-policies:v1',[h.policy]);h.setMatching(false);
 await h.m.runRelationshipJob({body:{...update.body,changedFields:['status']}});assert.deepEqual(h.writes,[0]);
 h.setTarget(3);h.setMatching(true);h.setPoints(null);await h.m.runRelationshipJob(update);assert.deepEqual(h.writes,[0,0]);
});
test('protected target recalculates after external override and records restoration',async()=>{
 const h=await harness();h.policy.protect=true;h.store.set('field-policies:v1',[h.policy]);h.setTarget(99);
 await h.m.runRelationshipJob({body:{...update.body,projectId:'1',key:'IDEA-1',changedFields:['customfield_2']}});
 assert.deepEqual(h.writes,[11]);assert.ok([...h.store.values()].some(value=>value?.outcome==='restored'));
});
test('parent move and deletion use full bounded target reconciliation',async()=>{
 for(const body of [{...update.body,changedFields:['parent']},{...update.body,eventType:'avi:jira:deleted:issue'}]){
 const h=await harness();h.unlink();await h.m.runRelationshipJob({body});assert.deepEqual(h.writes,[0]);
 }
});

test('structural reconciliation processes all 61 targets across continuation pages',async()=>{
 const h=await harness(61);await h.m.runRelationshipJob({body:{...update.body,eventType:'avi:jira:created:issue'}});
 assert.equal(h.writes.length,61);assert.ok(h.writes.every(value=>value===11));
});
test('queued target job from an old revision cannot write',async()=>{
 const h=await harness();await h.raw.runRelationshipJob({body:{...update.body,eventType:'avi:jira:created:issue'}});assert.equal(h.writes.length,0);
 h.policy.revision='new';h.store.set('field-policies:v1',[h.policy]);
 await h.raw.runRelationshipJob({body:h.queued[0].body});assert.equal(h.writes.length,0);
});

test('future Done-target protection skips writes and reopening can recalculate',async()=>{
 const h=await harness();h.policy.skipDoneTargets=true;h.store.set('field-policies:v1',[h.policy]);h.setEligible(false);
 await h.m.runRelationshipJob(update);assert.equal(h.writes.length,0);
 h.setEligible(true);await h.m.runRelationshipJob(update);assert.deepEqual(h.writes,[11]);
});

test('ordinary updates use one pending target job with ingress timing',async()=>{
 const h=await harness();await h.raw.runRelationshipJob({body:{...update.body,receivedAt:Date.now()-100}});
 assert.equal(h.writes.length,0);assert.equal(h.queued.length,1);
 await h.m.runRelationshipJob({body:h.queued.shift().body});
 const record=[...h.store.values()].find(v=>v?.outcome==='changed');
 assert.ok(record.sinceIngressMs>=100);assert.ok(record.beforeJobMs>=100);
});
test('two policies share hierarchy reads and write two target fields in one Jira edit',async()=>{
 const h=await harness();const second=structuredClone(h.policy);second.id='second';second.targetFieldId='customfield_3';
 h.store.set('field-policies:v1',[h.policy,second]);
 await h.raw.runRelationshipJob(update);assert.equal(h.queued.length,1);
 await h.m.runRelationshipJob({body:h.queued.shift().body});
 assert.deepEqual(h.writeBodies,[{customfield_2:11,customfield_3:11}]);
 assert.equal(h.requests.filter(r=>r.url.endsWith('/editmeta')).length,1);
 assert.equal(h.requests.filter(r=>r.options.body?.includes('parent in')).length,1);
 const records=[...h.store.values()].filter(v=>v?.outcome==='changed');
 assert.equal(new Set(records.map(v=>v.batchId)).size,1);
});
test('ingress adds no artificial delay and keeps the shared writer lock',async()=>{
 const h=await harness();await h.raw.enqueueRelationshipEvent({eventType:'avi:jira:updated:issue',issue:{key:'ABC-1',fields:{project:{id:'2'}}}});
 assert.equal(h.queued[0].delayInSeconds,undefined);assert.equal(h.queued[0].concurrency.key,'relationship-writes-v1');
 assert.equal(typeof h.store.get(h.queued[0].body.inboxId).receivedAt,'number');
});

test('100 pending source updates collapse into one target calculation and final write',async()=>{
 const h=await harness();
 for(let n=1;n<=100;n++){h.setPoints(n);await h.raw.runRelationshipJob({body:{...update.body,key:'ABC-'+n}});}
 assert.equal(h.queued.length,1);assert.equal(h.writes.length,0);
 await h.m.runRelationshipJob({body:h.queued.shift().body});
 assert.deepEqual(h.writeBodies,[{customfield_2:100}]);
 assert.equal(h.requests.filter(r=>r.options.body?.includes('parent in')).length,1);
 assert.equal([...h.store.values()].find(v=>v?.outcome==='changed').mergedSignals,100);
 assert.equal(h.store.has('relationship-pending:v1:IDEA-1'),false);
});
test('failed member prevents every field in the consolidated write',async()=>{
 const h=await harness();const second=structuredClone(h.policy);second.id='second';second.targetFieldId='customfield_3';second.projectIds=['other'];
 // The second invalid scope must not let the already calculated first policy write alone.
 h.store.set('field-policies:v1',[h.policy,second]);
 await h.raw.runRelationshipJob(update);
 await h.raw.runRelationshipJob({body:h.queued.shift().body}).catch(()=>{});
 assert.equal(h.writes.length,0);assert.ok([...h.store.values()].some(v=>v?.outcome==='error'));
});
test('duplicate flush cannot consume a newer target generation',async()=>{
 const h=await harness();await h.raw.runRelationshipJob(update);const old=h.queued.shift();
 await h.raw.runRelationshipJob({body:old.body});h.setPoints(14);
 await h.raw.runRelationshipJob(update);await h.raw.runRelationshipJob({body:old.body});
 assert.deepEqual(h.writes,[11]);await h.m.runRelationshipJob({body:h.queued.shift().body});assert.deepEqual(h.writes,[11,14]);
});
test('event received during a target write is processed in a follow-up',async()=>{
 const h=await harness();h.onPut(()=>{h.setPoints(15);h.queued.push(update);});
 await h.raw.runRelationshipJob(update);const flush=h.queued.shift();
 await h.raw.runRelationshipJob({body:flush.body});h.onPut(null);
 await h.m.runRelationshipJob(h.queued.shift());assert.deepEqual(h.writes,[11,15]);
});
test('transient Jira failure retains pending work and retries current values',async()=>{
 const h=await harness();await h.raw.runRelationshipJob(update);const job=h.queued.shift();h.setPutStatus(429);
 await assert.rejects(()=>h.raw.runRelationshipJob({body:job.body}),/429/);assert.equal(h.writes.length,0);
 h.setPutStatus(200);h.setPoints(19);await h.raw.runRelationshipJob({body:job.body});assert.deepEqual(h.writes,[19]);
});
test('queue dispatch failure is recoverable without losing pending work',async()=>{
 const h=await harness();h.setPushFailure(true);await assert.rejects(()=>h.raw.runRelationshipJob(update),/queue/);
 h.setPushFailure(false);await h.m.runRelationshipJob(update);assert.deepEqual(h.writes,[11]);
});
test('write followed by checkpoint failure retries without a duplicate write',async()=>{
 const h=await harness();await h.raw.runRelationshipJob(update);const job=h.queued.shift();h.failDelete();
 await assert.rejects(()=>h.raw.runRelationshipJob({body:job.body}),/checkpoint/);
 await h.raw.runRelationshipJob({body:job.body});assert.deepEqual(h.writes,[11]);
});
test('deactivated and reactivated policy cannot use the old pending activation',async()=>{
 const h=await harness();h.policy.activatedAt='first';h.store.set('field-policies:v1',[h.policy]);
 await h.raw.runRelationshipJob(update);h.policy.activatedAt='second';h.store.set('field-policies:v1',[h.policy]);
 await h.m.runRelationshipJob({body:h.queued.shift().body});assert.equal(h.writes.length,0);
});

test('conflicting field owners fail the whole batch instead of last writer wins',async()=>{
 const h=await harness();const second=structuredClone(h.policy);second.id='second';h.store.set('field-policies:v1',[h.policy,second]);
 await h.m.runRelationshipJob(update);assert.equal(h.writes.length,0);
 assert.ok([...h.store.values()].some(v=>v?.outcome==='error'&&v.message.includes('Conflicting')));
});
test('non-FIFO flush delivery still converges after later source events',async()=>{
 const h=await harness();await h.raw.runRelationshipJob(update);const first=h.queued.shift();
 await h.raw.runRelationshipJob({body:first.body});h.setPoints(22);
 await h.raw.runRelationshipJob(update);await h.m.runRelationshipJob({body:h.queued.shift().body});
 assert.deepEqual(h.writes,[11,22]);
});

test('a later event reschedules an old pending flush without trusting FIFO',async()=>{
 const h=await harness();await h.raw.runRelationshipJob(update);const old=h.queued.shift();
 const pending=h.store.get('relationship-pending:v1:IDEA-1');pending.scheduledAt=Date.now()-6*60*1000;
 await h.raw.runRelationshipJob(update);assert.equal(h.queued.length,1);
 await h.m.runRelationshipJob({body:h.queued.shift().body});await h.raw.runRelationshipJob({body:old.body});assert.deepEqual(h.writes,[11]);
});
test('different calculations still produce one fields map and no extra write on replay',async()=>{
 const h=await harness();const second=structuredClone(h.policy);second.id='count';second.targetFieldId='customfield_3';second.aggregation='count';
 h.store.set('field-policies:v1',[h.policy,second]);await h.m.runRelationshipJob(update);
 assert.deepEqual(h.writeBodies,[{customfield_2:11,customfield_3:1}]);await h.m.runRelationshipJob(update);assert.equal(h.writeBodies.length,1);
});

const sourceEvent=n=>({eventType:'avi:jira:updated:issue',issue:{key:'ABC-'+n,fields:{project:{id:'2'}}},changelog:{items:[{fieldId:'customfield_1'}]}});
test('single live ingress calculates both fields without scheduling another competing worker',async()=>{
 const h=await harness();const second=structuredClone(h.policy);second.id='second';second.targetFieldId='customfield_3';h.store.set('field-policies:v1',[h.policy,second]);
 await h.raw.enqueueRelationshipEvent(sourceEvent(1));const wake=h.queued.shift();
 await h.raw.runRelationshipJob({body:wake.body});assert.equal(h.queued.length,0);
 assert.deepEqual(h.writeBodies,[{customfield_2:11,customfield_3:11}]);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('relationship-inbox:')).length,0);
});
test('100 live ingress records drain in batches of ten, not 100 full rollups',async t=>{
 const h=await harness();h.setPoints(100);
 for(let n=1;n<=100;n++)await h.raw.enqueueRelationshipEvent(sourceEvent(n));
 await h.m.runRelationshipJob({body:h.queued.shift().body});
 assert.deepEqual(h.writeBodies,[{customfield_2:100}]);
 assert.equal(h.requests.filter(r=>r.options.body?.includes('parent in')).length,10);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('relationship-inbox:')).length,0);
 t.diagnostic('100 ingress messages: 10 hierarchy calculations, 1 changed target write; mocked workload, not live throughput.');
});
test('prefix query lag cannot lose the waking event',async()=>{
 const h=await harness();h.setQueryVisible(false);await h.raw.enqueueRelationshipEvent(sourceEvent(1));
 await h.m.runRelationshipJob({body:h.queued.shift().body});assert.deepEqual(h.writes,[11]);
});
test('ingress queue failure leaves a durable record recoverable by a later wake',async()=>{
 const h=await harness();h.setPushFailure(true);await assert.rejects(()=>h.raw.enqueueRelationshipEvent(sourceEvent(1)),/queue/);
 h.setPushFailure(false);await h.raw.enqueueRelationshipEvent(sourceEvent(2));await h.m.runRelationshipJob({body:h.queued.shift().body});
 assert.deepEqual(h.writes,[11]);assert.equal([...h.store.keys()].filter(k=>k.startsWith('relationship-inbox:')).length,0);
});
test('an event arriving during inline write retains its own wake and converges',async()=>{
 const h=await harness();let incoming;
 h.onPut(()=>{h.setPoints(23);incoming=h.raw.enqueueRelationshipEvent(sourceEvent(2));});
 await h.raw.enqueueRelationshipEvent(sourceEvent(1));await h.raw.runRelationshipJob({body:h.queued.shift().body});
 await incoming;h.onPut(null);await h.m.runRelationshipJob({body:h.queued.shift().body});assert.deepEqual(h.writes,[11,23]);
});
test('inline transient failure preserves inbox until successful replay',async()=>{
 const h=await harness();await h.raw.enqueueRelationshipEvent(sourceEvent(1));const wake=h.queued.shift();h.setPutStatus(429);
 await assert.rejects(()=>h.raw.runRelationshipJob({body:wake.body}),/429/);assert.ok(h.store.has(wake.body.inboxId));
 h.setPutStatus(200);await h.raw.runRelationshipJob({body:wake.body});assert.deepEqual(h.writes,[11]);assert.equal(h.store.has(wake.body.inboxId),false);
});

test('three related targets complete in the ingress worker without another queue handoff',async()=>{
 const h=await harness();h.setRoutedTargets(3);await h.raw.enqueueRelationshipEvent(sourceEvent(1));
 await h.raw.runRelationshipJob({body:h.queued.shift().body});assert.equal(h.writes.length,3);assert.equal(h.queued.length,0);
});
test('targets beyond the inline limit remain durably queued and complete',async()=>{
 const h=await harness();h.setRoutedTargets(5);await h.raw.enqueueRelationshipEvent(sourceEvent(1));
 await h.raw.runRelationshipJob({body:h.queued.shift().body});assert.equal(h.writes.length,3);assert.equal(h.queued.length,2);
 await h.m.runRelationshipJob({body:h.queued.shift().body});assert.equal(h.writes.length,5);
});


test('distinct inline targets overlap with a maximum of two writers',async()=>{
 const h=await harness();h.setRoutedTargets(3);let active=0,peak=0;
 h.onPut(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;});
 await h.raw.enqueueRelationshipEvent(sourceEvent(1));await h.raw.runRelationshipJob({body:h.queued.shift().body});
 assert.equal(peak,2);assert.equal(active,0);assert.equal(h.writes.length,3);
});
test('inline failure waits for its sibling and replays only incomplete targets',async()=>{
 const h=await harness();h.setRoutedTargets(3);let siblingFinished=false;
 h.onPut(async url=>{if(url.endsWith('IDEA-1'))throw new Error('transport lost');await new Promise(resolve=>setTimeout(resolve,10));siblingFinished=true;});
 await h.raw.enqueueRelationshipEvent(sourceEvent(1));const wake=h.queued.shift();
 await assert.rejects(()=>h.raw.runRelationshipJob({body:wake.body}),/transport lost/);
 assert.equal(siblingFinished,true);assert.equal(h.store.has(wake.body.inboxId),true);
 assert.equal(h.store.has('relationship-pending:v1:IDEA-2'),false);
 assert.equal(h.store.has('relationship-pending:v1:IDEA-3'),true);
 h.onPut(null);await h.raw.runRelationshipJob({body:wake.body});
 // The first edit reached Jira before the transport failed; fresh reads suppress
 // repeating that write. The unstarted third target is recovered on replay.
 assert.equal(h.writes.length,3);assert.equal(h.store.has(wake.body.inboxId),false);
});


// Load both production workers against the same Jira/KVS mocks. These tests
// exercise interleaving at queue boundaries, not Forge scheduling latency.
for(const populationFirst of [true,false])test(`population and live rollup share state (population first: ${populationFirst})`,async()=>{
 const h=await harness();
 h.store.set('population-current:v1:p','run');
 h.store.set('population:v1:run',{id:'run',policyId:'p',revision:'r',activatedAt:'',phase:'running',pages:1,page:0,offset:0,updated:0,unchanged:0,skipped:0,excludeDone:true});
 h.store.set('population-page:v1:run:0',['IDEA-1','IDEA-2']);
 await h.population.queuePopulation('run');await h.raw.enqueueRelationshipEvent(sourceEvent(1));
 const populationJob=h.queued.shift(),liveJob=h.queued.shift();
 assert.equal(populationJob.concurrency.key,liveJob.concurrency.key);
 assert.equal(populationJob.concurrency.limit,1);assert.equal(liveJob.concurrency.limit,1);
 if(populationFirst){
   await h.population.runPopulationJob(populationJob);
   // A source edit while population is unfinished must reach the first target.
   h.setPoints(17);await h.raw.runRelationshipJob({body:liveJob.body});
 }else{
   await h.raw.runRelationshipJob({body:liveJob.body});
   await h.population.runPopulationJob(populationJob);
 }
 while(h.queued.length)await h.population.runPopulationJob(h.queued.shift());
 assert.equal(h.store.get('population:v1:run').phase,'complete');
 if(populationFirst)assert.deepEqual(h.writes,[11,17,17]);
 else assert.deepEqual(h.writes,[11,11]); // population skips the current first target
});
test('100 independent targets complete with combined fields and no duplicate writes',async()=>{
 const h=await harness(100);const second=structuredClone(h.policy);second.id='second';second.targetFieldId='customfield_3';
 h.store.set('field-policies:v1',[h.policy,second]);
 await h.m.runRelationshipJob({body:{...update.body,eventType:'avi:jira:created:issue'}});
 assert.equal(h.writeBodies.length,100);
 assert.ok(h.writeBodies.every(fields=>fields.customfield_2===11&&fields.customfield_3===11));
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('relationship-pending:')).length,0);
});


test('split discovery publishes durable signals without writing pending state or Jira',async()=>{
 const h=await harness(1,true);await h.raw.enqueueRelationshipEvent(sourceEvent(1));const wake=h.queued.shift();
 assert.equal(wake.concurrency.key,'relationship-discovery-v2');
 await h.raw.runRelationshipJob({body:wake.body});
 assert.equal(h.writes.length,0);assert.equal([...h.store.keys()].some(k=>k.startsWith('relationship-pending:')),false);
 assert.equal(h.queued[0].concurrency.key,'relationship-writes-v1');
 await h.m.runRelationshipJob({body:h.queued.shift().body});assert.deepEqual(h.writes,[11]);
 assert.equal([...h.store.keys()].some(k=>k.startsWith('relationship-signal:')),false);
});
test('split query lag and duplicate wakes preserve work without duplicate writes',async()=>{
 const h=await harness(1,true);h.setQueryVisible(false);await h.raw.enqueueRelationshipEvent(sourceEvent(1));const wake=h.queued.shift();
 await h.raw.runRelationshipJob({body:wake.body});const writer=h.queued.shift();
 await h.raw.runRelationshipJob({body:writer.body});await h.raw.runRelationshipJob({body:writer.body});
 assert.deepEqual(h.writes,[11]);
});
test('split failed dispatch retains discovery input and replay converges',async()=>{
 const h=await harness(1,true);await h.raw.enqueueRelationshipEvent(sourceEvent(1));const wake=h.queued.shift();h.setPushFailure(true);
 await assert.rejects(()=>h.raw.runRelationshipJob({body:wake.body}),/queue/);assert.ok(h.store.has(wake.body.inboxId));
 h.setPushFailure(false);await h.m.runRelationshipJob({body:wake.body});assert.deepEqual(h.writes,[11]);
});
test('split writer retries transport errors and drops stale policy references',async()=>{
 const h=await harness(1,true);await h.raw.enqueueRelationshipEvent(sourceEvent(1));await h.raw.runRelationshipJob({body:h.queued.shift().body});
 const writer=h.queued.shift();h.setPutStatus(429);await assert.rejects(()=>h.raw.runRelationshipJob({body:writer.body}),/429/);
 assert.ok(h.store.has(writer.body.signalId));h.setPutStatus(200);h.policy.revision='changed';h.store.set('field-policies:v1',[h.policy]);
 await h.raw.runRelationshipJob({body:writer.body});assert.equal(h.writes.length,0);
});
test('new discovery during a writer is preserved for a follow-up',async()=>{
 const h=await harness(1,true);await h.raw.enqueueRelationshipEvent(sourceEvent(1));await h.raw.runRelationshipJob({body:h.queued.shift().body});
 const writer=h.queued.shift();h.onPut(async()=>{h.onPut(null);h.setPoints(18);await h.raw.enqueueRelationshipEvent(sourceEvent(2));await h.raw.runRelationshipJob({body:h.queued.shift().body});});
 await h.raw.runRelationshipJob({body:writer.body});await h.m.runRelationshipJob({body:h.queued.shift().body});
 assert.deepEqual(h.writes,[11,18]);
});


test('split signals consolidate policies, preserve protection and drain alongside legacy pending work',async()=>{
 const h=await harness(1,true);h.policy.protect=true;const second=structuredClone(h.policy);second.id='second';second.targetFieldId='customfield_3';h.store.set('field-policies:v1',[h.policy,second]);
 await h.raw.runRelationshipJob(update);const legacy=h.queued.shift();
 await h.raw.enqueueRelationshipEvent({eventType:'avi:jira:updated:issue',issue:{key:'IDEA-1',fields:{project:{id:'1'}}},changelog:{items:[{fieldId:'customfield_2'}]}});
 await h.raw.runRelationshipJob({body:h.queued.shift().body});
 await h.m.runRelationshipJob({body:h.queued.shift().body});await h.raw.runRelationshipJob({body:legacy.body});
 assert.deepEqual(h.writeBodies,[{customfield_2:11,customfield_3:11}]);
 assert.ok([...h.store.values()].some(v=>v?.outcome==='restored'));
});
test('split structural continuation discovers every target across pages',async()=>{
 const h=await harness(61,true);await h.raw.enqueueRelationshipEvent({...sourceEvent(1),eventType:'avi:jira:created:issue'});
 await h.m.runRelationshipJob({body:h.queued.shift().body});assert.equal(h.writes.length,61);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('relationship-signal:')).length,0);
});
test('split discovery can run during population without touching its target value',async()=>{
 const h=await harness(1,true);
 h.store.set('population-current:v1:p','run');h.store.set('population:v1:run',{id:'run',policyId:'p',revision:'r',activatedAt:'',phase:'running',pages:1,page:0,offset:0,updated:0,unchanged:0,skipped:0,excludeDone:true});
 h.store.set('population-page:v1:run:0',['IDEA-1']);
 h.onPut(async()=>{h.onPut(null);h.setPoints(23);await h.raw.enqueueRelationshipEvent(sourceEvent(1));await h.raw.runRelationshipJob({body:h.queued.shift().body});assert.equal(h.writes.length,1);});
 await h.population.runPopulationJob({body:{populationId:'run'}});
 assert.equal(h.queued[0].concurrency.key,'relationship-writes-v1');
 await h.m.runRelationshipJob({body:h.queued.shift().body});assert.deepEqual(h.writes,[11,23]);
});


test('split burst combines ten discovery handoffs into one current target write',async()=>{
 const h=await harness(1,true);h.setPoints(100);
 for(let n=1;n<=100;n++)await h.raw.enqueueRelationshipEvent(sourceEvent(n));
 await h.m.runRelationshipJob({body:h.queued.shift().body});
 assert.deepEqual(h.writes,[100]);
 assert.equal(h.requests.filter(r=>r.options.body?.includes('parent in')).length,1);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('relationship-discovery:')||k.startsWith('relationship-signal:')).length,0);
});
