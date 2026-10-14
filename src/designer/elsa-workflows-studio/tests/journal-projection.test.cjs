const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const input = fs.readFileSync(path.join(__dirname, '../src/utils/journal-occurrences.ts'), 'utf8');
const source = ts.transpileModule(input, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
const sandbox = {exports:{}, Date, Map, Set, Number};
vm.runInNewContext(source, sandbox);
const {journalOccurrences: project, journalDuration: duration} = sandbox.exports;
test('structured values use tables only for uniform shallow records',()=>{
 const shape=sandbox.exports.journalValueShape;
 assert.equal(shape([{Name:'A',Count:0,Enabled:false},{Name:'B',Count:2,Enabled:true}]).kind,'table');
 assert.equal(shape([{Name:'A'},{Other:'B'}]).kind,'array');
 assert.equal(shape([{Nested:{Value:1}}]).kind,'array');
 assert.equal(shape([]).count,0);assert.equal(shape(null).preview,'null');assert.equal(shape(false).preview,'false');assert.equal(shape(0).preview,'0');
});
test('structured preview classification is bounded and does not change source data',()=>{
 const rows=Array.from({length:1000},(_,id)=>({id,Value:'text'})),before=JSON.stringify(rows);
 const shape=sandbox.exports.journalValueShape(rows);
 assert.equal(shape.count,1000);assert.equal(shape.kind,'table');assert.equal(JSON.stringify(rows),before);
});
test('outcome tags are recorded, case-compatible and unique',()=>{
 const occurrence={records:[{data:{Outcomes:['Done','200']}},{data:{outcomes:['200','Unsupported Status Code']}},{data:{Outcomes:[]}}]};
 assert.equal(sandbox.exports.journalOutcomes(occurrence).join('|'),'Done|200|Unsupported Status Code');
});
test('execution output takes precedence over current snapshot and preserves false',()=>{
 const occurrence={activityId:'a',records:[{data:{ActivityOutput:false}}]};
 const output=sandbox.exports.journalActivityOutput(occurrence,{activityOutput:{a:'later'}},{});
 assert.equal(output.value,false);assert.equal(output.source,'execution');
});
test('snapshot output handles null and declared output fields without including inputs',()=>{
 const occurrence={activityId:'a',records:[]};
 const direct=sandbox.exports.journalActivityOutput(occurrence,{activityOutput:{a:null}},{});
 assert.equal(direct.value,null);assert.equal(direct.source,'snapshot');
 const instance={activityData:{a:{count:0,Success:false,Input:'secret'}}};
 const output=sandbox.exports.journalActivityOutput(occurrence,instance,{outputProperties:[{name:'Count'},{name:'Success'}]});
 assert.equal(JSON.stringify(output.value),'{"Count":0,"Success":false}');
 assert.equal(sandbox.exports.journalActivityOutput(occurrence,instance,{outputProperties:[]}),undefined);
});
test('journal defaults oldest first and copies untruncated data',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../src/components/screens/workflow-instance-viewer/elsa-workflow-instance-journal/elsa-workflow-instance-journal.tsx'),'utf8');
 assert.ok(ui.includes('@State() latestFirst = false'));
 assert.ok(ui.includes('navigator.clipboard.writeText(JSON.stringify(value, null, 2))'));
 assert.ok(!ui.includes('navigator.clipboard.writeText(this.raw('));
});
let id = 0;
const event = (eventName, seconds, activityId='http') => ({id:String(++id),workflowInstanceId:'workflow',activityId,activityType:'SendHttpRequest',timestamp:new Date(1720000000000+seconds*1000),eventName});
test('one hour timeout remains Faulted despite Executed result handling', () => {
 const start=event('Executing',0), fault=event('Faulted',3600), handled=event('Executed',3600.001);
 const result=project([start,fault,handled]);
 assert.equal(result.length,1); assert.equal(result[0].outcome,'Faulted');
 assert.equal(result[0].durationMs,3600000); assert.equal(result[0].representative.id,fault.id);
 assert.equal(duration(result[0].durationMs),'1h 0m');
});
test('repeated activity executions and resumptions are kept separate', () => {
 const result=project([event('Executing',0),event('Executed',1),event('Resuming',50),event('Resumed',51)]);
 assert.equal(result.length,2); assert.equal(result[0].durationMs,1000); assert.equal(result[1].durationMs,1000);
 assert.equal(result[1].number,2); assert.equal(result[1].outcome,'Result handled');
});
test('unrelated events never supply a duration', () => {
 const result=project([event('Executed',0,'capture'),event('Faulted',3600,'http'),event('Executed',3600.001,'http')]);
 assert.equal(result[1].outcome,'Faulted'); assert.equal(result[1].durationMs,undefined);
});
test('partial history is explicitly uncertain even when both boundaries loaded', () => {
 const result=project([event('Executing',0),event('Executed',1)],false);
 assert.equal(result[0].outcome,'Evidence incomplete'); assert.equal(result[0].durationMs,undefined);
});
test('overlapping starts do not produce authoritative pairings', () => {
 const result=project([event('Executing',0),event('Executing',1),event('Executed',2)]);
 assert.equal(result[0].outcome,'Evidence incomplete'); assert.equal(result[1].durationMs,undefined);
});
test('awaiting result means no terminal evidence, not proof of an active worker', () => {
 const result=project([event('Executing',0)]); assert.equal(result[0].outcome,'Awaiting result'); assert.equal(result[0].durationMs,undefined);
});
test('raw timestamps and event names are never mutated', () => {
 const records=[event('Executing',0),event('Faulted',10),event('Executed',10.001)];
 const before=JSON.stringify(records); project(records); assert.equal(JSON.stringify(records),before);
});
test('out of order input and duplicate IDs are normalized', () => {
 const first=event('Executing',0), last=event('Executed',1);
 const result=project([last,first,last]); assert.equal(result[0].records.length,2); assert.equal(result[0].durationMs,1000);
});
test('invalid timestamps do not invent a duration', () => {
 const first=event('Executing',0); first.timestamp='invalid';
 assert.equal(project([first,event('Executed',1)])[0].durationMs,undefined);
 assert.equal(duration(undefined),'Unavailable');
});
test('log API sends page zero, so journal reads are bounded', () => {
 const client=fs.readFileSync(path.join(__dirname,'../src/services/elsa-client.ts'),'utf8');
 const logSection=client.split('workflowExecutionLogApi: {')[1].split('scriptingApi: {')[0];
 assert.match(logSection,/page !== undefined && page !== null/);
});
