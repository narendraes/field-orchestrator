const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
async function harness(runtime=false) {
 const store=new Map(), calls=[]; const state={target:'old',matches:true,admin:true,failDiagnostic:false,numeric:false};
 const kvs={get:async k=>structuredClone(store.get(k)),set:async(k,v)=>{if(state.failDiagnostic && k.startsWith('diagnostic-run:'))throw new Error('storage unavailable');store.set(k,structuredClone(v));},delete:async k=>store.delete(k)};
 class Resolver {constructor(){this.h={};} define(n,f){this.h[n]=f;} getDefinitions(){return this.h;}}
 const requestJira=async(url,options={})=>{calls.push({url,options});
 if(options.method==='PUT'&&url.includes('/properties/')&&state.propertyStatus){
  return {ok:state.propertyStatus<400,status:state.propertyStatus,text:async()=> 'Property write rejected',json:async()=>{throw new SyntaxError('Unexpected end of JSON input');}};
 }
 let data={};if(url.includes('/mypermissions'))data={permissions:{ADMINISTER:{havePermission:state.admin}}};else if(url.endsWith('/field'))data=['source','target'].map(id=>({id,schema:{type:state.numeric?'number':'string'}}));else if(url.includes('/search/jql'))data={issues:Array.from({length:61},(_,i)=>({key:'ABC-'+(i+1),fields:{project:{id:'1'}}}))};else if(url.endsWith('/editmeta'))data={fields:{target:{schema:{type:'number'}}}};else if(url.includes('/expression/'))data={value:state.matches};else if(options.method==='PUT'&&url.includes('/issue/'))state.target=JSON.parse(options.body).fields.target;else if(url.includes('/issue/'))data={key:'ABC-1',fields:{project:{id:'1'},target:state.target,issuelinks:[]}};return {ok:true,status:200,json:async()=>data};};
 const api={asUser:()=>({requestJira}),asApp:()=>({requestJira})}; const route=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'');
 const context=vm.createContext({console:{info(){},error(){},warn(){}},crypto:{randomUUID}});
 const mocks={'@forge/api':{default:api,route},'@forge/kvs':{kvs},'@forge/resolver':{default:Resolver}};
 const mod=new vm.SourceTextModule(fs.readFileSync(runtime?'src/runtime/issue-updated.js':'src/resolvers/index.js','utf8'),{context});
 const path=require('node:path');
 const cache=new Map();
 const linker=async(n,parent)=>{
  if(n==='@forge/events')return new vm.SyntheticModule(['Queue'],function(){this.setExport('Queue',class{async push(){}});},{context});
  if(mocks[n])return new vm.SyntheticModule(Object.keys(mocks[n]),function(){for(const[k,v]of Object.entries(mocks[n]))this.setExport(k,v);},{context});
  const base=parent.identifier==='vm:module(0)' ? (runtime?'src/runtime/issue-updated.js':'src/resolvers/index.js') : parent.identifier;
  const filename=path.resolve(path.dirname(base),n+'.js');
  if(cache.has(filename))return cache.get(filename);
  const child=new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{context,identifier:filename});cache.set(filename,child);await child.link(linker);return child;
 };
 await mod.link(linker);await mod.evaluate();
 return {store,calls,state,h:mod.namespace.handler,run:mod.namespace.handleFilteredIssueUpdate};
}
const draft={id:'p',name:'Test',targetFieldId:'target',projectIds:['1'],behaviorType:'assessment',conditions:[{fieldId:'source',operator:'equals',value:'yes'}],resultValue:'A'};
async function validate(h,p,outcome='would-change'){return h.h.recordPolicyRun({payload:{policyId:p.id,policyRevision:p.revision,configuration:p,traceId:randomUUID(),workItemKey:'ABC-1',outcome,configuredTargetValue:p.resultValue}});}
async function ready(){const h=await harness();const p=await h.h.savePolicy({payload:draft});await validate(h,p);return {h,p};}
test('saved edits revoke validation and delayed validation fails',async()=>{const{h,p}=await ready();await h.h.savePolicy({payload:{...p,resultValue:'B'}});await assert.rejects(validate(h,p));await assert.rejects(h.h.reviewPolicyActivation({payload:{id:p.id}}));});
test('unsaved configuration cannot certify stored revision',async()=>{const{h,p}=await ready();await assert.rejects(validate(h,{...p,resultValue:'B'}));});
test('failed validation revokes readiness',async()=>{const{h,p}=await ready();await validate(h,p,'error');await assert.rejects(h.h.reviewPolicyActivation({payload:{id:p.id}}));});
test('legacy validation is ineligible',async()=>{const h=await harness();h.store.set('field-policies:v1',[{...draft,lastValidatedKey:'ABC-1'}]);await assert.rejects(h.h.reviewPolicyActivation({payload:{id:'p'}}));});
test('review does not write Jira; activation requires token, consumes it and supports deactivation',async()=>{const{h,p}=await ready();await assert.rejects(h.h.activatePolicy({payload:{id:p.id}}));const review=await h.h.reviewPolicyActivation({payload:{id:p.id}});assert.equal(h.calls.some(x=>x.options.method==='PUT'),false);const active=await h.h.activatePolicy({payload:{id:p.id,...review}});assert.equal(active.status,'active');await assert.rejects(h.h.activatePolicy({payload:{id:p.id,...review}}));const inactive=await h.h.deactivatePolicy({payload:{id:p.id}});assert.equal(inactive.status,'validated');});
test('expired review fails closed',async()=>{const{h,p}=await ready();const review=await h.h.reviewPolicyActivation({payload:{id:p.id}});h.store.get('activation-review:v1:p').expiresAt=0;await assert.rejects(h.h.activatePolicy({payload:{id:p.id,...review}}));});
test('active policies cannot be edited',async()=>{const{h,p}=await ready();const r=await h.h.reviewPolicyActivation({payload:{id:p.id}});await h.h.activatePolicy({payload:{id:p.id,...r}});await assert.rejects(h.h.savePolicy({payload:p}));});
for(const [fields,outcome] of [[['source'],'changed'],[['target'],'restored'],[['source','target'],'restored']])test('protected '+fields.join('+')+' classifies '+outcome,async()=>{const h=await harness(true);h.store.set('field-policies:v1',[{...draft,status:'active',protect:true,runtime:{expression:'true',dependencyFieldIds:['source','target'],compiledTargetValue:'A'}}]);await h.run({issue:{key:'ABC-1',fields:{project:{id:'1'}}},changelog:{items:fields.map(fieldId=>({fieldId}))}});assert.equal(h.store.get('policy-runs:v1')[0].outcome,outcome);});
for(const matches of [true,false])test('creation '+(matches?'writes':'no match skips'),async()=>{const h=await harness(true);h.state.matches=matches;h.store.set('field-policies:v1',[{...draft,status:'active',runtime:{expression:'true',dependencyFieldIds:['source'],compiledTargetValue:'A'}}]);await h.run({eventType:'avi:jira:created:issue',issue:{key:'ABC-1',fields:{project:{id:'1'}}}});assert.equal(h.state.target,matches?'A':'old');});
test('equivalent target suppresses writes and traces',async()=>{const h=await harness(true);h.state.target='A';h.store.set('field-policies:v1',[{...draft,status:'active',runtime:{expression:'true',dependencyFieldIds:['source'],compiledTargetValue:'A'}}]);await h.run({eventType:'avi:jira:created:issue',issue:{key:'ABC-1',fields:{project:{id:'1'}}}});assert.equal(h.calls.some(x=>x.options.method==='PUT'),false);assert.equal(h.store.has('policy-runs:v1'),false);});

