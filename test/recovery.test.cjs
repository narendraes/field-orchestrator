const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
async function harness(runtime=false) {
 const store=new Map(), calls=[]; const state={target:'old',matches:true};
 const kvs={get:async k=>structuredClone(store.get(k)),set:async(k,v)=>store.set(k,structuredClone(v)),delete:async k=>store.delete(k)};
 class Resolver {constructor(){this.h={};} define(n,f){this.h[n]=f;} getDefinitions(){return this.h;}}
 const requestJira=async(url,options={})=>{calls.push({url,options});let data={};if(url.endsWith('/field'))data=['source','target'].map(id=>({id,schema:{type:'string'}}));else if(url.includes('/expression/'))data={value:state.matches};else if(options.method==='PUT'&&url.includes('/issue/'))state.target=JSON.parse(options.body).fields.target;else if(url.includes('/issue/'))data={fields:{target:state.target}};return {ok:true,status:200,json:async()=>data};};
 const api={asUser:()=>({requestJira}),asApp:()=>({requestJira})}; const route=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'');
 const context=vm.createContext({console:{info(){},error(){}},crypto:{randomUUID}});
 const mocks={'@forge/api':{default:api,route},'@forge/kvs':{kvs},'@forge/resolver':{default:Resolver}};
 const mod=new vm.SourceTextModule(fs.readFileSync(runtime?'src/runtime/issue-updated.js':'src/resolvers/index.js','utf8'),{context});
 await mod.link(n=>new vm.SyntheticModule(Object.keys(mocks[n]),function(){for(const[k,v]of Object.entries(mocks[n]))this.setExport(k,v);},{context}));await mod.evaluate();
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
