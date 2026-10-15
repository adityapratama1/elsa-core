export const hiddenValue = '[REDACTED]';

export function sensitiveField(name: string): boolean {
  const key = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /password|passwd|pwd|secret|token|authorization|credential|connectionstring|privatekey|apikey|accesskey|securitykey|cookie|sessionid|email|phone|mobile|ssn|nationalid|passport|creditcard|cardnumber|cvv|bankaccount|iban|dateofbirth|birthdate|homeaddress|postaladdress|fullname|firstname|lastname/.test(key) || /^(pin|otp|signature|sig|sastoken|nik|npwp|address)$/.test(key);
}

// Apply at the presentation/copy boundary; never alter workflow execution state.
export function dashboardData(value: any, name = '', depth = 0, budget = {remaining: 2000}, ancestors = new Set<any>()): any {
  if (sensitiveField(name)) return hiddenValue;
  if (depth > 12 || --budget.remaining < 0) return '[Display limit reached]';
  if (typeof value === 'string') {
    if (value.length > 20000) return '[Large text hidden]';
    const trimmed = value.trim();
    // JSON carried inside HTTP responses and string variables needs the same policy.
    if (/^[\[{]/.test(trimmed)) {
      try { return JSON.stringify(dashboardData(JSON.parse(trimmed), '', depth + 1, budget, ancestors)); } catch { /* Treat as text. */ }
    }
    if (/\b(?:Bearer|Basic)\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/i.test(value)) return hiddenValue;
    if (/(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|signature|sig|x-amz-signature|x-amz-credential)\s*[=:]\s*\S+/i.test(value)) return hiddenValue;
    if (/[a-z][a-z0-9+.-]*:\/\/[^\s/]+:[^\s/]+@/i.test(value)) return hiddenValue;
    return value.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi, hiddenValue)
      .replace(/\b\d{3}-\d{2}-\d{4}\b|\+\d[\d ().-]{8,}\d/g, hiddenValue);
  }
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular reference]';
  ancestors.add(value);
  let result: any;
  if (Array.isArray(value)) {
    result = value.slice(0,2000).map(item => dashboardData(item,'',depth + 1,budget,ancestors));
    if (value.length > 2000) result.push('[Display limit reached]');
  } else {
    result = Object.create(null);
    // Header/property models often carry {name: 'Authorization', value: '...'}.
    const descriptor = value.name ?? value.Name ?? value.key ?? value.Key;
    const protectedValue = typeof descriptor === 'string' && sensitiveField(descriptor);
    for (const [key,item] of Object.entries(value).slice(0,2000)) {
      result[key] = protectedValue && /^(value|values|expression)$/i.test(key) ? hiddenValue : dashboardData(item,key,depth + 1,budget,ancestors);
    }
    if (Object.keys(value).length > 2000) result['…'] = '[Display limit reached]';
  }
  ancestors.delete(value);
  return result;
}
