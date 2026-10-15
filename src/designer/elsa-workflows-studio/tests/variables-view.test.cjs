const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const base=path.join(__dirname,'../src');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText;
const utils={exports:{}};vm.runInNewContext(compile(path.join(base,'utils/journal-occurrences.ts')),utils);
const privacy={exports:{}};vm.runInNewContext(compile(path.join(base,'utils/dashboard-data.ts')),privacy);
const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)});
const sandbox={exports:{},navigator:{clipboard:{writeText:async()=>{}}},require:id=>id==='@stencil/core'?{h,Component:()=>c=>c,Prop:()=>()=>{},State:()=>()=>{},Event:()=>()=>{},Watch:()=>()=>{},Method:()=>()=>{}}:id.includes('journal-occurrences')?utils.exports:id.includes('dashboard-data')?privacy.exports:{}};
vm.runInNewContext(compile(path.join(base,'components/screens/workflow-instance-viewer/elsa-workflow-instance-journal/elsa-workflow-instance-journal.tsx')),sandbox);
const make=data=>{const view=new sandbox.exports.ElsaWorkflowInstanceJournal();view.workflowInstance={variables:{data}};return view;};
const flatten=node=>node&&typeof node==='object'?[node,...node.children.flatMap(flatten)]:[];
const text=node=>JSON.stringify(node);
test('variables default to compact cards and do not serialize raw values',()=>{
 const data={Enabled:false,Count:0,Empty:'',Nothing:null,Rows:[{id:1}],Html:'<script>alert(1)</script>'};
 const before=JSON.stringify(data),view=make(data);view.renderStructuredData=()=>{throw Error('Detail must stay lazy');};
 const tree=view.renderVariables();assert.equal(flatten(tree).filter(x=>x.tag==='article').length,6);
 assert.equal(flatten(tree).filter(x=>x.tag==='pre').length,0);
 assert.ok(text(tree).includes('false'));assert.ok(text(tree).includes('(empty string)'));
 assert.equal(JSON.stringify(data),before);
});
test('search, incremental display, and selected value preserve the complete source',()=>{
 const data=Object.fromEntries(Array.from({length:65},(_,i)=>['Variable'+i,{count:i}]));
 const view=make(data);assert.equal(flatten(view.renderVariables()).filter(x=>x.tag==='article').length,30);
 view.variableLimit=60;assert.equal(flatten(view.renderVariables()).filter(x=>x.tag==='article').length,60);
 view.variableSearch='variable64';view.expandedVariable='Variable64';let seen;
 view.renderStructuredData=value=>{seen=value;return h('div',{},'Details');};
 assert.equal(flatten(view.renderVariables()).filter(x=>x.tag==='article').length,1);assert.equal(JSON.stringify(seen),JSON.stringify(data.Variable64));
 assert.equal(Object.keys(data).length,65);
});
test('external references remain references with no implicit fetch',()=>{
 const ref={$externalPayload:{id:'example',bytes:123}};const view=make({Large:ref});
 assert.ok(text(view.renderVariables()).includes('External payload'));
 view.expandedVariable='Large';let seen;view.renderStructuredData=value=>{seen=value;return h('div');};
 assert.ok(text(view.renderVariables()).includes('No external data is fetched'));assert.equal(JSON.stringify(seen),JSON.stringify(ref));
});

test('sensitive variable preview, expanded value, raw JSON and clipboard are redacted',async()=>{
 const data={ApiKey:'private-api-value',Response:{access_token:'private-token-value',Total:42}};
 const before=JSON.stringify(data),view=make(data);
 assert.ok(!text(view.renderVariables()).includes('private-api-value'));
 view.expandedVariable='ApiKey';assert.ok(!text(view.renderVariables()).includes('private-api-value'));
 view.expandedVariable='Response';const tree=view.renderVariables();
 assert.ok(!text(tree).includes('private-token-value'));
 const copy=flatten(tree).find(x=>x.tag==='button'&&x.props['aria-label']==='Copy Response');
 let copied;sandbox.navigator.clipboard.writeText=async value=>copied=value;
 await copy.props.onClick();assert.ok(!copied.includes('private-token-value'));assert.ok(copied.includes('42'));
 assert.equal(JSON.stringify(data),before);
});

test('recursive policy covers headers, JSON strings, credentials in URLs and error text',()=>{
 const value={headers:[{name:'Authorization',value:'header-secret'}],body:JSON.stringify({Password:'body-secret',items:[{email:'person@example.test',count:0}]}),
  error:'Request failed Authorization=error-secret',url:'https://service.test/api?api_key=url-secret',tokenUrl:'https://service.test/api?access_token=opaque-secret',connection:'postgres://user:pass@db/test',ok:false};
 const result=JSON.stringify(privacy.exports.dashboardData(value));
 for(const secret of ['header-secret','body-secret','person@example.test','error-secret','url-secret','opaque-secret','user:pass'])assert.ok(!result.includes(secret));
 assert.ok(result.includes('false'));assert.equal(value.headers[0].value,'header-secret');
});
