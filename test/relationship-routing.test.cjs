const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
async function load(){const module=new vm.SourceTextModule(fs.readFileSync('src/runtime/relationship-routing.js','utf8'),{context:vm.createContext({})});await module.link(()=>{});await module.evaluate();return module.namespace;}
const policy={id:'p',revision:'r',behaviorType:'relationship',sourceProjectIds:['2'],projectIds:['1'],linkTypeId:'7',relatedIssueTypeIds:['9'],hierarchyDepth:2,aggregation:'sum',sourceFieldId:'customfield_1',targetFieldId:'customfield_2',protect:true,filters:[{fieldId:'statusCategory'}]};
const issue=(key,parent,links=[])=>({key,fields:{project:{id:'2'},parent:parent?{key:parent}:null,issuelinks:links}});
const link=(target,type='7',inward=false)=>({type:{id:type},[inward?'inwardIssue':'outwardIssue']:{key:target}});
test('compile maps virtual status to status and indexes both link endpoints',async()=>{
 const {compileRelationshipPlan:compile}=await load();const plan=compile(policy);
 assert.deepEqual(Array.from(plan.sourceFieldIds),['customfield_1','status','parent','issuetype','project']);
 assert.deepEqual(Array.from(plan.linkProjectIds),['2','1']);assert.equal(plan.activationReady,false);
 assert.throws(()=>compile({...policy,sourceProjectIds:[]}),/spaces/);
 assert.throws(()=>compile({...policy,hierarchyDepth:3}),/depth/);
});
test('routes grandchild through either link direction without filtering out departing status',async()=>{
 const {compileRelationshipPlan:compile,traceRelationshipTargets:trace}=await load();
 const data={'ABC-1':issue('ABC-1','ABC-2'),'ABC-2':issue('ABC-2','ABC-3'),'ABC-3':issue('ABC-3',null,[link('IDEA-1'),link('IDEA-1','7',true),link('IDEA-2','other')])};
 const reads=[],queries=[];
 const result=await trace(compile(policy),'ABC-1',{readIssue:async(key,fields)=>{reads.push({key,fields});return data[key];},searchIssues:async(jql)=>{queries.push(jql);return jql.includes('issuetype')?[{key:'ABC-3'}]:[{key:'IDEA-1',fields:{project:{id:'1'}}}];}});
 assert.equal(result.targets.length,1);assert.equal(result.targets[0].key,'IDEA-1');assert.equal(reads.length,3);
 assert.ok(queries[1].includes('project in ("1")'));assert.ok(!queries.join(' ').includes('status'));assert.ok(!queries[1].includes('IDEA-2'));
});
test('source scope and depth bound traversal',async()=>{
 const {compileRelationshipPlan:compile,traceRelationshipTargets:trace}=await load();
 await assert.rejects(trace(compile(policy),'ABC-1',{readIssue:async()=>({fields:{project:{id:'99'}}})}),/outside/);
 let reads=0;
 const result=await trace(compile({...policy,hierarchyDepth:0}),'ABC-1',{readIssue:async()=>{reads++;return issue('ABC-1','ABC-2');},searchIssues:async()=>[]});
 assert.equal(reads,1);assert.equal(result.targets.length,0);
});
test('routing fails on cycles or excess targets instead of partial success',async()=>{
 const {compileRelationshipPlan:compile,traceRelationshipTargets:trace}=await load();
 await assert.rejects(trace(compile(policy),'ABC-1',{readIssue:async()=>issue('ABC-1','ABC-1')}),/Cyclic/);
 await assert.rejects(trace(compile({...policy,hierarchyDepth:0}),'ABC-1',{readIssue:async()=>issue('ABC-1',null,Array.from({length:51},(_,i)=>link('IDEA-'+i))),searchIssues:async()=>[{key:'ABC-1'}]}),/50/);
});
