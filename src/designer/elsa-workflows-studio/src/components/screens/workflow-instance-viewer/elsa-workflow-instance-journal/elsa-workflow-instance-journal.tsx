import {Component, Event, EventEmitter, h, Host, Method, Prop, State, Watch} from '@stencil/core';
import moment from 'moment';
import {ActivityDescriptor, PagedList, WorkflowBlueprint, WorkflowExecutionLogRecord, WorkflowInstance, WorkflowModel} from '../../../../models';
import {createElsaClient} from '../../../../services/elsa-client';
import {JournalOccurrence, journalDuration, journalOccurrences, journalOutcomes, journalActivityOutput, journalValueShape, journalFaultMessage, journalResult} from '../../../../utils/journal-occurrences';
import {dashboardData, inspectionData} from '../../../../utils/dashboard-data';

interface ExternalPayloadDescriptor {
  id: string;
  path: Array<string>;
  bytes: number;
  encoding: string;
  independent: boolean;
}

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
  @State() payloadTitle?: string;
  @State() payloadValue?: any;
  @State() payloadLoading = false;
  @State() payloadError?: string;
  @State() expandedPayloadPaths: Array<string> = ['$'];
  payloadDialog: HTMLElsaModalDialogElement;
  @State() inspectionText = '';
  @State() inspectionTitle = '';
  @State() inspectionSearch = '';
  @State() inspectionVisibleChars = 20000;
  inspectionDialog: HTMLElsaModalDialogElement;

  private inspectValue(value: any, title: string) {
    this.copiedKey = undefined;
    this.copyErrorKey = undefined;
    this.inspectionTitle = title;
    this.inspectionSearch = '';
    this.inspectionVisibleChars = 20000;
    try { this.inspectionText = JSON.stringify(inspectionData(value), null, 2) || 'null'; }
    catch { this.inspectionText = JSON.stringify({inspectionError:'This value could not be serialized for inspection. No raw content was exposed.'}); }
    this.inspectionDialog.show(true);
  }

  private renderInspectionDialog() {
    const query = this.inspectionSearch.trim().toLowerCase();
    const lines = this.inspectionText.split('\n').filter(line => !query || line.toLowerCase().includes(query));
    const content = lines.join('\n');
    return <elsa-modal-dialog dialogWidth="64rem" ref={el => this.inspectionDialog = el}>
      <div slot="content" class="unifi-journal uj-inspection">
        <header class="uj-heading uj-inspection-heading"><div><h2>{this.inspectionTitle}</h2><p>Sensitive values are hidden.</p></div>
          <button class="uj-button" aria-label="Copy sanitized inspected JSON" onClick={() => this.copyData(JSON.parse(this.inspectionText), 'inspection', true)}>{this.copiedKey === 'inspection' ? 'Copied' : 'Copy JSON'}</button></header>
        <input aria-label="Search inspected content" placeholder="Find a field or value" value={this.inspectionSearch} onInput={e => {this.inspectionSearch = (e.target as HTMLInputElement).value; this.inspectionVisibleChars = 20000;}}/>
        <p class="uj-note" role="status">{query ? `${lines.length} matching lines. ` : ''}Copy JSON includes all sanitized content, regardless of search or visible text.</p>
        <pre class="uj-json uj-inspection-json" tabIndex={0}>{content ? content.slice(0,this.inspectionVisibleChars) : 'No matching fields or values.'}</pre>
        {content.length > this.inspectionVisibleChars && <div class="uj-inspection-meta"><span class="uj-note">Showing {this.inspectionVisibleChars.toLocaleString()} of {content.length.toLocaleString()} characters</span><div class="uj-actions"><button class="uj-button" onClick={() => this.inspectionVisibleChars += 100000}>Show more</button><button class="uj-button" onClick={() => this.inspectionVisibleChars = content.length}>Show all</button></div></div>}
        {this.copyErrorKey === 'inspection' && <p role="alert" class="uj-warning">Clipboard unavailable. Select the text above to copy it manually.</p>}
      </div>
    </elsa-modal-dialog>;
  }
  @State() loading = false;
  @State() loadError?: string;
  @State() filter = 'all';
  @State() search = '';
  @State() latestFirst = false;
  @State() copiedKey?: string;
  @State() copyErrorKey?: string;
  @State() variableSearch = '';
  @State() variableLimit = 30;
  @State() expandedVariable?: string;
  flyoutPanel: HTMLElsaFlyoutPanelElement;
  private requestVersion = 0;
  private page = 0;
  private readonly pageSize = 200;
  private readonly maxRecords = 1000;

  @Watch('workflowInstanceId')
  async workflowInstanceIdChangedHandler() {
    this.inspectionText = '';
    this.inspectionSearch = '';
    if (this.inspectionDialog) await this.inspectionDialog.show(false);
    this.selectedRecordId = undefined;
    this.selectedActivityId = undefined;
    this.records = {items: [], totalCount: 0};
    this.filter = 'all';
    this.search = '';
    this.latestFirst = false;
    this.copiedKey = undefined;
    this.copyErrorKey = undefined;
    this.variableSearch = '';
    this.variableLimit = 30;
    this.expandedVariable = undefined;
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
    const text = JSON.stringify(dashboardData(value), null, 2) || 'Not recorded';
    return text.length > 20000 ? text.slice(0, 20000) + '\n… Display truncated at 20,000 characters.' : text;
  }

  private async copyData(value: any, key: string, _inspection = false) {
    this.copiedKey = undefined;
    this.copyErrorKey = undefined;
    try {
      await navigator.clipboard.writeText(JSON.stringify(inspectionData(value), null, 2));
      this.copiedKey = key;
    } catch { this.copyErrorKey = key; }
  }

  private renderData(value: any, label: string, key: string) {
    return <div class="uj-data"><div class="uj-data-header"><strong>{label}</strong><div class="uj-actions">
      <button class="uj-button" disabled={value === undefined} onClick={() => this.inspectValue(value, label)}>Inspect content</button>
</div></div>
      <pre class="uj-json">{this.raw(value)}</pre></div>;
  }

  private renderValue(value: any, depth = 0): any {
    if (this.getExternalPayload(value)) return this.renderInspectableValue("Payload", value);
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

  private renderStructuredData(value: any, label: string, key: string, inspectionSource?: any) {
    const original = inspectionSource === undefined ? value : inspectionSource;
    value = dashboardData(value);
    return <section class="uj-structured" aria-label={label}><div class="uj-data-header"><strong>{label}</strong><div class="uj-actions">
      <button class="uj-button" disabled={original === undefined} onClick={() => this.inspectValue(original, label)}>Inspect content</button>
</div></div>
      <p class="uj-note uj-preview-note">Preview · sensitive values hidden</p>
      {this.renderValue(value)}<details class="uj-raw"><summary>Raw JSON preview</summary><div class="uj-raw-actions"><button class="uj-button" aria-label={`Copy complete ${label} JSON`} onClick={() => this.copyData(original, `${key}:raw`, true)}>{this.copiedKey === `${key}:raw` ? 'Copied' : 'Copy JSON'}</button></div>{this.copyErrorKey === `${key}:raw` && <p role="alert" class="uj-warning">Clipboard unavailable. Use Inspect content to select and copy the text.</p>}<pre class="uj-json">{this.raw(value)}</pre></details></section>;
  }

  render() {
    return <Host class="unifi-journal">{this.renderPayloadDialog()}{this.renderInspectionDialog()}<elsa-flyout-panel ref={el => this.flyoutPanel = el}>
      <elsa-tab-header tab="general" slot="header">Overview</elsa-tab-header>
      <elsa-tab-content tab="general" slot="content">{this.renderOverview()}</elsa-tab-content>
      <elsa-tab-header tab="journal" slot="header">Journal</elsa-tab-header>
      <elsa-tab-content tab="journal" slot="content">{this.renderJournal()}</elsa-tab-content>
      <elsa-tab-header tab="activityState" slot="header">Activity state</elsa-tab-header>
      <elsa-tab-content tab="activityState" slot="content">{this.renderState()}</elsa-tab-content>
      <elsa-tab-header tab="variables" slot="header">Variables</elsa-tab-header>
      <elsa-tab-content tab="variables" slot="content">{this.renderVariables()}</elsa-tab-content>
    </elsa-flyout-panel></Host>;
  }

  private renderVariables() {
    const data = this.workflowInstance?.variables?.data;
    const entries = Object.entries(data || {});
    const matches = entries.filter(([name]) => name.toLowerCase().includes(this.variableSearch.trim().toLowerCase()));
    return <section class="uj-panel" aria-label="Workflow variables">
      <header class="uj-heading"><div><h2>Variables <span class="uj-badge uj-neutral">{entries.length}</span></h2>
        <p>Latest persisted values, not a snapshot of the selected journal step.</p></div></header>
      <div class="uj-tools"><input aria-label="Find a variable" placeholder="Find variable by name" value={this.variableSearch}
        onInput={e => { this.variableSearch = (e.target as HTMLInputElement).value; this.variableLimit = 30; }}/></div>
      {!matches.length && <p class="uj-empty">{entries.length ? 'No variables match this name.' : 'No persisted variables available.'}</p>}
      <div class="uj-variables">{matches.slice(0,this.variableLimit).map(([name,original]) => {
        const value = dashboardData(original,name);
        const external = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'$externalPayload');
        const shape = journalValueShape(value);
        const type = external ? 'External payload' : value === null ? 'Null' : Array.isArray(value) ? 'Array' : typeof value === 'object' ? 'Object' : typeof value;
        const preview = external ? 'Stored externally · reference only' : shape.kind === 'scalar' ? (shape.preview === '' ? '(empty string)' : shape.preview.slice(0,160)) : `${shape.count} ${Array.isArray(value) ? 'items' : 'fields'}`;
        const open = this.expandedVariable === name;
        return <article class={`uj-card ${open ? 'uj-selected' : ''}`} key={name}>
          <button class="uj-variable-row" aria-expanded={open ? 'true' : 'false'} onClick={() => this.expandedVariable = open ? undefined : name}>
            <strong class="uj-variable-name" title={name}>{name}</strong><span class="uj-badge uj-neutral">{type}</span>
            <span class="uj-variable-preview">{preview}</span><span class="uj-variable-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
          </button>
          {open && <div class="uj-details">{external && <p class="uj-note">This is a payload reference, not its contents. No external data is fetched by this view.</p>}
            {this.renderStructuredData(value, external ? 'Payload reference' : name, `variable:${name}`, {[name]:original})}</div>}
        </article>;
      })}</div>
      {matches.length > this.variableLimit && <button class="uj-button" onClick={() => this.variableLimit += 30}>Show next {Math.min(30,matches.length-this.variableLimit)} variables ({this.variableLimit} of {matches.length})</button>}
    </section>;
  }

  private renderJournal() {
    const all = this.occurrences();
    const attention = all.filter(x => journalResult(x).attention).length;
    const counts = {faulted: all.filter(x => x.outcome === 'Faulted').length, waiting: all.filter(x => x.outcome === 'Awaiting result').length};
    const items = all.filter(x => (this.filter === 'all' || (this.filter === 'attention' ? journalResult(x).attention : this.filter === 'faulted' ? x.outcome === 'Faulted' : x.outcome === 'Awaiting result')) &&
      `${this.name(x)} ${x.activityId}`.toLowerCase().includes(this.search.toLowerCase()));
    if (this.latestFirst) items.reverse();
    const partial = this.records.items.length < this.records.totalCount;
    return <section class="uj-panel" aria-label="Workflow execution journal" aria-busy={this.loading ? 'true' : 'false'}>
      <header class="uj-heading"><div><h2>Execution journal</h2><p>One row per recorded execution. Times shown in your browser timezone ({moment().format('Z')}).</p></div>
        <button class="uj-button" disabled={this.loading} onClick={() => this.loadRecords()}>Refresh</button></header>
      {!!attention && <div class="uj-attention"><span><strong>{attention} execution{attention === 1 ? '' : 's'} need review</strong><br/>Failures or incomplete evidence in the loaded history.</span><button class="uj-button" onClick={() => {this.filter = 'attention'; this.search = '';}}>Review issues</button></div>}
      <div class="uj-stats"><div><strong>{all.length}</strong><span>Executions</span></div><div><strong>{counts.faulted}</strong><span>Faulted</span></div>
        <div><strong>{counts.waiting}</strong><span>Awaiting result</span></div></div>
      <p class="uj-note">A workflow can complete after handling an activity failure. Read the recorded outcomes below. Awaiting result is missing evidence, not a live worker heartbeat.</p>
      <div class="uj-tools"><input aria-label="Find an activity" placeholder="Find activity or ID" value={this.search} onInput={e => this.search = (e.target as HTMLInputElement).value}/>
        <select aria-label="Filter journal" onChange={e => this.filter = (e.target as HTMLSelectElement).value}>
          <option value="all" selected={this.filter === 'all'}>All executions</option><option value="attention" selected={this.filter === 'attention'}>Needs attention</option><option value="faulted" selected={this.filter === 'faulted'}>Faulted</option><option value="waiting" selected={this.filter === 'waiting'}>Awaiting result</option></select>
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
    const exception = fault?.data?.Exception || fault?.data?.exception || fault?.data;
    const diagnostic = fault ? journalFaultMessage(fault) : x.records.slice().reverse().flatMap(r => Object.entries(r.data || {}).filter(([key,value]) => /(?:^|\.)(?:error|filtererror)$/i.test(key) && typeof value === 'string').map(([,value]) => value as string))[0];
    const result = journalResult(x);
    const status = `uj-${result.tone}`;
    const outcomes = journalOutcomes(x);
    const descriptor = this.activityDescriptors.find(d => d.type === x.representative.activityType);
    const output = journalActivityOutput(x, this.workflowInstance, descriptor);
    return <li key={x.id} class={`uj-card ${open ? 'uj-selected' : ''}`}>
      <button class="uj-row" aria-expanded={open ? 'true' : 'false'} onClick={() => open ? this.selectRecord(undefined) : this.selectRecord(x.representative)}>
        <span class="uj-row-title"><strong>{this.name(x)}</strong><span class={`uj-badge ${status}`}>{result.label}</span></span>
        <span class="uj-meta">Execution {x.number} · {this.date(x.startedAt ?? x.endedAt)} · {x.durationMs !== undefined ? journalDuration(x.durationMs) : 'Duration unavailable'}</span>
        {!!outcomes.length && <span class="uj-outcomes" aria-label="Recorded outcomes"><span class="uj-meta">Outcomes</span>{outcomes.map(outcome => <span class="uj-outcome">{outcome}</span>)}</span>}
        <span class="uj-meta">{x.records.length} raw event{x.records.length === 1 ? '' : 's'} · {open ? 'Hide details' : 'View details'}</span>
      </button>
      {diagnostic && <p class="uj-fault-message">{dashboardData(diagnostic).slice(0,600)}</p>}
      {open && <div class="uj-details">
        <dl class="uj-properties"><div><dt>Activity ID</dt><dd>{x.activityId} <elsa-copy-button value={x.activityId}/></dd></div>
          <div><dt>Started</dt><dd>{this.date(x.startedAt)}</dd></div><div><dt>Ended</dt><dd>{this.date(x.endedAt)}</dd></div>
          <div><dt>Activity duration</dt><dd>{journalDuration(x.durationMs)}</dd></div></dl>
        {x.uncertain && <p class="uj-warning">Start/end pairing is incomplete or ambiguous. No duration is inferred from adjacent events.</p>}
        {x.outcome === 'Awaiting result' && <p class="uj-note">No terminal event is persisted for this execution. This alone does not prove that a worker is still active.</p>}
        {x.records.filter(r => ['Executed','Resumed'].includes(r.eventName) && r.data != null).map(r => <div class="uj-event-data">
          <p class="uj-meta">{r.eventName} · {this.date(r.timestamp)} · Event recorded</p>
          {this.renderStructuredData(r.data, `${r.eventName} data`, `data:${r.id}`)}</div>)}
        {output && <details class="uj-raw" open><summary>Activity Output</summary>
          <p class="uj-note">{output.source === 'execution' ? 'Output recorded in this execution.' : 'Latest persisted activity output/state. It may belong to a later execution; this is not a historical output snapshot.'}</p>
          {this.renderStructuredData(output.value, 'Activity Output', `output:${x.id}`)}</details>}
        {exception && <details class="uj-raw"><summary>Exception details</summary>{this.renderData(exception, 'Exception details', `exception:${x.id}`)}</details>}

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
  getExternalPayload(value: any): ExternalPayloadDescriptor | undefined {
    const descriptor = value?.$externalPayload;
    return descriptor && typeof descriptor.id === 'string' ? descriptor : undefined;
  }

  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  renderInspectableValue(name: string, value: any) {
    const descriptor = this.getExternalPayload(value);
    if (!descriptor) {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return (
        <div class="elsa-py-3 elsa-text-sm">
          <dt class="elsa-font-medium elsa-text-gray-500 elsa-break-all">{name}</dt>
          <dd class="elsa-mt-1 elsa-text-gray-900 elsa-overflow-x-auto">
            <pre>{text == null ? 'null' : text}</pre>
          </dd>
        </div>
      );
    }

    return (
      <div class="elsa-py-3 elsa-text-sm">
        <dt class="elsa-font-medium elsa-text-gray-500 elsa-break-all">{name}</dt>
        <dd class="elsa-mt-2 elsa-rounded-md elsa-border elsa-border-blue-200 elsa-bg-blue-50 elsa-p-3">
          <div class="elsa-flex elsa-items-start elsa-justify-between elsa-gap-4">
            <div class="elsa-min-w-0">
              <div class="elsa-font-medium elsa-text-blue-900">External payload reference</div>
              <div class="elsa-mt-1 elsa-text-xs elsa-text-blue-700 elsa-break-all">ID: {descriptor.id}</div>
              <div class="elsa-text-xs elsa-text-blue-700 elsa-break-all">Path: {descriptor.path?.join(' / ')}</div>
              <div class="elsa-text-xs elsa-text-blue-700">{this.formatBytes(descriptor.bytes)} · {descriptor.encoding}</div>
            </div>
            <div class="elsa-flex elsa-flex-shrink-0 elsa-gap-2">
              <button type="button" title="View payload" aria-label={`View ${name}`}
                      onClick={() => this.showPayload(name, descriptor)}
                      class="elsa-inline-flex elsa-items-center elsa-rounded-md elsa-border elsa-border-blue-300 elsa-bg-white elsa-p-2 elsa-text-blue-700 hover:elsa-bg-blue-100">
                <svg class="elsa-h-5 elsa-w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
                </svg>
              </button>
              <button type="button" title="Download payload" aria-label={`Download ${name}`}
                      onClick={() => this.downloadPayload(name, descriptor)}
                      class="elsa-inline-flex elsa-items-center elsa-rounded-md elsa-border elsa-border-blue-300 elsa-bg-white elsa-p-2 elsa-text-blue-700 hover:elsa-bg-blue-100">
                <svg class="elsa-h-5 elsa-w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>
                </svg>
              </button>
            </div>
          </div>
        </dd>
      </div>
    );
  }

  async showPayload(name: string, descriptor: ExternalPayloadDescriptor) {
    this.payloadTitle = name;
    this.payloadValue = undefined;
    this.payloadError = undefined;
    this.payloadLoading = true;
    this.expandedPayloadPaths = ['$'];
    await this.payloadDialog.show(true);
    try {
      const client = await createElsaClient(this.serverUrl);
      this.payloadValue = await client.workflowInstancesApi.getStoragePayload(this.workflowInstanceId, descriptor.id);
    } catch (e) {
      this.payloadError = 'Unable to load the external payload.';
    } finally {
      this.payloadLoading = false;
    }
  }

  async downloadPayload(name: string, descriptor: ExternalPayloadDescriptor) {
    try {
      const client = await createElsaClient(this.serverUrl);
      const value = await client.workflowInstancesApi.getStoragePayload(this.workflowInstanceId, descriptor.id);
      const blob = new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${name || 'workflow-payload'}-${descriptor.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.payloadTitle = name;
      this.payloadValue = undefined;
      this.payloadError = 'Unable to download the external payload.';
      this.payloadLoading = false;
      await this.payloadDialog.show(true);
    }
  }

  renderPayloadDialog() {
    return (
      <elsa-modal-dialog dialogWidth="90vw" ref={el => this.payloadDialog = el}>
        <div slot="content" class="elsa-p-6">
          <h3 class="elsa-text-lg elsa-font-medium elsa-text-gray-900">External payload: {this.payloadTitle}</h3>
          <div class="elsa-mt-4 elsa-flex elsa-justify-end">
            <button type="button" onClick={() => this.expandedPayloadPaths = ['$']}
                    class="elsa-rounded-md elsa-border elsa-border-gray-300 elsa-bg-white elsa-px-3 elsa-py-1 elsa-text-xs elsa-font-medium elsa-text-gray-700 hover:elsa-bg-gray-50">
              Collapse all
            </button>
          </div>
          <div class="elsa-mt-2 elsa-overflow-auto elsa-rounded-md elsa-p-4 elsa-text-sm"
               style={{background: '#111827', color: '#f9fafb', 'max-height': '75vh'}}>
            {this.payloadLoading
              ? <span>Downloading payload…</span>
              : this.payloadError
                ? <span class="elsa-text-red-300">{this.payloadError}</span>
                : this.renderJsonTree(this.payloadValue, '$')}
          </div>
        </div>
      </elsa-modal-dialog>
    );
  }

  togglePayloadPath(path: string) {
    this.expandedPayloadPaths = this.expandedPayloadPaths.includes(path)
      ? this.expandedPayloadPaths.filter(x => x !== path && !x.startsWith(`${path}.`) && !x.startsWith(`${path}[`))
      : [...this.expandedPayloadPaths, path];
  }

  renderJsonTree(value: any, path: string, label?: string) {
    if (value === null || typeof value !== 'object') {
      const formatted = typeof value === 'string' ? JSON.stringify(value) : String(value);
      return (
        <div class="elsa-font-mono elsa-leading-6 elsa-break-all">
          {label != null ? <span style={{color: '#93c5fd'}}>{JSON.stringify(label)}: </span> : undefined}
          <span style={{color: typeof value === 'string' ? '#a7f3d0' : '#fcd34d'}}>{formatted}</span>
        </div>
      );
    }

    const isArray = Array.isArray(value);
    const entryCount = isArray ? value.length : Object.keys(value).length;
    const expanded = this.expandedPayloadPaths.includes(path);
    const summary = `${isArray ? 'Array' : 'Object'}(${entryCount})`;

    return (
      <div class="elsa-font-mono elsa-leading-6">
        <button type="button" onClick={() => this.togglePayloadPath(path)}
                class="elsa-flex elsa-items-center elsa-gap-2 elsa-text-left"
                style={{color: '#f9fafb', background: 'transparent'}}
                aria-expanded={expanded ? 'true' : 'false'}>
          <span class="elsa-inline-block elsa-w-3">{expanded ? '▾' : '▸'}</span>
          {label != null ? <span style={{color: '#93c5fd'}}>{JSON.stringify(label)}:</span> : undefined}
          <span style={{color: '#9ca3af'}}>{summary}</span>
        </button>
        {expanded ? (
          <div class="elsa-ml-4 elsa-pl-3" style={{'border-left': '1px solid #374151'}}>
            {isArray && value.length > 100
              ? this.renderJsonArrayRanges(value, path)
              : (isArray ? value.map((child, index) => [String(index), child]) : Object.entries(value))
                .map(([key, child]) => {
                  const childPath = isArray ? `${path}[${key}]` : `${path}.${JSON.stringify(key)}`;
                  return this.renderJsonTree(child, childPath, key);
                })}
          </div>
        ) : undefined}
      </div>
    );
  }

  renderJsonArrayRanges(values: Array<any>, parentPath: string) {
    const blockSize = 100;
    const ranges = [];
    for (let start = 0; start < values.length; start += blockSize)
      ranges.push([start, Math.min(start + blockSize, values.length)]);

    return ranges.map(([start, end]) => {
      const rangePath = `${parentPath}[${start}:${end}]`;
      const expanded = this.expandedPayloadPaths.includes(rangePath);
      return (
        <div>
          <button type="button" onClick={() => this.togglePayloadPath(rangePath)}
                  class="elsa-flex elsa-items-center elsa-gap-2 elsa-text-left"
                  style={{color: '#f9fafb', background: 'transparent'}}
                  aria-expanded={expanded ? 'true' : 'false'}>
            <span class="elsa-inline-block elsa-w-3">{expanded ? '▾' : '▸'}</span>
            <span style={{color: '#c4b5fd'}}>[{start} … {end - 1}]</span>
            <span style={{color: '#9ca3af'}}>Array block({end - start})</span>
          </button>
          {expanded ? (
            <div class="elsa-ml-4 elsa-pl-3" style={{'border-left': '1px solid #374151'}}>
              {values.slice(start, end).map((child, offset) => {
                const index = start + offset;
                return this.renderJsonTree(child, `${parentPath}[${index}]`, String(index));
              })}
            </div>
          ) : undefined}
        </div>
      );
    });
  }
}
