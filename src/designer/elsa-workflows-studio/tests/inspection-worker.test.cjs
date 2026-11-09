const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function make(fetch){const messages=[];const ctx={};const box={exports:{},self:ctx,fetch,AbortController,setTimeout,clearTimeout};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/inspection-worker.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2018}}).outputText,box);ctx.postMessage=x=>messages.push(x);box.exports.inspectionWorkerMain();return {ctx,messages};}
test('worker keeps complete payload off UI until copy and allows navigation to the end',async()=>{const payload='x'.repeat(1048576)+'END';let request;const w=make(async(url,options)=>{request=JSON.parse(options.body);return{ok:true,text:async()=>payload};});await w.ctx.onmessage({data:{id:1,command:'load',url:'/content',csrf:'token',reference:'protected',operationId:'operation-one',reveal:false,action:'view'}});assert.equal(w.messages[0].text.length,20000);assert.equal(w.messages[0].total,payload.length);assert.equal(request.reveal,false);assert.equal(request.operationId,'operation-one');await w.ctx.onmessage({data:{id:1,command:'window',offset:1048570}});assert(w.messages[1].text.endsWith('END'));await w.ctx.onmessage({data:{id:2,command:'load',url:'/content',csrf:'token',reference:'protected',reveal:true,action:'copy'}});assert.equal(w.messages[2].text,payload);assert.equal(request.action,'copy');assert.equal(request.reveal,true);});
test('worker errors never display server exception bodies',async()=>{const w=make(async()=>({ok:false,status:503,text:async()=> 'internal-secret'}));await w.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});assert(w.messages[0].error);assert(!JSON.stringify(w.messages).includes('internal-secret'));});
test('worker search operates over full content while returning a bounded window',async()=>{const w=make(async()=>({ok:true,text:async()=> 'x'.repeat(100000)+'\nUnique needle\nother'}));await w.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});await w.ctx.onmessage({data:{id:1,command:'window',query:'NEEDLE'}});assert.equal(w.messages[1].text,'Unique needle');});

test('formatting never coerces numeric precision or date strings',async()=>{const raw='{"amount":1234567890.123456789,"when":"2026-11-07T00:00:00+07:00"}';const w=make(async()=>({ok:true,text:async()=>raw}));await w.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});assert(w.messages[0].text.includes('1234567890.123456789'));assert(w.messages[0].text.includes('2026-11-07T00:00:00+07:00'));await w.ctx.onmessage({data:{id:2,command:'load',url:'/content',action:'copy'}});assert.equal(w.messages[1].text,raw);});

test('redactions are detected across the complete content, outside the visible or searched window',async()=>{
 const w=make(async()=>({ok:true,text:async()=> 'x'.repeat(25000)+'[REDACTED]'}));
 await w.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});
 assert.equal(w.messages[0].hasRedactions,true);assert(!w.messages[0].text.includes('[REDACTED]'));
 await w.ctx.onmessage({data:{id:1,command:'window',query:'missing'}});
 assert.equal(w.messages[1].hasRedactions,true);
 const plain=make(async()=>({ok:true,text:async()=> 'ordinary content'}));
 await plain.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});
 assert.equal(plain.messages[0].hasRedactions,false);
});

test('worker forwards the version notice and the reason for gone external content',async()=>{
 const ok=make(async()=>({ok:true,headers:{get:n=>n==='X-Inspection-Notice'?'Stored version from this execution (2026-11-09 10:50:13 UTC).':null},text:async()=> '{"Value":1}'}));
 await ok.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});
 assert.equal(ok.messages[0].notice,'Stored version from this execution (2026-11-09 10:50:13 UTC).');
 await ok.ctx.onmessage({data:{id:1,command:'window',offset:0}});
 assert.equal(ok.messages[1].notice,'Stored version from this execution (2026-11-09 10:50:13 UTC).');
 const gone=make(async()=>({ok:false,status:410,json:async()=>({message:'No stored version exists for this execution.'}),text:async()=> 'unused'}));
 await gone.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});
 assert.equal(gone.messages[0].error,'No stored version exists for this execution.');
 const plain=make(async()=>({ok:true,text:async()=> '{}'}));
 await plain.ctx.onmessage({data:{id:1,command:'load',url:'/content'}});
 assert.equal(plain.messages[0].notice,'');
});