test('relationship source spaces survive save and revision-bound validation', async () => {
 const h = await harness();
 const p = await h.h.savePolicy({payload:{...draft,behaviorType:'relationship',sourceProjectIds:['2','3','2'],linkTypeId:'9',relatedIssueTypeIds:['4'],sourceFieldId:'source',aggregation:'sum'}});
 assert.deepEqual(Array.from(p.sourceProjectIds), ['2','3']);
 await validate(h,p);
 await assert.rejects(h.h.reviewPolicyActivation({payload:{id:p.id}}), /numeric targets/);
 const reviewWrites=h.calls.filter(call=>call.options.method==='PUT');
 assert.equal(reviewWrites.length,0);
});

for (const outcome of ['no-match','unchanged','write-succeeded']) test('diagnostics captures '+outcome, async () => {
 const h=await harness(true);
 h.store.set('diagnostics:v1:p',{until:Date.now()+60000});
 h.store.set('field-policies:v1',[{...draft,revision:'r1',status:'active',runtime:{expression:'true',dependencyFieldIds:['source'],compiledTargetValue:'A'}}]);
 if(outcome==='no-match')h.state.matches=false;
 if(outcome==='unchanged')h.state.target='A';
 await h.run({issue:{key:'ABC-1',fields:{project:{id:'1'}}},changelog:{items:[{fieldId:'source'}]}});
 const records=[...h.store.entries()].filter(([key])=>key.startsWith('diagnostic-run:')).map(([,value])=>value);
 assert.equal(records.length,1); assert.equal(records[0].outcome,outcome); assert.equal(records[0].revision,'r1');
 assert.equal('fields' in records[0],false);
});
test('expired diagnostics stores no records and telemetry failure cannot fail a write',async()=>{
 const h=await harness(true);
 h.store.set('field-policies:v1',[{...draft,status:'active',runtime:{expression:'true',dependencyFieldIds:['source'],compiledTargetValue:'A'}}]);
 const event={issue:{key:'ABC-1',fields:{project:{id:'1'}}},changelog:{items:[{fieldId:'source'}]}};
 h.store.set('diagnostics:v1:p',{until:1});await h.run(event);
 assert.equal([...h.store.keys()].some(key=>key.startsWith('diagnostic-run:')),false);
 h.state.target='old';h.state.failDiagnostic=true;h.store.set('diagnostics:v1:p',{until:Date.now()+60000});
 await h.run(event);assert.equal(h.state.target,'A');assert.equal(h.store.get('policy-runs:v1')[0].outcome,'changed');
});
test('diagnostic controls require admin and preserve policy revision',async()=>{
 const {h,p}=await ready();h.state.admin=false;
 await assert.rejects(h.h.setPolicyDiagnostics({payload:{id:p.id,enabled:true}}),/administrator/);
 h.state.admin=true;const setting=await h.h.setPolicyDiagnostics({payload:{id:p.id,enabled:true}});
 assert.ok(setting.until>Date.now());assert.equal(h.store.get('field-policies:v1')[0].revision,p.revision);
 h.store.set('diagnostic-run:v1:p:0',{traceId:'t',createdAt:new Date().toISOString()});
 const loaded=await h.h.getPolicyDiagnostics({payload:{id:p.id}});assert.equal(loaded.records.length,1);
 await h.h.clearPolicyDiagnostics({payload:{id:p.id}});
 assert.equal(h.store.has('diagnostic-run:v1:p:0'),false);assert.equal(h.store.get('diagnostics:v1:p').until,0);
});

