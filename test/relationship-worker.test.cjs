const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
async function harness(targetCount=1){
 const context=vm.createContext({console:{info(){},warn(){}},crypto:{randomUUID}}),store=new Map(),writes=[],queued=[],writeBodies=[],requests=[];
 let points=11,target=3,linked=true,editable=true,matching=true,eligible=true,putStatus=200,pushFailure=false,deleteFailure=false,onPut=null;
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
  else if(q.includes('project in ("1")'))data={issues:[{key:'IDEA-1',fields:{project:{id:'1'}}}]};
  else data={issues:matching?[{key:'ABC-1',fields:{customfield_1:points}}]:[]};
 }else if(url.endsWith('/editmeta'))data={fields:editable?{customfield_2:{schema:{type:'number'}},customfield_3:{schema:{type:'number'}}}:{}};
 else if(options.method==='PUT'){if(putStatus!==200)return {ok:false,status:putStatus};const fields=JSON.parse(options.body).fields;writeBodies.push(fields);writes.push(fields.customfield_2);targetValues.set(url.split('/issue/')[1],fields);if(onPut)onPut();}
 else if(url.includes('/issue/IDEA-'))data={key:url.split('/issue/')[1].split('?')[0],fields:{project:{id:'1'},customfield_2:target,customfield_3:target,...targetValues.get(url.split('/issue/')[1].split('?')[0]),issuelinks:linked?[{type:{id:'7'},outwardIssue:{key:'ABC-2'}}]:[]}};
 else if(url.includes('/issue/ABC-1'))data={key:'ABC-1',fields:{project:{id:'2'},parent:{key:'ABC-2'}}};
 else data={key:'ABC-2',fields:{project:{id:'2'},issuelinks:[{type:{id:'7'},inwardIssue:{key:'IDEA-1'}}]}};
 return {ok:true,status:200,json:async()=>data};
 };
 const mocks={'@forge/api':{default:{asApp:()=>({requestJira}),asUser:()=>({requestJira})},route:(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'')},'@forge/kvs':{kvs:{get:async k=>structuredClone(store.get(k)),set:async(k,v)=>store.set(k,structuredClone(v)),delete:async k=>{if(deleteFailure){deleteFailure=false;throw new Error("checkpoint unavailable");}store.delete(k);}}},'@forge/events':{Queue:class{async push(item){if(pushFailure)throw new Error("queue unavailable");queued.push(item);}}}};
 const cache=new Map();async function load(filename){if(cache.has(filename))return cache.get(filename);const mod=new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{context,identifier:filename});cache.set(filename,mod);await mod.link(async(n,parent)=>{if(mocks[n])return new vm.SyntheticModule(Object.keys(mocks[n]),function(){for(const[k,v]of Object.entries(mocks[n]))this.setExport(k,v);},{context});return load(path.resolve(path.dirname(parent.identifier),n+'.js'));});return mod;}
 const mod=await load(path.resolve('src/runtime/relationship-worker.js'));await mod.evaluate();
 return {m:{...mod.namespace,runRelationshipJob:async event=>{
 await mod.namespace.runRelationshipJob(event);
 let count=0;
 while(queued.length){if(++count>1000)throw new Error('Queue did not drain');await mod.namespace.runRelationshipJob({body:queued.shift().body});}
 }},raw:mod.namespace,policy,store,writes,queued,writeBodies,requests,setPutStatus:v=>putStatus=v,setPushFailure:v=>pushFailure=v,failDelete:()=>deleteFailure=true,onPut:fn=>onPut=fn,setPoints:v=>points=v,setTarget:v=>{target=v;targetValues.clear();},unlink:()=>linked=false,deny:()=>editable=false,setEligible:v=>eligible=v,setMatching:v=>matching=v};
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
 assert.equal(typeof h.queued[0].body.receivedAt,'number');
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
