import {WorkflowExecutionLogRecord} from '../models';

export interface JournalOccurrence {
  id: string;
  activityId: string;
  number: number;
  records: WorkflowExecutionLogRecord[];
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  outcome: 'Faulted' | 'Result handled' | 'Awaiting result' | 'Evidence incomplete';
  uncertain: boolean;
  representative: WorkflowExecutionLogRecord;
}

/** Read model only. Executed means result handled, never proof of business success. */
export function journalOccurrences(records: WorkflowExecutionLogRecord[], complete = true): JournalOccurrence[] {
  const result: JournalOccurrence[] = [];
  const current = new Map<string, JournalOccurrence>();
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const time = (r: WorkflowExecutionLogRecord) => new Date(r.timestamp).getTime();
  const rank = (r: WorkflowExecutionLogRecord) => ['Executing', 'Resuming'].includes(r.eventName) ? 0 : r.eventName === 'Faulted' ? 1 : 2;
  const sorted = records.filter(r => {
    if (r.id && seen.has(r.id)) return false;
    if (r.id) seen.add(r.id);
    return true;
  }).slice().sort((a, b) => {
    const at = time(a), bt = time(b);
    return (Number.isFinite(at) ? at : Infinity) - (Number.isFinite(bt) ? bt : Infinity) || rank(a) - rank(b) || (a.id || '').localeCompare(b.id || '');
  });
  for (const record of sorted) {
    const starts = ['Executing', 'Resuming'].includes(record.eventName);
    let occurrence = current.get(record.activityId);
    if (starts || !occurrence) {
      // Two starts without a terminal event cannot be assigned confidently (parallel or missing evidence).
      const overlapping = starts && occurrence && !occurrence.endedAt;
      if (overlapping) { occurrence.uncertain = true; occurrence.outcome = 'Evidence incomplete'; }
      const number = (counts.get(record.activityId) || 0) + 1;
      counts.set(record.activityId, number);
      occurrence = {id: record.id || `${record.activityId}:${number}`, activityId: record.activityId,
        number, records: [], outcome: 'Awaiting result', uncertain: !complete || !starts || !!overlapping,
        representative: record};
      if (starts && Number.isFinite(time(record))) occurrence.startedAt = time(record);
      else occurrence.uncertain = true;
      result.push(occurrence);
      current.set(record.activityId, occurrence);
    }
    occurrence.records.push(record);
    const faulted = record.eventName === 'Faulted';
    const handled = ['Executed', 'Resumed'].includes(record.eventName);
    if (faulted || handled) {
      if (faulted || occurrence.outcome !== 'Faulted') {
        occurrence.outcome = faulted ? 'Faulted' : 'Result handled';
        occurrence.representative = record;
        occurrence.endedAt = Number.isFinite(time(record)) ? time(record) : undefined;
      }
    }
    if (occurrence.startedAt !== undefined && occurrence.endedAt !== undefined && !occurrence.uncertain)
      occurrence.durationMs = Math.max(0, occurrence.endedAt - occurrence.startedAt);
    if (occurrence.uncertain && occurrence.outcome !== 'Faulted') occurrence.outcome = 'Evidence incomplete';
  }
  return result;
}

export function journalDuration(milliseconds?: number): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return 'Unavailable';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}

export function journalOutcomes(occurrence: JournalOccurrence): string[] {
  const outcomes = new Set<string>();
  for (const record of occurrence.records) {
    const value = record.data?.Outcomes ?? record.data?.outcomes;
    for (const outcome of Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
      if (typeof outcome === 'string' && outcome.trim()) outcomes.add(outcome);
  }
  return Array.from(outcomes);
}

export function journalActivityOutput(occurrence: JournalOccurrence, instance: any, descriptor: any) {
  const owns = (object: any, key: string) => object != null && Object.prototype.hasOwnProperty.call(object, key);
  // Prefer output captured in this execution, never mistake another execution's output for it.
  for (const record of occurrence.records.slice().reverse()) {
    for (const key of ['ActivityOutput', 'activityOutput'])
      if (owns(record.data, key)) return {value:record.data[key], source:'execution'};
  }
  if (owns(instance?.activityOutput, occurrence.activityId))
    return {value:instance.activityOutput[occurrence.activityId], source:'snapshot'};
  const state = instance?.activityData?.[occurrence.activityId];
  const properties: Record<string, any> = {};
  for (const property of descriptor?.outputProperties || []) {
    const name = property.name;
    if (!name) continue;
    const camel = name.charAt(0).toLowerCase() + name.slice(1);
    const key = owns(state, name) ? name : owns(state, camel) ? camel : undefined;
    if (key !== undefined) properties[name] = state[key];
  }
  return Object.keys(properties).length ? {value:properties, source:'snapshot'} : undefined;
}

export function journalValueShape(value: any) {
  if (value === null || typeof value !== 'object') return {kind:'scalar', preview:String(value ?? 'null')};
  if (!Array.isArray(value)) return {kind:'object', count:Object.keys(value).length};
  const rows = value.slice(0, 30);
  const keys = rows.length && rows.every(row => row !== null && typeof row === 'object' && !Array.isArray(row)) ? Object.keys(rows[0]) : [];
  const table = keys.length > 0 && keys.length <= 8 && rows.every(row => {
    const rowKeys = Object.keys(row);
    return rowKeys.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(row,key) && (row[key] === null || typeof row[key] !== 'object'));
  });
  return {kind:table ? 'table' : 'array', count:value.length, keys:table ? keys : []};
}
