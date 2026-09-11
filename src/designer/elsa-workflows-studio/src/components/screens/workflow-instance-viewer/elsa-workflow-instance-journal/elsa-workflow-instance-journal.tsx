import {Component, Event, EventEmitter, h, Host, Method, Prop, State, Watch} from '@stencil/core';
import * as collection from 'lodash/collection';
import moment from 'moment';
import {
  ActivityBlueprint,
  ActivityDescriptor,
  PagedList,
  WorkflowBlueprint,
  WorkflowExecutionLogRecord, WorkflowInstance,
  WorkflowModel, WorkflowStatus,
} from "../../../../models";
import {activityIconProvider} from "../../../../services/activity-icon-provider";
import {createElsaClient} from "../../../../services/elsa-client";
import {clip, durationToString} from "../../../../utils/utils";

interface Tab {
  id: string;
  text: string;
  view: () => any;
}

interface ExternalPayloadDescriptor {
  id: string;
  path: Array<string>;
  bytes: number;
  encoding: string;
  independent: boolean;
}

@Component({
  tag: 'elsa-workflow-instance-journal',
  shadow: false,
})
export class ElsaWorkflowInstanceJournal {

  @Prop() workflowInstanceId: string;
  @Prop() workflowInstance: WorkflowInstance;
  @Prop() serverUrl: string;
  @Prop() activityDescriptors: Array<ActivityDescriptor> = [];
  @Prop() workflowBlueprint: WorkflowBlueprint;
  @Prop() workflowModel: WorkflowModel;
  @Event() recordSelected: EventEmitter<WorkflowExecutionLogRecord>;
  @State() isVisible: boolean = true;
  @State() records: PagedList<WorkflowExecutionLogRecord> = {items: [], totalCount: 0};
  @State() filteredRecords: Array<WorkflowExecutionLogRecord> = [];
  @State() selectedRecordId?: string;
  @State() selectedActivityId?: string;
  @State() selectedTabId: string = 'journal';
  @State() payloadTitle?: string;
  @State() payloadValue?: any;
  @State() payloadLoading: boolean = false;
  @State() payloadError?: string;
  @State() expandedPayloadPaths: Array<string> = ['$'];

  el: HTMLElement;
  flyoutPanel: HTMLElsaFlyoutPanelElement;
  payloadDialog: HTMLElsaModalDialogElement;

  @Method()
  async selectActivityRecord(activityId?: string) {
    const record = !!activityId ? this.filteredRecords.find(x => x.activityId == activityId) : null;
    this.selectActivityRecordInternal(record);
    await this.flyoutPanel.selectTab('journal', true);
  }

  @Watch('workflowInstanceId')
  async workflowInstanceIdChangedHandler(newValue: string) {
    const workflowInstanceId = newValue;
    const client = await createElsaClient(this.serverUrl);

    if (workflowInstanceId && workflowInstanceId.length > 0) {
      try {
        this.records = await client.workflowExecutionLogApi.get(workflowInstanceId);
        this.filteredRecords = this.records.items.filter(x => x.eventName != 'Executing' && x.eventName != 'Resuming');
      } catch {
        console.warn('The specified workflow instance does not exist.');
      }
    }
  }

  async componentWillLoad() {
    await this.workflowInstanceIdChangedHandler(this.workflowInstanceId);
  }

  selectActivityRecordInternal(record?: WorkflowExecutionLogRecord) {
    const activity = !!record ? this.workflowBlueprint.activities.find(x => x.id === record.activityId) : null;
    this.selectedRecordId = !!record ? record.id : null;
    this.selectedActivityId = activity != null ? !!activity.parentId && activity.parentId != this.workflowBlueprint.id ? activity.parentId : activity.id : null;
  }

  getEventColor(eventName: string) {
    const map = {
      'Executing': 'elsa-bg-blue-500',
      'Executed': 'elsa-bg-green-500',
      'Faulted': 'elsa-bg-rose-500',
      'Warning': 'elsa-bg-yellow-500',
      'Information': 'elsa-bg-blue-500',
    };

    return map[eventName] || 'elsa-bg-gray-500';
  }

  getStatusColor(status: WorkflowStatus) {
    switch (status) {
      default:
      case WorkflowStatus.Idle:
        return 'gray';
      case WorkflowStatus.Running:
        return 'rose';
      case WorkflowStatus.Suspended:
        return 'blue';
      case WorkflowStatus.Finished:
        return 'green';
      case WorkflowStatus.Faulted:
        return 'red';
      case WorkflowStatus.Cancelled:
        return 'yellow';
    }
  }

  onRecordClick(record: WorkflowExecutionLogRecord) {
    this.selectActivityRecordInternal(record);
    this.recordSelected.emit(record);
  }

