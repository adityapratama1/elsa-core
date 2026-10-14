import {Component, Event, EventEmitter, h, Host, Method, Prop, State, Watch} from '@stencil/core';
import moment from 'moment';
import {ActivityDescriptor, PagedList, WorkflowBlueprint, WorkflowExecutionLogRecord, WorkflowInstance, WorkflowModel} from '../../../../models';
import {createElsaClient} from '../../../../services/elsa-client';
import {JournalOccurrence, journalDuration, journalOccurrences, journalOutcomes, journalActivityOutput, journalValueShape} from '../../../../utils/journal-occurrences';

@Component({tag: 'elsa-workflow-instance-journal', shadow: false, styleUrl: 'journal.css'})
export class ElsaWorkflowInstanceJournal {
  @Prop() workflowInstanceId: string;
  @Prop() workflowInstance: WorkflowInstance;
  @Prop() serverUrl: string;
  @Prop() activityDescriptors: ActivityDescriptor[] = [];
  @Prop() workflowBlueprint: WorkflowBlueprint;
  @Prop() workflowModel: WorkflowModel;
  @Event() recordSelected: EventEmitter<WorkflowExecutionLogRecord>;
  @State() records: PagedList<WorkflowExecutionLogRecord> = {items: [], totalCount: 0};
  @State() selectedRecordId?: string;
  @State() selectedActivityId?: string;
  @State() loading = false;
  @State() loadError?: string;
  @State() filter = 'all';
  @State() search = '';
  @State() latestFirst = false;
  @State() copiedKey?: string;
  @State() copyErrorKey?: string;
  flyoutPanel: HTMLElsaFlyoutPanelElement;
  private requestVersion = 0;
  private page = 0;
  private readonly pageSize = 200;
  private readonly maxRecords = 1000;

  @Watch('workflowInstanceId')
  async workflowInstanceIdChangedHandler() {
    this.selectedRecordId = undefined;
    this.selectedActivityId = undefined;
    this.records = {items: [], totalCount: 0};
    this.filter = 'all';
    this.search = '';
    this.latestFirst = false;
    this.copiedKey = undefined;
    this.copyErrorKey = undefined;
    await this.loadRecords();
  }

  async componentWillLoad() { await this.workflowInstanceIdChangedHandler(); }
  disconnectedCallback() { this.requestVersion++; }

  private async loadRecords(append = false) {
    const id = this.workflowInstanceId;
    const version = ++this.requestVersion;
    if (!id) { this.loading = false; return; }
    this.loading = true;
    this.loadError = undefined;
    const page = append ? this.page + 1 : 0;
    try {
      const client = await createElsaClient(this.serverUrl);
      const response = await client.workflowExecutionLogApi.get(id, page, this.pageSize);
      if (version !== this.requestVersion || id !== this.workflowInstanceId) return;
      const items = append ? [...this.records.items, ...response.items] : response.items;
      const unique = new Map(items.map(x => [x.id, x]));
      this.records = {...response, items: Array.from(unique.values()).slice(0, this.maxRecords)};
      this.page = page;
    } catch {
      if (version === this.requestVersion) this.loadError = 'Journal could not be loaded. Existing workflow processing is unaffected. Retry to read it again.';
    } finally { if (version === this.requestVersion) this.loading = false; }
  }

  @Method()
  async selectActivityRecord(activityId?: string) {
    const occurrence = this.occurrences().filter(x => x.activityId === activityId).slice(-1)[0];
    this.selectRecord(occurrence?.representative);
    if (this.flyoutPanel) await this.flyoutPanel.selectTab('journal', true);
  }

  private selectRecord(record?: WorkflowExecutionLogRecord) {
    const activity = this.workflowBlueprint?.activities?.find(x => x.id === record?.activityId);
    this.selectedRecordId = record?.id;
    this.selectedActivityId = activity ? activity.parentId && activity.parentId !== this.workflowBlueprint.id ? activity.parentId : activity.id : record?.activityId;
    if (record) this.recordSelected.emit(record);
  }

  private occurrences() { return journalOccurrences(this.records.items, this.records.items.length >= this.records.totalCount); }
  private date(value?: number | Date | string) {
    return value !== undefined && value !== null && moment(value).isValid() ? moment(value).format('DD MMM YYYY HH:mm:ss') : 'Not recorded';
  }
  private name(occurrence: JournalOccurrence) {
    const activity = this.workflowBlueprint?.activities?.find(x => x.id === occurrence.activityId);
    const descriptor = this.activityDescriptors.find(x => x.type === occurrence.representative.activityType);
    return activity?.displayName || activity?.name || descriptor?.displayName || occurrence.representative.activityType || 'Unknown activity';
  }
  private raw(value: any) {
    const text = JSON.stringify(value, null, 2) || 'Not recorded';
    return text.length > 20000 ? text.slice(0, 20000) + '\n… Display truncated at 20,000 characters.' : text;
  }

