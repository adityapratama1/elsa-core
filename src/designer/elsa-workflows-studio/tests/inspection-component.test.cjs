const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
function load(file,requires={}){const box={exports:{},AbortController,setTimeout,clearTimeout,URL,crypto:require('node:crypto').webcrypto,require:n=>requires[n]||{},navigator:{clipboard:{writeText:async()=>{}}}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2018,experimentalDecorators:true,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText,box);return box}
const data=load('src/utils/dashboard-data.ts').exports,projection=load('src/utils/journal-occurrences.ts').exports;
const decorator=()=>()=>{},h=(tag,props,...children)=>({tag,props:props||{},children});
let workerFactory;
const momentMock = Object.assign(() => ({ format: () => '+07:00', isValid: () => true }), { default: () => ({ format: () => '+07:00', isValid: () => true }) });
const box=load('src/components/screens/workflow-instance-viewer/elsa-workflow-instance-journal/elsa-workflow-instance-journal.tsx',{'@stencil/core':{Component:decorator,Event:decorator,Method:decorator,Prop:decorator,State:decorator,Watch:decorator,h},'moment':momentMock,'../../../../utils/inspection-worker':{createInspectionWorker:()=>workerFactory()},'../../../../utils/dashboard-data':data,'../../../../utils/journal-occurrences':projection});
function nodes(v){return v&&typeof v==='object'?[v,...(v.children||[]).flat(Infinity).flatMap(nodes)]:[]}
test('content inspection uses original value while previews remain bounded',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();let opened=false;c.inspectionDialog={show:()=>opened=true};const value={ResponseContent:JSON.stringify({message:'x'.repeat(25000),password:'synthetic-secret'})};const before=JSON.stringify(value);const view=c.renderStructuredData(value,'Output','a');const button=nodes(view).find(x=>x.tag==='button'&&x.children.includes('View content'));assert(button);button.props.onClick();assert(opened);assert(c.inspectionText.includes('x'.repeat(25000)));assert(!c.inspectionText.includes('synthetic-secret'));assert.equal(JSON.stringify(value),before)});
test('inspection search is case insensitive and uses only the native modal close',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();let closed=false;c.inspectionDialog={show:v=>closed=!v};c.inspectionText=JSON.stringify({grossAmount:17.95,other:1},null,2);c.inspectionSearch='GROSS';const view=c.renderInspectionDialog(),all=nodes(view);assert(all.find(x=>x.tag==='pre').children[0].includes('grossAmount'));assert(!all.find(x=>x.tag==='pre').children[0].includes('other'));assert.equal(all.filter(x=>x.tag==='button'&&x.children.includes('Close')).length,0);assert.equal(all.filter(x=>x.tag==='button').length,1)});
test('clipboard failure is shown and never triggers a request',async()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();box.navigator.clipboard.writeText=async()=>{throw Error('denied')};await c.copyData({authorization:'secret'},'inspection',true);assert.equal(c.copyErrorKey,'inspection')});

test('structured fields expose View content without duplicated raw JSON rendering',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();const all=nodes(c.renderStructuredData({Outcomes:['Failed'],StatusCode:200,ResponseContent:'x'.repeat(32000)},'Execution data','a'));assert.equal(all.filter(x=>x.tag==='button').length,1);assert.equal(all.filter(x=>x.tag==='pre'||x.tag==='details').length,0);assert(all.find(x=>x.props['aria-label']==='View ResponseContent content'));assert(!JSON.stringify(all).includes('x'.repeat(1000)))});

test('raw data card has no copy action; copying is confined to the inspection modal',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();const card=nodes(c.renderData({value:1},'Raw event','a'));assert.equal(card.filter(x=>x.tag==='button').length,1);assert(card.find(x=>x.tag==='button').children.includes('Inspect content'));c.inspectionText='{"value":1}';const modal=nodes(c.renderInspectionDialog());assert.equal(modal.filter(x=>x.tag==='button').length,1);assert.equal(modal.find(x=>x.tag==='button').props['aria-label'],'Copy sanitized inspected JSON')});

test('expanded journal retains activity diagnostics and exception details without raw engine events',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();c.date=()=> 'Recorded time';c.selectedRecordId='e2';const occurrence={id:'e1',activityId:'a',number:1,outcome:'Faulted',uncertain:false,startedAt:1,endedAt:2,durationMs:1,representative:{id:'e2',activityId:'a',activityType:'GetEntityList'},records:[{id:'e1',activityId:'a',eventName:'Executing',data:{}},{id:'e2',activityId:'a',eventName:'Faulted',data:{Message:'Permission denied'}}]};const before=JSON.stringify(occurrence);const rendered=nodes(c.renderOccurrence(occurrence));const summaries=rendered.filter(x=>x.tag==='summary').map(x=>x.children.flat(Infinity).filter(x=>typeof x==='string').join(''));assert(summaries.includes('Exception details'));assert(!summaries.some(x=>x.includes('Raw Process Engine events')));assert(!rendered.some(x=>x.props.class==='uj-raw uj-raw-events'));assert.equal(JSON.stringify(occurrence),before)});