  render() {
    return (
      <Host>
        {this.renderPanel()}
        {this.renderPayloadDialog()}
        <elsa-workflow-definition-editor-notifications/>
      </Host>
    );
  }

  renderPanel() {
    return (
      <elsa-flyout-panel ref={el => this.flyoutPanel = el}>
        <elsa-tab-header tab="general" slot="header">General</elsa-tab-header>
        <elsa-tab-content tab="general" slot="content">
          {this.renderGeneralTab()}
        </elsa-tab-content>
        <elsa-tab-header tab="journal" slot="header">Journal</elsa-tab-header>
        <elsa-tab-content tab="journal" slot="content">
          {this.renderJournalTab()}
        </elsa-tab-content>
        <elsa-tab-header tab="activityState" slot="header">Activity State</elsa-tab-header>
        <elsa-tab-content tab="activityState" slot="content">
          {this.renderActivityStateTab()}
        </elsa-tab-content>
        <elsa-tab-header tab="variables" slot="header">
          Variables
        </elsa-tab-header>
        <elsa-tab-content tab="variables" slot="content">
          {this.renderVariablesTab()}
        </elsa-tab-content>
      </elsa-flyout-panel>
    );
  }

  renderJournalTab = () => {
    const items = this.filteredRecords;
    const allItems = this.records.items;
    const activityDescriptors = this.activityDescriptors;
    const workflowBlueprint = this.workflowBlueprint;
    const activityBlueprints: Array<ActivityBlueprint> = workflowBlueprint.activities || [];
    const selectedRecordId = this.selectedRecordId;
    

    const renderRecord = (record: WorkflowExecutionLogRecord, index: number) => {
      var prevItemReverseIndex = allItems
        .slice(0, allItems.indexOf(items[index]))
        .reverse()
        .findIndex((e)=>{
          return (e.activityId == record.activityId);
        });

      const prevItem = allItems[allItems.indexOf(items[index]) - (prevItemReverseIndex+1)];
      const currentTimestamp = moment(record.timestamp);
      const prevTimestamp = moment(prevItem.timestamp);
      const deltaTime = moment.duration(currentTimestamp.diff(prevTimestamp));
      const activityType = record.activityType;
      const activityIcon = activityIconProvider.getIcon(activityType);

      const activityDescriptor = activityDescriptors.find(x => x.type === activityType) || {
        displayName: null,
        type: null
      };

      const activityBlueprint = activityBlueprints.find(x => x.id === record.activityId) || {
        name: null,
        displayName: null
      };

      const activityName = activityBlueprint.displayName || activityBlueprint.name || activityDescriptor.displayName || activityDescriptor.type || '(Not Found): ' + activityType;
      const eventName = record.eventName;
      const eventColor = this.getEventColor(eventName);
      const recordClass = record.id === selectedRecordId ? 'elsa-border-blue-600' : 'hover:elsa-bg-gray-100 elsa-border-transparent';
      const recordData = record.data || {};
      const filteredRecordData = {};
      const wellKnownDataKeys = {State: true, Input: null, Outcomes: true, Exception: true};

      for (const key in recordData) {

        if (!recordData.hasOwnProperty(key))
          continue;

        if (!!wellKnownDataKeys[key])
          continue;

        const value = recordData[key];

        if (!value && value != 0)
          continue;

        let valueText = null;

        if (typeof value == 'string')
          valueText = value;
        else if (typeof value == 'object')
          valueText = JSON.stringify(value, null, 1);
        else if (typeof value == 'undefined')
          valueText = null;
        else
          valueText = value.toString();

        filteredRecordData[key] = valueText;
      }

      const deltaTimeText = durationToString(deltaTime);
      const outcomes = !!recordData.Outcomes ? recordData.Outcomes || [] : [];
      const exception = !!recordData.Exception ? recordData.Exception : null;

      const renderExceptionMessage = (exception: any) => {
        return (
          <div>
            <div class="elsa-mb-4">
              <strong class="elsa-block elsa-font-bold">{exception.Type}</strong>
              {exception.Message}
            </div>
            {!!exception.InnerException ?
              <div class="elsa-ml-4">{renderExceptionMessage(exception.InnerException)}</div> : undefined}
          </div>
        );
      }

      return (
        <li>
          <div onClick={() => this.onRecordClick(record)}
               class={`${recordClass} elsa-border-2 elsa-cursor-pointer elsa-p-4 elsa-rounded`}>
            <div class="elsa-relative elsa-pb-10">
              <div class="elsa-flex elsa-absolute top-8 elsa-left-4 -elsa-ml-px elsa-h-full elsa-w-0.5">
                <div class="elsa-flex elsa-flex-1 elsa-items-center elsa-relative elsa-right-10">
                  <span
                    class="elsa-flex-1 elsa-text-sm elsa-text-gray-500 elsa-w-max elsa-bg-white elsa-p-1 elsa-ml-1 elsa-rounded-r">{deltaTimeText}</span>
                </div>
              </div>
              <div class="elsa-relative elsa-flex elsa-space-x-3">
                <div>
                  <span
                    class={`elsa-h-8 elsa-w-8 elsa-rounded-full ${eventColor} elsa-flex elsa-items-center elsa-justify-center elsa-ring-8 elsa-ring-white elsa-mr-1`}
                    innerHTML={activityIcon}/>
                </div>
                <div class="elsa-min-w-0 elsa-flex-1 elsa-pt-1.5 elsa-flex elsa-justify-between elsa-space-x-4">
                  <div>
                    <h3 class="elsa-text-lg elsa-leading-6 elsa-font-medium elsa-text-gray-900">
                      {activityName}
                    </h3>
                  </div>
                  <div>
                    <span
                      class="elsa-relative elsa-inline-flex elsa-items-center elsa-rounded-full elsa-border elsa-border-gray-300 elsa-px-3 elsa-py-0.5 elsa-text-sm">
                      <span class="elsa-absolute elsa-flex-shrink-0 elsa-flex elsa-items-center elsa-justify-center">
                        <span class={`elsa-h-1.5 elsa-w-1.5 elsa-rounded-full ${eventColor}`}
                              aria-hidden="true"/>
                      </span>
                      <span class="elsa-ml-3.5 elsa-font-medium elsa-text-gray-900">{eventName}</span>
                    </span>
                  </div>
                  <div class="elsa-text-right elsa-text-sm elsa-whitespace-nowrap elsa-text-gray-500">
                    <span>{currentTimestamp.format('DD-MM-YYYY HH:mm:ss')}</span>
                  </div>
                </div>
              </div>
              <div class="elsa-ml-12 elsa-mt-2">
                <dl class="sm:elsa-divide-y sm:elsa-divide-gray-200">
                  <div class="elsa-grid elsa-grid-cols-2 elsa-gap-x-4 elsa-gap-y-8 sm:elsa-grid-cols-2">
                    <div class="sm:elsa-col-span-2">
                      <dt class="elsa-text-sm elsa-font-medium elsa-text-gray-500">
                        <span>Activity ID</span>
                        <elsa-copy-button value={record.activityId}/>
                      </dt>
                      <dd class="elsa-mt-1 elsa-text-sm elsa-text-gray-900 elsa-mb-2">{record.activityId}</dd>
                    </div>
                    {outcomes.length > 0 ? (
                      <div class="sm:elsa-col-span-2">
                        <dt class="elsa-text-sm elsa-font-medium elsa-text-gray-500">
                          <span>Outcomes</span>
                          <elsa-copy-button value={outcomes.join(', ')}/>
                        </dt>
                        <dd class="elsa-mt-1 elsa-text-sm elsa-text-gray-900 elsa-mb-2">
                          <div
                            class="elsa-flex elsa-flex-col elsa-space-y-4 sm:elsa-space-y-0 sm:elsa-flex-row sm:elsa-space-x-4">
                            {outcomes.map(outcome => (
                              <span
                                class="elsa-inline-flex elsa-items-center elsa-px-3 elsa-py-0.5 elsa-rounded-full elsa-text-sm elsa-font-medium elsa-bg-blue-100 elsa-text-blue-800">{outcome}</span>))}
                          </div>
                        </dd>
                      </div>
                    ) : undefined}
                    {!!record.message && !exception ? (
                      <div class="sm:elsa-col-span-2">
                        <dt class="elsa-text-sm elsa-font-medium elsa-text-gray-500">
                          <span>Message</span>
                          <elsa-copy-button value={record.message}/>
                        </dt>
                        <dd class="elsa-mt-1 elsa-text-sm elsa-text-gray-900">
                          {record.message}
                        </dd>
                      </div>
                    ) : undefined}
                    {!!exception ? (
                      [<div class="sm:elsa-col-span-2">
                        <dt class="elsa-text-sm elsa-font-medium elsa-text-gray-500">
                          <span>Exception</span>
                          <elsa-copy-button value={exception.Type + '\n' + exception.Message}/>
                        </dt>
                        <dd class="elsa-mt-1 elsa-text-sm elsa-text-gray-900">
                          {renderExceptionMessage(exception)}
                        </dd>
                      </div>,
                        <div class="sm:elsa-col-span-2">
                          <dt class="elsa-text-sm elsa-font-medium elsa-text-gray-500">
                            <span>Exception Details</span>
                            <elsa-copy-button value={JSON.stringify(exception, null, 1)}/>
                          </dt>
                          <dd class="elsa-mt-1 elsa-text-sm elsa-text-gray-900 elsa-overflow-x-auto">
                            <pre onClick={e => clip(e.currentTarget)}>{JSON.stringify(exception, null, 1)}</pre>
                          </dd>
                        </div>]
                    ) : undefined}
                    {collection.map(filteredRecordData, (v, k) => (
                      <div class="sm:elsa-col-span-2">
                        <dt class="elsa-text-sm elsa-font-medium elsa-text-gray-500 elsa-capitalize">
                          <span>{k}</span>
                          <elsa-copy-button value={v}/>
                        </dt>
                        <dd class="elsa-mt-1 elsa-text-sm elsa-text-gray-900 elsa-mb-2 elsa-overflow-x-auto">
                          <pre onClick={e => clip(e.currentTarget)}>{v}</pre>
                        </dd>
                      </div>
                    ))}
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </li>
      );
    };

    return (
      <div class="flow-root elsa-mt-4">
        <ul class="-elsa-mb-8">
          {items.map(renderRecord)}
        </ul>
      </div>
    );
  };

