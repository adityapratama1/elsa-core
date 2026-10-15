const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.join(__dirname,'../src/components/screens/workflow-instance-list/elsa-workflow-instance-list-screen/elsa-workflow-instance-list-screen.tsx');
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText;
const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)}),decorator=()=>()=>{};
const sandbox={exports:{},require:id=>id==='@stencil/core'?{h,Component:()=>c=>c,Prop:decorator,State:decorator,Watch:decorator,Method:decorator,Listen:decorator}:
 id==='@stencil/router'?{injectHistory:()=>{}}:id.includes('lodash')?require(id):id.endsWith('/models')?{OrderBy:{Started:'Started'},DropdownButtonOrigin:{TopRight:1}}:
 id.endsWith('/data/dashboard')?{default:{injectProps:()=>{}}}:{}};
vm.runInNewContext(code,sandbox);
const make=()=>{const view=new sandbox.exports.ElsaWorkflowInstanceListScreen();view.t=x=>x;view.basePath='/process/dashboard';
 view.workflowBlueprints=[{id:'a',version:1,displayName:'Old approval'},{id:'a',version:2,displayName:'Invoice approval',name:'InvoiceProcess'},{id:'id-b',version:1,displayName:'Data import'}];return view;};
const nodes=node=>node&&typeof node==='object'?[node,...node.children.flatMap(nodes)]:[];
test('workflow search matches display name, internal name and ID without changing source',()=>{
 const view=make(),before=JSON.stringify(view.workflowBlueprints);view.workflowFilterOpen=true;
 for(const term of ['APPROVAL','invoiceprocess','id-b']) {view.workflowFilterSearchTerm=term;const links=nodes(view.renderWorkflowFilter()).filter(x=>x.tag==='a');assert.equal(links.length,2);}
 view.workflowFilterSearchTerm='missing';const tree=view.renderWorkflowFilter();assert.equal(nodes(tree).filter(x=>x.tag==='a').length,1);assert.ok(JSON.stringify(tree).includes('No workflows found.'));
 assert.equal(JSON.stringify(view.workflowBlueprints),before);
});
test('selection routes with current status, sorting, page size and correlation',async()=>{
 const view=make();view.selectedWorkflowStatus='Faulted';view.selectedOrderByState='Finished';view.selectedCorrelationId='correlation';view.currentPageSize=50;
 let url;view.history={push:value=>url=value};await view.selectWorkflowFilter({preventDefault(){}},'a');
 const query=new URL('https://fixture.test'+url).searchParams;assert.equal(query.get('workflow'),'a');assert.equal(query.get('status'),'Faulted');assert.equal(query.get('orderBy'),'Finished');assert.equal(query.get('pageSize'),'50');assert.equal(query.get('correlationId'),'correlation');
 assert.equal(view.workflowFilterOpen,false);assert.equal(view.workflowFilterSearchTerm,'');
 await view.selectWorkflowFilter({preventDefault(){}},null);assert.ok(!new URL('https://fixture.test'+url).searchParams.has('workflow'));
});
test('standalone selection refreshes once and Escape restores trigger focus',async()=>{
 const view=make();let calls=0,focused=false;view.currentPage=4;view.loadWorkflowInstances=async()=>{calls++;};
 await view.selectWorkflowFilter({preventDefault(){}},'a');assert.equal(view.selectedWorkflowId,'a');assert.equal(view.currentPage,0);assert.equal(calls,1);
 view.workflowFilterOpen=true;view.workflowFilterElement={querySelector:()=>({focus:()=>focused=true})};view.onWorkflowFilterKeydown({key:'Escape'});
 assert.equal(view.workflowFilterOpen,false);assert.equal(focused,true);
});