test('per-field inspection retains full original text and redacts sensitive fields',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();c.inspectionDialog={show:()=>{}};const original={ResponseContent:'x'.repeat(300000),password:'synthetic-secret'};const all=nodes(c.renderStructuredData(original,'Output','a'));all.find(x=>x.props['aria-label']==='View ResponseContent content').props.onClick();assert.equal(JSON.parse(c.inspectionText).ResponseContent.length,300000);assert(!c.inspectionText.includes('password'));assert(!all.find(x=>x.props['aria-label']==='View password content'));assert(!JSON.stringify(all).includes('synthetic-secret'))});
test('inspection progressively renders content without discarding text and Show all reveals the end',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();c.inspectionDialog={show:()=>{}};c.inspectValue({ResponseContent:'x'.repeat(300000)+'end-marker'},'Output');let view=nodes(c.renderInspectionDialog());assert(!view.find(x=>x.tag==='pre').children[0].includes('end-marker'));const showAll=view.find(x=>x.tag==='button'&&x.children.includes('Show all'));assert(showAll);showAll.props.onClick();view=nodes(c.renderInspectionDialog());assert(view.find(x=>x.tag==='pre').children[0].includes('end-marker'));c.inspectionSearch='end-marker';view=nodes(c.renderInspectionDialog());assert(view.find(x=>x.tag==='pre').children[0].includes('end-marker'))});

test('small scalar values and outcome badges need no content action; objects and arrays remain inspectable',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();const all=nodes(c.renderStructuredData({StatusCode:200,Ok:true,Empty:null,Text:'Short text',Outcomes:['Done'],Object:{a:1},Rows:[1,2]},'Output','a'));const actions=all.filter(x=>x.tag==='button').map(x=>x.props['aria-label']);assert.deepEqual(actions,['View Object content','View Rows content'])});

test('lazy inspection defaults masked, Show/Hide clears old data immediately and close discards revealed state',async()=>{
 const workers=[];workerFactory=()=>{const w={terminate(){this.terminated=true;},postMessage(data){this.request=data;}};workers.push(w);return w;};
 const c=new box.exports.ElsaWorkflowInstanceJournal();c.serverUrl='https://test.local';c.workflowInstance={inspectionCsrf:'csrf'};c.inspectionDialog={show:()=>{}};
 c.inspectValue({UserContext:{$inspection:{reference:'signed'}}},'UserContext');
 assert.equal(workers[0].request.reveal,false);assert.equal(c.inspectionText,'');
 await workers[0].onmessage({data:{text:'{"UserContext":"[REDACTED]"}',total:28,offset:0}});
 const show=c.fetchInspection(true);assert.equal(c.inspectionText,'');assert(workers[0].terminated);
 await workers[1].onmessage({data:{text:'{"password":"secret"}',total:21,offset:0}});await show;assert.equal(c.inspectionRevealed,true);
 const hide=c.fetchInspection(false);assert.equal(c.inspectionText,'');assert.equal(c.inspectionRevealed,false);
 await workers[1].onmessage({data:{text:'late-secret',total:11,offset:0}});assert.equal(c.inspectionText,'');
 await workers[2].onmessage({data:{text:'masked',total:6,offset:0}});await hide;assert.equal(c.inspectionText,'masked');
 c.clearInspection();assert.equal(c.inspectionText,'');assert.equal(c.inspectionReference,undefined);assert(workers[2].terminated);
});
test('revealed copy is audited through a new request and stale responses cannot populate another selection',async()=>{
 const workers=[];workerFactory=()=>{const w={terminate(){},postMessage(data){this.request=data;}};workers.push(w);return w;};
 const c=new box.exports.ElsaWorkflowInstanceJournal();c.serverUrl='https://test.local';c.workflowInstance={inspectionCsrf:'csrf'};c.inspectionReference='signed';c.inspectionRevealed=true;
 let copied;box.navigator.clipboard.writeText=async value=>copied=value;
 const copying=c.copyInspection();assert.equal(workers[0].request.action,'copy');assert.equal(workers[0].request.reveal,true);
 await workers[0].onmessage({data:{text:'complete original',copy:true}});await copying;assert.equal(copied,'complete original');
 const pending=c.fetchInspection(true);c.clearInspection();await workers[1].onmessage({data:{text:'late-original',total:13,offset:0}});await pending;assert.equal(c.inspectionText,'');
});