  renderActivityStateTab = () => {

    const activityModel = !!this.workflowModel && this.selectedActivityId ? this.workflowModel.activities.find(x => x.activityId === this.selectedActivityId) : null;

    if (!activityModel)
      return <p class="elsa-mt-4">No activity selected</p>;

    // Hide expressions field from properties so that we only display the evaluated value.
    const model = {...activityModel, properties: undefined};
    const persistedActivityState = this.workflowInstance?.activityData?.[this.selectedActivityId] || {};
    const displayedState = Object.keys(persistedActivityState).length > 0
      ? persistedActivityState
      : activityModel.properties.reduce((values, property) => {
        values[property.name] = property.value;
        return values;
      }, {});

    return (
      <div class="elsa-mt-4">
        <pre>{JSON.stringify(model, null, 2)}</pre>
        <dl class="elsa-mt-4 elsa-border-t elsa-border-gray-200 elsa-divide-y elsa-divide-gray-200">
          {Object.keys(displayedState).map(name => this.renderInspectableValue(name, displayedState[name]))}
        </dl>
      </div>
    );
  };

  renderGeneralTab = () => {
    const {workflowInstance, workflowBlueprint} = this;
    const {finishedAt, lastExecutedAt, faultedAt} = workflowInstance;
    const format = 'DD-MM-YYYY HH:mm:ss';
    const eventColor = this.getStatusColor(workflowInstance.workflowStatus);

    return (
      <dl class="elsa-border-b elsa-border-gray-200 elsa-divide-y elsa-divide-gray-200">
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Workflow Name</dt>
          <dd class="elsa-text-gray-900">{workflowBlueprint.name}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Instance Name</dt>
          <dd class="elsa-text-gray-900">{workflowInstance.name || '-'}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Id</dt>
          <dd class="elsa-text-gray-900">{workflowInstance.id}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Correlation id</dt>
          <dd class="elsa-text-gray-900">{workflowInstance.correlationId}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Version</dt>
          <dd class="elsa-text-gray-900 elsa-break-all">{workflowInstance.version || '-'}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Workflow Status</dt>
          <dd class="elsa-text-gray-900 elsa-break-all">
            <span class="elsa-relative elsa-inline-flex elsa-items-center elsa-rounded-full">
              <span class="elsa-flex-shrink-0 elsa-flex elsa-items-center elsa-justify-center">
                <span class={`elsa-w-2-5 elsa-h-2-5 elsa-rounded-full ${eventColor}`}
                      aria-hidden="true"/>
              </span>
              <span class="elsa-ml-3.5">{workflowInstance.workflowStatus || '-'}</span>
            </span>
          </dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Created</dt>
          <dd class="elsa-text-gray-900 elsa-break-all">{moment(workflowInstance.createdAt).format(format) || '-'}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Finished</dt>
          <dd class="elsa-text-gray-900 elsa-break-all">{finishedAt ? moment(finishedAt).format(format) : '-'}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Last Executed</dt>
          <dd
            class="elsa-text-gray-900 elsa-break-all">{lastExecutedAt ? moment(lastExecutedAt).format(format) : '-'}</dd>
        </div>
        <div class="elsa-py-3 elsa-flex elsa-justify-between elsa-text-sm elsa-font-medium">
          <dt class="elsa-text-gray-500">Faulted</dt>
          <dd class="elsa-text-gray-900 elsa-break-all">{faultedAt ? moment(faultedAt).format(format) : '-'}</dd>
        </div>
      </dl>
    )
  };

  renderVariablesTab = () => {
    const { workflowInstance } = this;
    const { variables } = workflowInstance;
    const values = variables?.data || {};

    return (
      <dl class="elsa-border-b elsa-border-gray-200 elsa-divide-y elsa-divide-gray-200">
        {Object.keys(values).length > 0
          ? Object.keys(values).map(name => this.renderInspectableValue(name, values[name]))
          : <div class="elsa-py-3 elsa-text-sm elsa-font-medium">-</div>}
      </dl>
    );
  };

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
