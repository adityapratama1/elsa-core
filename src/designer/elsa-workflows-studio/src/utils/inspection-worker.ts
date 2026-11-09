// Full content stays in a dedicated worker; the UI receives only the visible window.
export function inspectionWorkerMain() {
  const ctx: any = self;
  const format = (raw: string) => {
    const trimmed = raw.trimStart();
    if (!['{','['].includes(trimmed[0])) return raw;
    if (trimmed.startsWith('{\n') || trimmed.startsWith('[\n')) return raw;
    const parts: string[] = []; let depth = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') {const start=i++;for (; i < raw.length; i++) {if(raw[i] === '\\') i++;else if(raw[i] === '"') break;}parts.push(raw.slice(start,i+1));}
      else if(c === '{' || c === '[') {depth++;parts.push(c,'\n','  '.repeat(depth));}
      else if(c === '}' || c === ']') {depth=Math.max(0,depth-1);parts.push('\n','  '.repeat(depth),c);}
      else if(c === ',')parts.push(',\n','  '.repeat(depth));
      else if(c === ':')parts.push(': ');
      else if(!/\s/.test(c)){const start=i;while(i+1<raw.length&&!/[\s,}\]]/.test(raw[i+1]))i++;parts.push(raw.slice(start,i+1));}
    }
    return parts.join('');
  };
  let text = '';
  let hasRedactions = false;
  let notice = '';
  let controller: AbortController;
  ctx.onmessage = async ({data}: any) => {
    const {id, command} = data;
    try {
      if (command === 'load') {
        controller?.abort(); controller = new AbortController(); text = ''; notice = '';
        const timer = setTimeout(() => controller.abort(), 120000);
        try {
          const response = await fetch(data.url, {method:'POST', credentials:'same-origin', signal:controller.signal,
            headers:{'Content-Type':'application/json','X-XSRF-TOKEN':data.csrf},
            body:JSON.stringify({reference:data.reference,reveal:data.reveal,action:data.action,operationId:data.operationId})});
          if (!response.ok) {
            // 410: the external object or the version for this execution no longer exists; show the server's reason.
            let reason = '';
            if (response.status === 410) {try {const body = await response.json(); reason = (body && body.message) || '';} catch (_) {reason = '';}}
            throw new Error(response.status === 410 ? (reason || 'External content no longer exists.') : response.status === 409 ? 'Recorded data changed or inspection expired. Refresh the workflow.' : 'Content could not be loaded. Check access, audit availability, or retry.');
          }
          notice = (response.headers && typeof response.headers.get === 'function' && response.headers.get('X-Inspection-Notice')) || '';
          const raw = await response.text();hasRedactions=raw.includes('[REDACTED]');text=format(raw);
          if (data.action === 'copy') {ctx.postMessage({id,text:raw,copy:true,hasRedactions,notice}); return;}
        } finally {clearTimeout(timer);}
      }
      if (command === 'load' || command === 'window') {
        const query = (data.query || '').trim().toLowerCase();
        let content = text;
        let matchCount = 0;
        if (query) {
          const lines = text.split('\n');
          const matched = lines.filter(line => line.toLowerCase().includes(query));
          matchCount = matched.length;
          content = matched.join('\n');
        }
        const offset = data.offset || 0;
        ctx.postMessage({id,text:content.slice(offset,offset+20000),total:content.length,offset,matchCount,hasRedactions,notice});
      }
    } catch(error) {ctx.postMessage({id,error:error.name === 'AbortError' ? 'Inspection cancelled or timed out.' : error.message});}
  };
}
export function createInspectionWorker(): Worker {
  const url = URL.createObjectURL(new Blob([`(${inspectionWorkerMain.toString()})()`], {type:'application/javascript'}));
  try {return new Worker(url);} finally {URL.revokeObjectURL(url);}
}