test('selecting an activity closes inspection instead of opening an empty modal',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();let hidden=0;c.inspectionDialog={hide:()=>hidden++,show:()=>{throw Error('Must not open during selection');}};c.selectRecord(undefined);assert.equal(hidden,1);assert.equal(c.inspectionText,'');});

test('Copy remains available for a loaded lazy field when search has no matches',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();c.inspectionReference='signed';c.inspectionText='';c.inspectionSearch='missing';const copy=nodes(c.renderInspectionDialog()).find(x=>x.tag==='button'&&x.props['aria-label']==='Copy masked JSON');assert.equal(copy.props.disabled,false);});

test('explicit retry reuses operation ID while each new Show uses a new ID',async()=>{const workers=[];workerFactory=()=>{const w={terminate(){},postMessage(data){this.request=data;}};workers.push(w);return w;};const c=new box.exports.ElsaWorkflowInstanceJournal();c.serverUrl='https://test.local';c.workflowInstance={inspectionCsrf:'csrf'};c.inspectionReference='signed';let pending=c.fetchInspection(true);const first=workers[0].request.operationId;await workers[0].onmessage({data:{error:'temporary'}});await pending;pending=c.fetchInspection(false,'view',true);assert.equal(workers[1].request.operationId,first);assert.equal(workers[1].request.reveal,true);await workers[1].onmessage({data:{text:'value',total:5,offset:0}});await pending;pending=c.fetchInspection(true);assert.notEqual(workers[2].request.operationId,first);await workers[2].onmessage({data:{text:'value',total:5,offset:0}});await pending;});

test('journal occurrences render 1-based step numbering and never Step 0',()=>{
  const c=new box.exports.ElsaWorkflowInstanceJournal();
  c.date=()=>'Now';
  c.records={items:[
    {id:'r1',activityId:'act1',eventName:'Executing',timestamp:new Date(1000).toISOString()},
    {id:'r2',activityId:'act1',eventName:'Executed',timestamp:new Date(2000).toISOString()},
    {id:'r3',activityId:'act2',eventName:'Executing',timestamp:new Date(3000).toISOString()},
    {id:'r4',activityId:'act2',eventName:'Executed',timestamp:new Date(4000).toISOString()}
  ],totalCount:4};
  const view=nodes(c.renderJournal());
  const meta=view.filter(x=>x.tag==='span'&&x.props.class==='uj-meta').map(x=>x.children.flat(Infinity).join(''));
  assert(meta.some(m=>m.includes('Step 1')));
  assert(meta.some(m=>m.includes('Step 2')));
  assert(!meta.some(m=>m.includes('Step 0')));
});

test('deferred generic fields with nested sensitive values render Show action in inspection modal',()=>{
  const c=new box.exports.ElsaWorkflowInstanceJournal();
  c.inspectionDialog={show:()=>{}};
  c.inspectValue({ResponseContent:{$inspection:{reference:'signed-ref',sensitive:false}}},'ResponseContent');
  assert.equal(c.inspectionReference,'signed-ref');
  assert(!nodes(c.renderInspectionDialog()).find(x=>x.tag==='button'&&x.children.includes('Show sensitive values')));
  c.inspectionHasRedactions=true;
  const dialog=nodes(c.renderInspectionDialog());
  const showBtn=dialog.find(x=>x.tag==='button'&&x.children.includes('Show sensitive values'));
  assert(showBtn,'Show appears only after masked content reports redactions');
  c.inspectionRevealed=true;
  assert(nodes(c.renderInspectionDialog()).find(x=>x.tag==='button'&&x.children.includes('Hide sensitive values')));
  c.clearInspection();
});

