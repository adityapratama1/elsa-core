const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const text=fs.readFileSync(path.join(__dirname,'../src/components/screens/workflow-instance-viewer/elsa-workflow-instance-viewer-screen/elsa-workflow-instance-viewer-screen.tsx'),'utf8');
const source=ts.createSourceFile('viewer.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const cls=source.statements.find(n=>ts.isClassDeclaration(n)),method=cls.members.find(n=>n.name?.getText(source)==='mapActivityModel');
const code='exports.map = '+method.getText(source).replace(/^mapActivityModel/,'function');
function project(descriptors,blueprint,instance){const box={exports:{},state:{activityDescriptors:descriptors},SyntaxNames:{Literal:'Literal'},collection:{map:(o,f)=>Object.entries(o).map(([k,v])=>f(v,k))}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2017}}).outputText,box);return box.exports.map(blueprint,instance);}
test('unknown legacy activity and absent state do not crash the viewer',()=>{const result=project([],{id:'legacy',type:'LegacyUnknown'},{});assert.equal(result.activityId,'legacy');assert.equal(result.outcomes.length,0);assert.equal(result.properties.length,0);});
test('recorded false, zero and empty string override definition defaults',()=>{const descriptor={type:'Action',inputProperties:[],outputProperties:[],outcomes:['Done']};const blueprint={id:'a',type:'Action',inputProperties:{data:{flag:true,count:99,text:'default'}}};const result=project([descriptor],blueprint,{activityData:{a:{flag:false,count:0,text:''}}});assert.equal(result.properties[0].value,false);assert.equal(result.properties[1].value,0);assert.equal(result.properties[2].value,'');});

const joInput = fs.readFileSync(path.join(__dirname, '../src/utils/journal-occurrences.ts'), 'utf8');
const joSandbox = {exports:{}, Date, Map, Set, Number};
vm.runInNewContext(ts.transpileModule(joInput, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText, joSandbox);
const { journalResult } = joSandbox.exports;

const borderMember = cls.members.find(n => n.name?.getText(source) === 'getActivityBorderColor');
const borderFnCode = 'exports.getBorderColor = ' + borderMember.initializer.getText(source);
const borderJs = ts.transpileModule(borderFnCode, { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;

function testBorderColor(instance, occurrences, activity) {
  const ctx = {
    exports: {},
    journalResult,
    workflowInstance: instance,
    journalOccurrences: occurrences || []
  };
  vm.runInNewContext(borderJs, ctx);
  return ctx.exports.getBorderColor(activity);
}

test('activity border color maps fatal faults to red', () => {
  const instance = { faults: [{ faultedActivityId: 'act-1' }], activityData: {} };
  assert.equal(testBorderColor(instance, [], { activityId: 'act-1' }), 'red');
});

test('activity border color maps handled failure to yellow and normal execution to green', () => {
  const handledFailInstance = { faults: [], activityData: { 'act-fail': { _Lifecycle: { executed: true }, Outcomes: ['Failed'] } } };
  assert.equal(testBorderColor(handledFailInstance, [], { activityId: 'act-fail' }), 'yellow');

  const falseSuccessInstance = { faults: [], activityData: { 'act-false': { _Lifecycle: { executed: true }, Success: false } } };
  assert.equal(testBorderColor(falseSuccessInstance, [], { activityId: 'act-false' }), 'yellow');

  const occFaultInstance = { faults: [], activityData: { 'act-occ': { _Lifecycle: { executed: true } } } };
  assert.equal(testBorderColor(occFaultInstance, [{ activityId: 'act-occ', outcome: 'Faulted', raw: [] }], { activityId: 'act-occ' }), 'yellow');

  const normalInstance = { faults: [], activityData: { 'act-ok': { _Lifecycle: { executed: true }, Outcomes: ['Done'] } } };
  assert.equal(testBorderColor(normalInstance, [], { activityId: 'act-ok' }), 'green');
});
