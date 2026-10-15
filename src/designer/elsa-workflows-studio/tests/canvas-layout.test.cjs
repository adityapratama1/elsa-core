const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/utils/canvas-layout.ts'),'utf8');
const sandbox={exports:{},Number,Set};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText,sandbox);
const {inspectCanvas,escapeGraphText,fitCanvas}=sandbox.exports;
test('detached nodes are not synthetic parallel StartProcess branches',()=>{
 const model={activities:[{activityId:'start',type:'StartProcess'},{activityId:'main'},{activityId:'orphan'},{activityId:'child'}],connections:[{sourceId:'start',targetId:'main',outcome:'Done'},{sourceId:'orphan',targetId:'child',outcome:'Done'}]};
 const before=JSON.stringify(model),graph=inspectCanvas(model);
 assert.equal(graph.entryRoots.map(a=>a.activityId).join(','),'start');
 assert.equal(graph.detached.map(a=>a.activityId).join(','),'orphan,child');
 assert.equal(graph.connections.length,2);assert.equal(JSON.stringify(model),before);
});
test('generic workflows without StartProcess keep all entry candidates',()=>{
 const graph=inspectCanvas({activities:[{activityId:'a'},{activityId:'b'}],connections:[]});
 assert.equal(graph.entryRoots.length,2);assert.equal(graph.detached.length,0);
});
test('orthogonal routes retain endpoints and only contain axis-aligned segments',()=>{
 for(const vertical of [true,false]) {
   const points=[{x:17,y:23},{x:80,y:140},{x:230,y:210}],before=JSON.stringify(points);
   const route=sandbox.exports.orthogonalRoute(points,vertical);
   assert.equal(JSON.stringify(route[0]),JSON.stringify(points[0]));assert.equal(JSON.stringify(route.at(-1)),JSON.stringify(points.at(-1)));
   assert.ok(route.slice(1).every((p,i)=>p.x===route[i].x||p.y===route[i].y));assert.equal(JSON.stringify(points),before);
 }
 const route=sandbox.exports.orthogonalRoute([{x:0,y:0},{x:100,y:100}]);assert.equal(route[1].y%30,0);
});
test('orthogonal D3 curve does not emit curved commands',()=>{
 const commands=[],curve=sandbox.exports.orthogonalCurve()({moveTo:(x,y)=>commands.push(['M',x,y]),lineTo:(x,y)=>commands.push(['L',x,y])});
 curve.lineStart();curve.point(10,10);curve.point(130,200);curve.lineEnd();assert.ok(commands.length>=4);assert.ok(commands.every(x=>['M','L'].includes(x[0])));
});
test('shared target has one visual route with every outcome and immutable source',()=>{
 const connections=[{sourceId:'a',targetId:'b',outcome:'Timeout'},{sourceId:'a',targetId:'b',outcome:'Failed'},{sourceId:'a',targetId:'c',outcome:'200'}];
 const before=JSON.stringify(connections),routes=sandbox.exports.groupCanvasConnections(connections);
 assert.equal(routes.length,2);assert.equal(routes[0].outcomes.join(','),'Timeout,Failed');assert.equal(JSON.stringify(connections),before);
});
test('missing endpoint is excluded from drawing without altering definition',()=>{
 const model={activities:[{activityId:'a'},{activityId:'b'}],connections:[{sourceId:'a',targetId:'b',outcome:'Done'},{sourceId:'a',targetId:'missing',outcome:'Done'}]};
 const before=JSON.stringify(model),graph=inspectCanvas(model);assert.equal(graph.connections.length,1);assert.equal(graph.issues.length,1);assert.equal(JSON.stringify(model),before);
});
test('duplicate activities do not overwrite one another silently',()=>{const graph=inspectCanvas({activities:[{activityId:'a'},{activityId:'a'}],connections:[]});assert.equal(graph.activities.length,1);assert.equal(graph.issues.length,1);});
test('parallel outcomes and cycles are preserved',()=>{const graph=inspectCanvas({activities:[{activityId:'a'},{activityId:'b'}],connections:[{sourceId:'a',targetId:'b',outcome:'200'},{sourceId:'a',targetId:'b',outcome:'Done'},{sourceId:'b',targetId:'a',outcome:'Repeat'}]});assert.equal(graph.connections.length,3);assert.equal(graph.issues.length,0);});
test('root discovery uses validated links, not phantom targets',()=>{const graph=inspectCanvas({activities:[{activityId:'a'}],connections:[{sourceId:'missing',targetId:'a'}]});assert.equal(graph.roots[0].activityId,'a');});
test('labels cannot break their HTML wrapper',()=>{assert.equal(escapeGraphText('<img src=x> "&\''),'&lt;img src=x&gt; &quot;&amp;&#39;');});
test('fit transform is finite and bounded',()=>{const fit=fitCanvas({x:20,y:10,width:1000,height:2000},800,600);assert.ok(fit.scale>=.1&&fit.scale<=1);assert.ok(Number.isFinite(fit.x)&&Number.isFinite(fit.y));assert.equal(fitCanvas({x:0,y:0,width:10,height:10},0,0),null);});
test('empty and missing models do not crash inspection',()=>{assert.equal(inspectCanvas(null).activities.length,0);assert.equal(inspectCanvas({}).issues.length,0);});
test('selection changes highlight, not layout; selectors are canvas scoped',()=>{const renderer=fs.readFileSync(path.join(__dirname,'../src/components/designers/tree/elsa-designer-tree/elsa-designer-tree.tsx'),'utf8');const selected=renderer.split("@Watch('selectedActivityIds')")[1].split("@Watch('layoutDirection')")[0];assert.ok(selected.includes('updateHighlight()'));assert.ok(!selected.includes('safeRender()'));assert.ok(!renderer.includes("d3.select('.node.start')"));assert.ok(!renderer.includes("d3.selectAll('.node')"));assert.ok(!renderer.includes('traits &='));});
test('renderer CSS is imported through the pinned compiler stylesheet',()=>{const css=fs.readFileSync(path.join(__dirname,'../src/components/designers/tree/elsa-designer-tree/elsa-designer-tree.css'),'utf8');assert.ok(css.includes("@import './canvas-ui.css'"));});