test('interactive KPI cards, keyboard navigation, slow bottleneck badge, state context header, and modal wrap/clear controls work ergonomically',async()=>{
  const c=new box.exports.ElsaWorkflowInstanceJournal();
  c.date=()=>'Now';
  let selectedTab;
  c.flyoutPanel={selectTab:async t=>{selectedTab=t;}};
  c.workflowInstance={inspectionEnabled:true,activityData:{act2:{Url:'https://example.com'}}};
  c.records={items:[
    {id:'r1',activityId:'act1',activityType:'FastStep',eventName:'Executing',timestamp:new Date(1000).toISOString()},
    {id:'r2',activityId:'act1',activityType:'FastStep',eventName:'Executed',timestamp:new Date(1200).toISOString()},
    {id:'r3',activityId:'act2',activityType:'SlowFaultStep',eventName:'Executing',timestamp:new Date(2000).toISOString()},
    {id:'r4',activityId:'act2',activityType:'SlowFaultStep',eventName:'Faulted',timestamp:new Date(5000).toISOString(),data:{Message:'Timeout'}}
  ],totalCount:4};

  let jView=nodes(c.renderJournal());
  const slowBadge=jView.find(x=>x.tag==='span'&&typeof x.props.class==='string'&&x.props.class.includes('uj-slow'));
  assert(slowBadge,'Slow bottleneck badge should render for 3000ms step');
  const faultStat=jView.find(x=>x.tag==='div'&&typeof x.props.class==='string'&&x.props.class.includes('uj-stat-danger'));
  assert(faultStat);
  faultStat.props.onClick();
  assert.equal(c.filter,'faulted');
  faultStat.props.onClick();
  assert.equal(c.filter,'all');

  jView=nodes(c.renderJournal());
  const rows=jView.filter(x=>x.tag==='button'&&x.props.class==='uj-row');
  assert.equal(rows.length,2);
  rows[0].props.onKeyDown({key:'ArrowDown',preventDefault:()=>{}});
  assert.equal(c.selectedActivityId,'act2');

  const stateView=nodes(c.renderState());
  const jumpChip=stateView.find(x=>x.tag==='span'&&x.props.class==='uj-link-chip');
  assert(jumpChip,'State tab should render Jump to journal step chip');
  await jumpChip.props.onClick();
  assert.equal(selectedTab,'journal');

  c.inspectionText='{"hello":"world"}';
  c.inspectionSearch='hello';
  let modal=nodes(c.renderInspectionDialog());
  const clearSpan=modal.find(x=>x.tag==='span'&&x.props.class==='uj-search-clear');
  assert(clearSpan);
  clearSpan.props.onClick();
  assert.equal(c.inspectionSearch,'');

  const wrapInput=modal.find(x=>x.tag==='input'&&x.props.type==='checkbox');
  assert(wrapInput);
  wrapInput.props.onChange({target:{checked:false}});
  assert.equal(c.inspectionWrap,false);
  modal=nodes(c.renderInspectionDialog());
  assert(modal.find(x=>x.tag==='pre').props.class.includes('uj-nowrap'));
});

test('plain content has no security banner and closing clears redaction state',()=>{const c=new box.exports.ElsaWorkflowInstanceJournal();c.inspectionText='plain';assert(!nodes(c.renderInspectionDialog()).find(x=>String(x.props.class||'').includes('uj-security-bar')));c.inspectionHasRedactions=true;c.clearInspection();assert.equal(c.inspectionHasRedactions,false);});

test('external fields show their stored path with a copy action; other fields do not',()=>{
 const c=new box.exports.ElsaWorkflowInstanceJournal();
 const path='s3://bucket/workflow/qatest/i/a/ResponseContent.json';
 const all=nodes(c.renderStructuredData({ResponseContent:{$inspection:{reference:'signed',kind:'external',location:path}},Big:{$inspection:{reference:'signed2',kind:'object',bytes:10}}},'Output','a'));
 const code=all.filter(x=>x.tag==='code');
 assert.equal(code.length,1);assert.equal(code[0].children[0],path);
 const copy=all.filter(x=>x.tag==='elsa-copy-button');
 assert.equal(copy.length,1);assert.equal(copy[0].props.value,path);
 assert(all.find(x=>x.props['aria-label']==='View ResponseContent content'));
});
test('version notice from the worker is shown in the dialog and cleared on close',async()=>{
 const workers=[];workerFactory=()=>{const w={terminate(){},postMessage(data){this.request=data;}};workers.push(w);return w;};
 const c=new box.exports.ElsaWorkflowInstanceJournal();c.serverUrl='https://test.local';c.workflowInstance={inspectionCsrf:'csrf'};c.inspectionDialog={show:()=>{}};
 c.inspectValue({ResponseContent:{$inspection:{reference:'signed',kind:'external'}}},'ResponseContent');
 await workers[0].onmessage({data:{text:'{"ResponseContent":1}',total:21,offset:0,notice:'Stored version from this execution (2026-11-09 10:50:13 UTC).'}});
 const text=JSON.stringify(nodes(c.renderInspectionDialog()));
 assert(text.includes('Stored version from this execution'));
 c.clearInspection();assert.equal(c.inspectionNotice,undefined);
});

test('unavailable historical external content renders label directly without View content button or path row',()=>{
 const c=new box.exports.ElsaWorkflowInstanceJournal();
 const all=nodes(c.renderStructuredData({
   UnverifiedField:{$inspection:{kind:'unavailable',unavailable:true,message:'Historical content unavailable'}},
   VerifiedField:{$inspection:{reference:'signed',kind:'external',location:'s3://b/k'}}
 },'Output','a'));
 const text=JSON.stringify(all);
 assert(text.includes('Historical content unavailable'));
 assert(!all.find(x=>x.props && x.props['aria-label']==='View UnverifiedField content'));
 assert(all.find(x=>x.props && x.props['aria-label']==='View VerifiedField content'));
 const code=all.filter(x=>x.tag==='code');
 assert.equal(code.length,1);
 assert.equal(code[0].children[0],'s3://b/k');
});
