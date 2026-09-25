const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
async function harness(targetCount=1){
 const context=vm.createContext({console:{info(){},warn(){}},crypto:{randomUUID}}),store=new Map(),writes=[],queued=[];
 let points=11,target=3,linked=true,editable=true,matching=true,eligible=true;
 const targetValues=new Map();
 const policy={id:'p',revision:'r',name:'Rollup',status:'active',behaviorType:'relationship',projectIds:['1'],sourceProjectIds:['2'],targetFieldId:'customfield_2',sourceFieldId:'customfield_1',aggregation:'sum',filters:[],runtime:{plan:{sourceProjectIds:['2'],targetProjectIds:['1'],sourceFieldIds:['customfield_1','status','parent','issuetype','project'],targetFieldIds:['customfield_2'],linkTypeId:'7',relatedIssueTypeIds:['9'],hierarchyDepth:1,maxTargets:50}}};store.set('field-policies:v1',[policy]);
 const requestJira=async(url,options={})=>{
 let data={};
 if(url.includes('/expression/evaluate')){assert.match(JSON.parse(options.body).expression,/issue.status.category.key/);data={value:eligible};}
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
 }else if(url.endsWith('/editmeta'))data={fields:editable?{customfield_2:{schema:{type:'number'}}}:{}};
 else if(options.method==='PUT'){const value=JSON.parse(options.body).fields.customfield_2;writes.push(value);targetValues.set(url.split('/issue/')[1],value);}
 else if(url.includes('/issue/IDEA-'))data={key:url.split('/issue/')[1].split('?')[0],fields:{project:{id:'1'},customfield_2:targetValues.get(url.split('/issue/')[1].split('?')[0])??target,issuelinks:linked?[{type:{id:'7'},outwardIssue:{key:'ABC-2'}}]:[]}};
 else if(url.includes('/issue/ABC-1'))data={key:'ABC-1',fields:{project:{id:'2'},parent:{key:'ABC-2'}}};
 else data={key:'ABC-2',fields:{project:{id:'2'},issuelinks:[{type:{id:'7'},inwardIssue:{key:'IDEA-1'}}]}};
 return {ok:true,status:200,json:async()=>data};
 };
 const mocks={'@forge/api':{default:{asApp:()=>({requestJira}),asUser:()=>({requestJira})},route:(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'')},'@forge/kvs':{kvs:{get:async k=>structuredClone(store.get(k)),set:async(k,v)=>store.set(k,structuredClone(v))}},'@forge/events':{Queue:class{async push(item){queued.push(item);}}}};
 const cache=new Map();async function load(filename){if(cache.has(filename))return cache.get(filename);const mod=new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{context,identifier:filename});cache.set(filename,mod);await mod.link(async(n,parent)=>{if(mocks[n])return new vm.SyntheticModule(Object.keys(mocks[n]),function(){for(const[k,v]of Object.entries(mocks[n]))this.setExport(k,v);},{context});return load(path.resolve(path.dirname(parent.identifier),n+'.js'));});return mod;}
 const mod=await load(path.resolve('src/runtime/relationship-worker.js'));await mod.evaluate();
 return {m:{...mod.namespace,runRelationshipJob:async event=>{
 await mod.namespace.runRelationshipJob(event);
 let count=0;
 while(queued.length){if(++count>1000)throw new Error('Queue did not drain');await mod.namespace.runRelationshipJob({body:queued.shift().body});}
 }},raw:mod.namespace,policy,store,writes,queued,setPoints:v=>points=v,setTarget:v=>{target=v;targetValues.clear();},unlink:()=>linked=false,deny:()=>editable=false,setEligible:v=>eligible=v,setMatching:v=>matching=v};
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

test('ordinary updates calculate in the discovery job without another queue hop',async()=>{
 const h=await harness();await h.raw.runRelationshipJob({body:{...update.body,receivedAt:Date.now()-100}});
 assert.deepEqual(h.writes,[11]);assert.equal(h.queued.length,0);
 const record=[...h.store.values()].find(v=>v?.outcome==='changed');
 assert.ok(record.sinceIngressMs>=100);assert.ok(record.beforeJobMs>=100);
});
test('related policies complete in one serialized job and unchanged writes stay suppressed',async()=>{
 const h=await harness();const second=structuredClone(h.policy);second.id='second';
 h.store.set('field-policies:v1',[h.policy,second]);
 await h.raw.runRelationshipJob(update);
 assert.deepEqual(h.writes,[11]);assert.equal(h.queued.length,0);
});
test('ingress adds no artificial delay and keeps the shared writer lock',async()=>{
 const h=await harness();await h.raw.enqueueRelationshipEvent({eventType:'avi:jira:updated:issue',issue:{key:'ABC-1',fields:{project:{id:'2'}}}});
 assert.equal(h.queued[0].delayInSeconds,undefined);assert.equal(h.queued[0].concurrency.key,'relationship-writes-v1');
 assert.equal(typeof h.queued[0].body.receivedAt,'number');
});