test('numeric activation succeeds in a 61-item project and projects both endpoints',async()=>{
 const h=await harness();h.state.numeric=true;
 const p=await h.h.savePolicy({payload:{...draft,behaviorType:'relationship',sourceProjectIds:['2'],sourceFieldId:'source',linkTypeId:'7',relatedIssueTypeIds:['9'],aggregation:'sum'}});
 await validate(h,p);
 const review=await h.h.reviewPolicyActivation({payload:{id:p.id}});
 await h.h.activatePolicy({payload:{id:p.id,...review}});
 const indexes=h.calls.filter(call=>call.options.method==='PUT'&&call.url.includes('/properties/')).map(call=>JSON.parse(call.options.body));
 assert.equal(indexes.length,2);assert.ok(indexes.every(item=>item.relationship));assert.ok(indexes.some(item=>item.linkRoutes.includes('7:1')));
 await h.h.deactivatePolicy({payload:{id:p.id}});
 assert.equal(h.calls.filter(call=>call.options.method==='DELETE').length,2);
});

for(const status of [200,201,204])test('activation accepts empty project property response '+status,async()=>{
 const {h,p}=await ready();h.state.propertyStatus=status;
 const review=await h.h.reviewPolicyActivation({payload:{id:p.id}});
 const active=await h.h.activatePolicy({payload:{id:p.id,...review}});
 assert.equal(active.status,'active');assert.equal(h.store.get('field-policies:v1')[0].status,'active');
});
test('failed project property write does not activate policy',async()=>{
 const {h,p}=await ready();h.state.propertyStatus=403;
 const review=await h.h.reviewPolicyActivation({payload:{id:p.id}});
 await assert.rejects(h.h.activatePolicy({payload:{id:p.id,...review}}),/failed \(403\)/);
 assert.notEqual(h.store.get('field-policies:v1')[0].status,'active');
});

test('future-only activation does not create a population run',async()=>{
 const {h,p}=await ready(),review=await h.h.reviewPolicyActivation({payload:{id:p.id}});
 await h.h.activatePolicy({payload:{id:p.id,...review}});
 assert.equal([...h.store.keys()].some(key=>key.startsWith('population:')),false);
});
test('activation rejects foreign, stale and unprepared population runs',async()=>{
 for(const patch of [{policyId:'other'},{revision:'old'},{phase:'preparing'}]){
 const {h,p}=await ready(),review=await h.h.reviewPolicyActivation({payload:{id:p.id}});
 const run={id:'pop',policyId:p.id,revision:p.revision,phase:'ready',expiresAt:Date.now()+60000,...patch};
 h.store.set('population:v1:pop',run);h.store.set('population-current:v1:'+p.id,'pop');
 await assert.rejects(h.h.activatePolicy({payload:{id:p.id,...review,populationId:'pop'}}));
 assert.notEqual(h.store.get('field-policies:v1')[0].status,'active');
 }
});
test('reviewed population starts only after policy activation',async()=>{
 const {h,p}=await ready(),review=await h.h.reviewPolicyActivation({payload:{id:p.id}});
 h.store.set('population:v1:pop',{id:'pop',policyId:p.id,revision:p.revision,phase:'ready',expiresAt:Date.now()+60000});h.store.set('population-current:v1:'+p.id,'pop');
 await h.h.activatePolicy({payload:{id:p.id,...review,populationId:'pop'}});
 assert.equal(h.store.get('field-policies:v1')[0].status,'active');assert.equal(h.store.get('population:v1:pop').phase,'running');
});
test('Done protection is compiled server-side and tracks status changes',async()=>{
 const h=await harness(),p=await h.h.savePolicy({payload:{...draft,skipDoneTargets:true}});await validate(h,p);
 const review=await h.h.reviewPolicyActivation({payload:{id:p.id}}),active=await h.h.activatePolicy({payload:{id:p.id,...review}});
 assert.match(active.runtime.expression,/status.category.key != 'done'/);assert.ok(active.runtime.dependencyFieldIds.includes('status'));
});
