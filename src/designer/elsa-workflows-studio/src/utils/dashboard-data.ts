export const hiddenValue = '[REDACTED]';

export function sensitiveField(name: string): boolean {
  const key = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /password|passwd|pwd|secret|token|authorization|credential|connectionstring|privatekey|apikey|accesskey|securitykey|cookie|sessionid|email|phone|mobile|ssn|nationalid|passport|creditcard|cardnumber|cvv|bankaccount|iban|dateofbirth|birthdate|homeaddress|postaladdress|fullname|firstname|lastname/.test(key) || /^(pin|otp|signature|sig|sastoken|nik|npwp|address)$/.test(key);
}

// Apply at the presentation/copy boundary; never alter workflow execution state.
export function dashboardData(value: any, name = '', depth = 0, budget: {remaining: number; characters?: number} = {remaining: 2000}, ancestors = new Set<any>(), maxStringLength = 20000, fullInspection = false): any {
  if (sensitiveField(name)) return hiddenValue;
  if (!fullInspection && (depth > 12 || --budget.remaining < 0)) return '[Display limit reached]';
  if (typeof value === 'string') {
    if (!fullInspection && value.length > maxStringLength) return `[Large text preview omitted: ${value.length.toLocaleString()} characters. Use Inspect content.]`;
    if (budget.characters === undefined) budget.characters = 1000000;
    if (!fullInspection && value.length > budget.characters) return '[Total content inspection limit reached]';
    budget.characters -= value.length;
    const trimmed = value.trim();
    // JSON carried inside HTTP responses and string variables needs the same policy.
    if (/^[\[{]/.test(trimmed)) {
      try { return JSON.stringify(dashboardData(JSON.parse(trimmed), '', depth + 1, budget, ancestors, maxStringLength, fullInspection)); } catch { /* Treat as text. */ }
    }
    if (/\b(?:Bearer|Basic)\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/i.test(value)) return hiddenValue;
    if (/(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|signature|sig|x-amz-signature|x-amz-credential)\s*[=:]\s*\S+/i.test(value)) return hiddenValue;
    if (value.includes('://') && value.includes('@') && /(^|[^a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/]+:[^\s/]+@/i.test(value)) return hiddenValue;
    const maskedEmail = value.includes('@') ? value.replace(/(^|[^A-Z0-9.!#$%&'*+/=?^_`{|}~-])([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+)/gi, '$1' + hiddenValue) : value;
    return maskedEmail.replace(/\b\d{3}-\d{2}-\d{4}\b|\+\d[\d ().-]{8,}\d/g, hiddenValue);
  }
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular reference]';
  ancestors.add(value);
  let result: any;
  if (Array.isArray(value)) {
    result = (fullInspection ? value : value.slice(0,2000)).map(item => dashboardData(item,'',depth + 1,budget,ancestors,maxStringLength,fullInspection));
    if (!fullInspection && value.length > 2000) result.push('[Display limit reached]');
  } else {
    result = Object.create(null);
    // Header/property models often carry {name: 'Authorization', value: '...'}.
    const descriptor = value.name ?? value.Name ?? value.key ?? value.Key;
    const protectedValue = typeof descriptor === 'string' && sensitiveField(descriptor);
    for (const [key,item] of Object.entries(value).slice(0,fullInspection ? undefined : 2000)) {
      result[key] = protectedValue && /^(value|values|expression)$/i.test(key) ? hiddenValue : dashboardData(item,key,depth + 1,budget,ancestors,maxStringLength,fullInspection);
    }
    if (!fullInspection && Object.keys(value).length > 2000) result['…'] = '[Display limit reached]';
  }
  ancestors.delete(value);
  return result;
}

// Explicit inspection has no preview-size, entry-count or depth caps. Walk objects
// iteratively so deep workflow values do not overflow the sanitizer call stack.
export function inspectionData(value: any): any {
  const root: any = {};
  const active = new Set<any>();
  const tasks: any[] = [{value, target:root, key:'value', name:''}];
  while (tasks.length) {
    const task = tasks.pop();
    if (task.leave) { active.delete(task.leave); continue; }
    if (task.encode) { task.target[task.key] = JSON.stringify(task.encode.value); continue; }
    const item = task.value;
    if (sensitiveField(task.name)) { task.target[task.key] = hiddenValue; continue; }
    if (typeof item === 'string') {
      let decoded: any;
      if (/^[\[{]/.test(item.trim())) {
        try { decoded = JSON.parse(item); } catch { /* Non-JSON text uses the same masking policy. */ }
      }
      if (decoded && typeof decoded === 'object') {
        const holder: any = {};
        tasks.push({encode:holder,target:task.target,key:task.key});
        tasks.push({value:decoded,target:holder,key:'value',name:''});
      } else task.target[task.key] = dashboardData(item, task.name, 0, {remaining:Infinity,characters:Infinity}, new Set<any>(), Infinity, true);
      continue;
    }
    if (!item || typeof item !== 'object') { task.target[task.key] = item; continue; }
    if (active.has(item)) { task.target[task.key] = '[Circular reference]'; continue; }
    active.add(item);
    const output: any = Array.isArray(item) ? [] : Object.create(null);
    task.target[task.key] = output;
    tasks.push({leave:item});
    const descriptor = item.name ?? item.Name ?? item.key ?? item.Key;
    const protectedValue = typeof descriptor === 'string' && sensitiveField(descriptor);
    for (const [key,child] of Object.entries(item).reverse()) {
      if (protectedValue && /^(value|values|expression)$/i.test(key)) output[key] = hiddenValue;
      else tasks.push({value:child,target:output,key,name:key});
    }
  }
  return root.value;
}
