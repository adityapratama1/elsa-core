const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const ts = require('typescript');
function load(file, dependencies) {
 const code = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText;
 const sandbox={exports:{},require:id=>Object.prototype.hasOwnProperty.call(dependencies,id)?dependencies[id]:require(id),URL,console};
 vm.runInNewContext(code,sandbox); return sandbox.exports;
}
test('instance list uses registered collection route and preserves filters (HTTP 200)',async()=>{
 const requests=[];
 const server=http.createServer((req,res)=>{
  requests.push(req.url); res.setHeader('Content-Type','application/json');
  if(new URL(req.url,'http://local').pathname!='/v1/workflow-instances'){res.statusCode=404;res.end('{}');return;}
  res.end(JSON.stringify({items:[],page:0,pageSize:25,totalCount:0}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const clientModule=load('src/services/elsa-client.ts',{'axios':{default:require('axios')},
   './event-bus':{eventBus:{emit:async()=>{}}},
   '../models':{EventTypes:{},getVersionOptionsString:()=>''}
  });
  const client=await clientModule.createElsaClient(`http://127.0.0.1:${server.address().port}/`);
  const result=await client.workflowInstancesApi.list(); assert.equal(result.totalCount,0);
  await client.workflowInstancesApi.list(2,50,'definition','Faulted','Started','needle','record');
  assert.equal(requests[0],'/v1/workflow-instances');
  const url=new URL(requests[1],'http://local');
  assert.equal(url.pathname,'/v1/workflow-instances');
  for(const [key,value] of Object.entries({workflow:'definition',status:'Faulted',orderBy:'Started',correlationId:'record',searchTerm:'needle',page:'2',pageSize:'50'})) assert.equal(url.searchParams.get(key),value);
 } finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
});
test('stale checkpoint menu and route are not activated',()=>{
 const source=fs.readFileSync('src/components/dashboard/pages/elsa-studio-dashboard/elsa-studio-dashboard.tsx','utf8');
 assert.ok(!source.includes("['stale-checkpoints',"));
 assert.ok(source.includes("['workflow-instances', 'Workflow Instances']"));
 assert.ok(source.includes("['workflow-instances', 'elsa-studio-workflow-instances-list', true]"));
});