  private async copyData(value: any, key: string) {
    this.copiedKey = undefined;
    this.copyErrorKey = undefined;
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      this.copiedKey = key;
    } catch { this.copyErrorKey = key; }
  }

  private renderData(value: any, label: string, key: string) {
    return <div class="uj-data"><div class="uj-data-header"><strong>{label}</strong>
      <button class="uj-button" aria-label={`Copy ${label}`} disabled={value === undefined} onClick={() => this.copyData(value, key)}>{this.copiedKey === key ? 'Copied' : 'Copy JSON'}</button></div>
      {this.copyErrorKey === key && <p role="alert" class="uj-warning">Clipboard access failed. Allow clipboard access or select the text below to copy it manually.</p>}
      <pre class="uj-json">{this.raw(value)}</pre></div>;
  }

  private renderValue(value: any, depth = 0): any {
    const shape = journalValueShape(value);
    if (shape.kind === 'scalar') {
      const text = value === undefined ? 'Not recorded' : shape.preview;
      return <span class="uj-value">{text.length > 400 ? text.slice(0,400) + '… (see Raw JSON for full value)' : text === '' ? '(empty string)' : text}</span>;
    }
    if (depth >= 3) return <span class="uj-meta">{shape.kind === 'object' ? 'Object' : 'Array'} · {shape.count} {shape.kind === 'object' ? 'fields' : 'items'} (see Raw JSON)</span>;
    if (shape.kind === 'table') return <div class="uj-table-wrap"><table class="uj-table"><thead><tr>{shape.keys.map(key => <th>{key}</th>)}</tr></thead>
      <tbody>{value.slice(0,30).map(row => <tr>{shape.keys.map(key => <td>{this.renderValue(row[key],depth + 1)}</td>)}</tr>)}</tbody></table>
      {value.length > 30 && <p class="uj-note">Showing 30 of {value.length} rows. Full data is available in Raw JSON and Copy JSON.</p>}</div>;
    const entries = Array.isArray(value) ? value.slice(0,30).map((item,index) => [String(index + 1),item]) : Object.entries(value).slice(0,30);
    if (!entries.length) return <span class="uj-meta">{Array.isArray(value) ? 'Empty array' : 'Empty object'}</span>;
    return <div><dl class="uj-fields">{entries.map(([name,item]) => <div><dt>{name}</dt><dd>
      {name.toLowerCase() === 'outcomes' && Array.isArray(item) ? <span class="uj-outcomes">{item.map(outcome => <span class="uj-outcome">{String(outcome)}</span>)}</span> :
        item !== null && typeof item === 'object' ? <details class="uj-nested"><summary>{Array.isArray(item) ? `${item.length} items` : `${Object.keys(item).length} fields`}</summary>{this.renderValue(item,depth + 1)}</details> : this.renderValue(item,depth + 1)}
      </dd></div>)}</dl>{shape.count > 30 && <p class="uj-note">Showing 30 of {shape.count} entries. Full data is available in Raw JSON and Copy JSON.</p>}</div>;
  }

  private renderStructuredData(value: any, label: string, key: string) {
    return <section class="uj-structured" aria-label={label}><div class="uj-data-header"><strong>{label}</strong>
      <button class="uj-button" aria-label={`Copy ${label}`} disabled={value === undefined} onClick={() => this.copyData(value,key)}>{this.copiedKey === key ? 'Copied' : 'Copy JSON'}</button></div>
      {this.copyErrorKey === key && <p role="alert" class="uj-warning">Clipboard access failed. Open Raw JSON to copy the text manually.</p>}
      {this.renderValue(value)}<details class="uj-raw"><summary>Raw JSON</summary>{this.renderData(value,'Raw JSON',`${key}:json`)}</details></section>;
  }

  render() {
    return <Host class="unifi-journal"><elsa-flyout-panel ref={el => this.flyoutPanel = el}>
      <elsa-tab-header tab="general" slot="header">Overview</elsa-tab-header>
      <elsa-tab-content tab="general" slot="content">{this.renderOverview()}</elsa-tab-content>
      <elsa-tab-header tab="journal" slot="header">Journal</elsa-tab-header>
      <elsa-tab-content tab="journal" slot="content">{this.renderJournal()}</elsa-tab-content>
      <elsa-tab-header tab="activityState" slot="header">Activity state</elsa-tab-header>
      <elsa-tab-content tab="activityState" slot="content">{this.renderState()}</elsa-tab-content>
      <elsa-tab-header tab="variables" slot="header">Variables</elsa-tab-header>
      <elsa-tab-content tab="variables" slot="content">{this.renderData(this.workflowInstance?.variables?.data, 'Variables', 'variables')}</elsa-tab-content>
    </elsa-flyout-panel></Host>;
  }

  private renderJournal() {
    const all = this.occurrences();
    const counts = {faulted: all.filter(x => x.outcome === 'Faulted').length, waiting: all.filter(x => x.outcome === 'Awaiting result').length};
    const items = all.filter(x => (this.filter === 'all' || (this.filter === 'faulted' ? x.outcome === 'Faulted' : x.outcome === 'Awaiting result')) &&
      `${this.name(x)} ${x.activityId}`.toLowerCase().includes(this.search.toLowerCase()));
    if (this.latestFirst) items.reverse();
    const partial = this.records.items.length < this.records.totalCount;
    return <section class="uj-panel" aria-label="Workflow execution journal" aria-busy={this.loading ? 'true' : 'false'}>
      <header class="uj-heading"><div><h2>Execution journal</h2><p>One row per recorded execution. Times shown in your browser timezone ({moment().format('Z')}).</p></div>
        <button class="uj-button" disabled={this.loading} onClick={() => this.loadRecords()}>Refresh</button></header>
      <div class="uj-stats"><div><strong>{all.length}</strong><span>Executions</span></div><div><strong>{counts.faulted}</strong><span>Faulted</span></div>
        <div><strong>{counts.waiting}</strong><span>Awaiting result</span></div></div>
      <p class="uj-note">“Result handled” is the Process Engine's Executed/Resumed event, not proof of business success. A fault takes precedence within the same recorded execution.</p>
      <div class="uj-tools"><input aria-label="Find an activity" placeholder="Find activity or ID" value={this.search} onInput={e => this.search = (e.target as HTMLInputElement).value}/>
        <select aria-label="Filter journal" onChange={e => this.filter = (e.target as HTMLSelectElement).value}>
          <option value="all" selected={this.filter === 'all'}>All executions</option><option value="faulted" selected={this.filter === 'faulted'}>Faulted</option><option value="waiting" selected={this.filter === 'waiting'}>Awaiting result</option></select>
        <button class="uj-button" onClick={() => this.latestFirst = !this.latestFirst}>{this.latestFirst ? 'Latest first' : 'Oldest first'}</button></div>
      {this.loadError && <p role="alert" class="uj-warning">{this.loadError}</p>}
      {partial && <p class="uj-warning">Partial history: {this.records.items.length} of {this.records.totalCount} events loaded. Pairing and durations are not confirmed until the complete history is loaded.</p>}
      {this.loading && <p role="status">Reading journal…</p>}
      {!this.loading && !this.loadError && !items.length && <p class="uj-empty">{all.length ? 'No executions match this filter.' : 'No persisted journal events yet. Missing events do not prove that no work ran.'}</p>}
      <ol class="uj-list">{items.map(x => this.renderOccurrence(x))}</ol>
      {partial && this.records.items.length < this.maxRecords && <button class="uj-button" disabled={this.loading} onClick={() => this.loadRecords(true)}>Load next {this.pageSize} events</button>}
      {partial && this.records.items.length >= this.maxRecords && <p class="uj-note">Display limit reached (1,000 events). Raw history remains available through the existing execution-log API.</p>}
    </section>;
  }

  private renderOccurrence(x: JournalOccurrence) {
    const open = x.records.some(r => r.id === this.selectedRecordId);
    const fault = x.records.find(r => r.eventName === 'Faulted');
    const exception = fault?.data?.Exception || fault?.data?.exception;
    const status = x.outcome === 'Faulted' ? 'uj-faulted' : x.outcome === 'Awaiting result' ? 'uj-waiting' : 'uj-neutral';
    const outcomes = journalOutcomes(x);
    const descriptor = this.activityDescriptors.find(d => d.type === x.representative.activityType);
    const output = journalActivityOutput(x, this.workflowInstance, descriptor);
    return <li key={x.id} class={`uj-card ${open ? 'uj-selected' : ''}`}>
      <button class="uj-row" aria-expanded={open ? 'true' : 'false'} onClick={() => open ? this.selectRecord(undefined) : this.selectRecord(x.representative)}>
        <span class="uj-row-title"><strong>{this.name(x)}</strong><span class={`uj-badge ${status}`}>{x.outcome}</span></span>
        <span class="uj-meta">Execution {x.number} · {this.date(x.startedAt ?? x.endedAt)} · {x.durationMs !== undefined ? journalDuration(x.durationMs) : 'Duration unavailable'}</span>
        {!!outcomes.length && <span class="uj-outcomes" aria-label="Recorded outcomes"><span class="uj-meta">Outcomes</span>{outcomes.map(outcome => <span class="uj-outcome">{outcome}</span>)}</span>}
        <span class="uj-meta">{x.records.length} raw event{x.records.length === 1 ? '' : 's'} · {open ? 'Hide details' : 'View details'}</span>
      </button>
      {fault && <p class="uj-fault-message">{exception?.Message || exception?.message || fault.message || 'Activity fault recorded.'}</p>}
      {open && <div class="uj-details">
        <dl class="uj-properties"><div><dt>Activity ID</dt><dd>{x.activityId} <elsa-copy-button value={x.activityId}/></dd></div>
          <div><dt>Started</dt><dd>{this.date(x.startedAt)}</dd></div><div><dt>Ended</dt><dd>{this.date(x.endedAt)}</dd></div>
          <div><dt>Activity duration</dt><dd>{journalDuration(x.durationMs)}</dd></div></dl>
        {x.uncertain && <p class="uj-warning">Start/end pairing is incomplete or ambiguous. No duration is inferred from adjacent events.</p>}
        {x.outcome === 'Awaiting result' && <p class="uj-note">No terminal event is persisted for this execution. This alone does not prove that a worker is still active.</p>}
        {x.records.filter(r => ['Executed','Resumed'].includes(r.eventName) && r.data != null).map(r => <div class="uj-event-data">
          <p class="uj-meta">{r.eventName} · {this.date(r.timestamp)} · Result handled</p>
          {this.renderStructuredData(r.data, `${r.eventName} data`, `data:${r.id}`)}</div>)}
        {output && <details class="uj-raw" open><summary>Activity Output</summary>
          <p class="uj-note">{output.source === 'execution' ? 'Output recorded in this execution.' : 'Latest persisted activity output/state. It may belong to a later execution; this is not a historical output snapshot.'}</p>
          {this.renderStructuredData(output.value, 'Activity Output', `output:${x.id}`)}</details>}
        {exception && <details class="uj-raw"><summary>Exception details</summary>{this.renderData(exception, 'Exception details', `exception:${x.id}`)}</details>}
        <details class="uj-raw uj-raw-events"><summary>Raw Process Engine events · {x.records.length}</summary><p class="uj-note">Original names and timestamps are preserved. Event spacing is not activity duration.</p>
        {x.records.map(r => <details class="uj-raw" key={r.id}><summary><span>{r.eventName}</span><time>{this.date(r.timestamp)}</time></summary>
          {this.renderData({id: r.id, rawEventName: r.eventName, timestamp: r.timestamp, message: r.message, data: r.data}, 'Raw event data', `raw:${r.id}`)}</details>)}
        </details>
      </div>}
    </li>;
  }

  private renderOverview() {
    const instance = this.workflowInstance;
    if (!instance) return <p class="uj-empty">Workflow instance is unavailable.</p>;
    const fields = [['Instance ID', instance.id], ['Correlation ID', instance.correlationId], ['Status', instance.workflowStatus], ['Version', instance.version],
      ['Created', this.date(instance.createdAt)], ['Last persisted execution', this.date(instance.lastExecutedAt)], ['Finished', this.date(instance.finishedAt)], ['Faulted', this.date(instance.faultedAt)]];
    return <section class="uj-panel"><h2>Workflow overview</h2><dl class="uj-properties">{fields.map(([label, value]) => <div><dt>{label}</dt><dd>{value ?? 'Not recorded'}</dd></div>)}</dl>
      <p class="uj-note">Persisted workflow status is not a live worker heartbeat. Open Journal for recorded execution evidence.</p></section>;
  }

  private renderState() {
    const activity = this.workflowModel?.activities?.find(x => x.activityId === this.selectedActivityId);
    return activity ? this.renderData({...activity, properties: activity.properties?.map(x => ({name: x.name, value: x.value}))}, 'Activity state', 'state') : <p class="uj-empty">Select an execution or activity to inspect its state.</p>;
  }
}
