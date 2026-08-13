import {Component, h, Prop, State, Watch} from '@stencil/core';
import {RouterHistory, injectHistory} from "@stencil/router";
import moment from "moment";
import {
  createElsaClient,
  toastNotificationService
} from "../../../../services";
import {
  RunningWorkflowReviewItem,
  SimpleExceptionReviewEntry,
  StaleWorkflowActivityCheckpoint,
  WorkflowFaultReviewEntry,
  WorkflowActivityCheckpointPage,
  WorkflowInstanceCheckpointReview
} from "../../../../services/elsa-client";
import {WorkflowBlueprint} from "../../../../models";
import {PagerData} from "../../../controls/elsa-pager/elsa-pager";
import Tunnel from "../../../../data/dashboard";

type RecoveryAction = 'recover' | 'revive' | 'restart' | 'requeue-delay';

interface RecoveryActivityChoice {
  activityId: string;
  activityType?: string;
  activityName?: string;
  source: string;
  isDefault?: boolean;
}

interface RecoveryDialogState {
  action: RecoveryAction;
  row: StaleWorkflowActivityCheckpoint | RunningWorkflowReviewItem;
  title: string;
  description: string;
  confirmText: string;
  defaultReason: string;
  reason: string;
  selectedActivityId?: string;
  activityChoices?: Array<RecoveryActivityChoice>;
  resultMessage?: string;
  resultSuccess?: boolean;
  resultWorkflowInstanceId?: string;
  resultActivityId?: string;
  resultCheckpointId?: string;
  resultHangfireJobId?: string;
  dangerous?: boolean;
}

@Component({
  tag: 'elsa-studio-stale-checkpoints-list',
  shadow: false,
})
export class ElsaStudioStaleCheckpointsList {
  static readonly DEFAULT_PAGE_SIZE = 15;
  static readonly DEFAULT_MINIMUM_AGE_SECONDS = 300;

  @Prop() history?: RouterHistory;
  @Prop() serverUrl: string;
  @Prop() basePath: string;
  @Prop() culture: string;
  @State() page: WorkflowActivityCheckpointPage = {items: [], page: 0, pageSize: ElsaStudioStaleCheckpointsList.DEFAULT_PAGE_SIZE, totalCount: 0};
  @State() currentPage: number = 0;
  @State() currentPageSize: number = ElsaStudioStaleCheckpointsList.DEFAULT_PAGE_SIZE;
  @State() minimumAgeSeconds: number = ElsaStudioStaleCheckpointsList.DEFAULT_MINIMUM_AGE_SECONDS;
  @State() loading: boolean = false;
  @State() mode: 'stale' | 'running' | 'faulted' | 'recovered' = 'stale';
  @State() review?: WorkflowInstanceCheckpointReview;
  @State() reviewWorkflowInstanceId?: string;
  @State() searchTerm: string = '';
  @State() recoveredByType: string = '';
  @State() dateTimeMode: 'local' | 'utc' = 'local';
  @State() recoveryDialog?: RecoveryDialogState;
  @State() actionBusy: boolean = false;

  async componentWillLoad() {
    await this.load();
  }

  @Watch("currentPageSize")
  async handlePageSizeChanged() {
    await this.load();
  }

  private async createClient() {
    return await createElsaClient(this.serverUrl);
  }

  private async load() {
    this.loading = true;

    try {
      const elsaClient = await this.createClient();
      if (this.mode == 'running')
        this.page = await elsaClient.workflowActivityCheckpointsApi.listRunningForReview(this.currentPage, this.currentPageSize, this.minimumAgeSeconds, this.searchTerm) as any;
      else if (this.mode == 'faulted')
        this.page = await elsaClient.workflowActivityCheckpointsApi.listFaultedForReview(this.currentPage, this.currentPageSize, this.minimumAgeSeconds, this.searchTerm) as any;
      else if (this.mode == 'recovered')
        this.page = await elsaClient.workflowActivityCheckpointsApi.listRecovered(this.currentPage, this.currentPageSize, this.searchTerm, this.recoveredByType);
      else
        this.page = await elsaClient.workflowActivityCheckpointsApi.listStale(this.currentPage, this.currentPageSize, this.minimumAgeSeconds, this.searchTerm);
    }
    finally {
      this.loading = false;
    }
  }

  private getRowActivityId(row: any) {
    return row.activityId || row.checkpointActivityId || row.faultedActivityId || row.lastExecutedActivityId;
  }

  private getRowActivityType(row: any) {
    return row.activityType || row.checkpointActivityType;
  }

  private getRowActivityName(row: any) {
    const activityId = this.getRowActivityId(row);
    const activityType = this.getRowActivityType(row);
    return row.activityName || row.checkpointActivityName || activityType || activityId || '-';
  }

  private addActivityChoice(choices: Array<RecoveryActivityChoice>, choice: RecoveryActivityChoice) {
    if (!choice.activityId)
      return;

    if (choices.find(x => x.activityId == choice.activityId))
      return;

    choices.push(choice);
  }

  private getDefinitionActivityChoices(blueprint?: WorkflowBlueprint): Array<RecoveryActivityChoice> {
    if (!blueprint || !blueprint.activities || blueprint.activities.length == 0)
      return [];

    const activitiesById = new Map<string, any>();
    const incoming = new Map<string, Array<any>>();
    const outgoing = new Map<string, Array<any>>();

    (blueprint.activities || []).forEach(activity => {
      activitiesById.set(activity.id, activity);
      incoming.set(activity.id, []);
      outgoing.set(activity.id, []);
    });

    (blueprint.connections || []).forEach(connection => {
      if (!activitiesById.has(connection.sourceActivityId) || !activitiesById.has(connection.targetActivityId))
        return;

      incoming.get(connection.targetActivityId).push(connection);
      outgoing.get(connection.sourceActivityId).push(connection);
    });

    const orderedActivityIds: Array<string> = [];
    const visited = new Set<string>();
    const queue = (blueprint.activities || [])
      .filter(activity => (incoming.get(activity.id) || []).length == 0)
      .map(activity => activity.id);

    while (queue.length > 0) {
      const activityId = queue.shift();
      if (!activityId || visited.has(activityId))
        continue;

      visited.add(activityId);
      orderedActivityIds.push(activityId);

      (outgoing.get(activityId) || []).forEach(connection => {
        if (!visited.has(connection.targetActivityId))
          queue.push(connection.targetActivityId);
      });
    }

    (blueprint.activities || []).forEach(activity => {
      if (!visited.has(activity.id))
        orderedActivityIds.push(activity.id);
    });

    return orderedActivityIds.map(activityId => {
      const activity = activitiesById.get(activityId);
      const firstIncoming = (incoming.get(activityId) || [])[0];
      const source = firstIncoming
        ? `Definition v${blueprint.version} via ${firstIncoming.outcome || 'connection'}`
        : `Definition v${blueprint.version} start`;

      return {
        activityId: activity.id,
        activityType: activity.type,
        activityName: activity.displayName || activity.name,
        source
      };
    });
  }

  private buildActivityChoices(row: any, review?: WorkflowInstanceCheckpointReview, blueprint?: WorkflowBlueprint): Array<RecoveryActivityChoice> {
    const choices: Array<RecoveryActivityChoice> = [];
    const checkpointActivityId = this.getRowActivityId(row);

    this.addActivityChoice(choices, {
      activityId: checkpointActivityId,
      activityType: this.getRowActivityType(row),
      activityName: this.getRowActivityName(row),
      source: 'Checkpoint default',
      isDefault: true
    });

    const definitionActivityChoices = this.getDefinitionActivityChoices(blueprint);
    definitionActivityChoices.forEach(choice => this.addActivityChoice(choices, choice));

    if (definitionActivityChoices.length > 0)
      return choices;

    if (!review)
      return choices;

    this.addActivityChoice(choices, {
      activityId: review.currentActivityId,
      activityType: review.currentActivityType,
      source: 'Current activity'
    });
    this.addActivityChoice(choices, {
      activityId: review.faultedActivityId,
      source: 'Faulted activity'
    });
    this.addActivityChoice(choices, {
      activityId: review.lastExecutedActivityId,
      source: 'Last executed activity'
    });

    (review.scheduledActivities || []).forEach(x => this.addActivityChoice(choices, {
      activityId: x.activityId,
      activityType: x.activityType,
      source: 'Scheduled activity'
    }));
    (review.blockingActivities || []).forEach(x => this.addActivityChoice(choices, {
      activityId: x.activityId,
      activityType: x.activityType,
      source: 'Blocking activity'
    }));
    (review.checkpoints || []).forEach(x => this.addActivityChoice(choices, {
      activityId: x.activityId,
      activityType: x.activityType,
      activityName: x.activityName,
      source: `Checkpoint ${x.status || ''}`.trim()
    }));
    (review.executionLogs || []).forEach(x => this.addActivityChoice(choices, {
      activityId: x.activityId,
      activityType: x.activityType,
      source: `Execution log ${x.eventName || ''}`.trim()
    }));

    return choices;
  }

  private formatActivityChoice(choice: RecoveryActivityChoice) {
    const title = choice.activityName || choice.activityType || choice.activityId;
    const meta = [choice.activityType, choice.activityId].filter(x => !!x).join(' / ');
    const defaultMarker = choice.isDefault ? ' (default)' : '';
    return `${title}${meta && meta != title ? ` - ${meta}` : ''} - ${choice.source}${defaultMarker}`;
  }

  private async openRecoveryDialog(
    action: RecoveryAction,
    row: StaleWorkflowActivityCheckpoint | RunningWorkflowReviewItem,
    title: string,
    description: string,
    defaultReason: string,
    confirmText: string,
    dangerous: boolean = false) {
    const rowAny: any = row;
    let activityChoices: Array<RecoveryActivityChoice> = [];
    const defaultActivityId = this.getRowActivityId(rowAny);

    if (action == 'restart') {
      try {
        const elsaClient = await this.createClient();
        const review = await elsaClient.workflowActivityCheckpointsApi.getReview(row.workflowInstanceId);
        const definitionId = review.definitionId || rowAny.definitionId;
        const version = review.version || rowAny.version;
        let blueprint: WorkflowBlueprint = null;

        if (!!definitionId && !!version) {
          try {
            blueprint = await elsaClient.workflowRegistryApi.get(definitionId, {version});
          } catch {
            blueprint = null;
          }
        }

        activityChoices = this.buildActivityChoices(rowAny, review, blueprint);
      } catch {
        activityChoices = this.buildActivityChoices(rowAny);
      }
    }

    this.recoveryDialog = {
      action,
      row,
      title,
      description,
      defaultReason,
      reason: defaultReason,
      selectedActivityId: defaultActivityId,
      activityChoices,
      confirmText,
      dangerous
    };
  }

  private closeRecoveryDialog() {
    if (this.actionBusy)
      return;

    this.recoveryDialog = null;
  }

  private async executeRecoveryDialog() {
    if (!this.recoveryDialog)
      return;

    const dialog = this.recoveryDialog;
    const row: any = dialog.row;
    const reason = (dialog.reason || dialog.defaultReason).trim() || dialog.defaultReason;
    const elsaClient = await this.createClient();

    this.actionBusy = true;

    try {
      let result;

      if (dialog.action == 'recover') {
        result = await elsaClient.workflowActivityCheckpointsApi.recoverFromCheckpoint(row.workflowInstanceId, {
          checkpointId: row.checkpointId,
          activityId: row.activityId,
          reason
        });
      } else if (dialog.action == 'revive') {
        result = await elsaClient.workflowActivityCheckpointsApi.reviveFaulted(row.workflowInstanceId, {
          activityId: row.activityId || row.checkpointActivityId,
          checkpointId: row.checkpointId,
          reason
        });
      } else if (dialog.action == 'restart') {
        result = await elsaClient.workflowActivityCheckpointsApi.restartFromActivity(row.workflowInstanceId, {
          activityId: dialog.selectedActivityId || row.activityId,
          reason
        });
      } else {
        result = await elsaClient.workflowActivityCheckpointsApi.requeueDelay(row.workflowInstanceId, row.activityId, reason);
      }

      if (!result.success) {
        this.recoveryDialog = {
          ...dialog,
          resultSuccess: false,
          resultMessage: result.message || 'Recovery was rejected by the server.',
          resultWorkflowInstanceId: result.workflowInstanceId,
          resultActivityId: result.activityId,
          resultCheckpointId: result.checkpointId,
          resultHangfireJobId: result.hangfireJobId
        };
        toastNotificationService.show('Recovery rejected', result.message || 'Recovery was rejected by the server.', 5000);
        await this.load();
        return;
      }

      toastNotificationService.show(dialog.confirmText, result.message, 3000);
      this.recoveryDialog = null;
      await this.load();
    }
    finally {
      this.actionBusy = false;
    }
  }

  private async showReview(row: StaleWorkflowActivityCheckpoint | RunningWorkflowReviewItem) {
    const workflowInstanceId = row.workflowInstanceId;

    if (this.reviewWorkflowInstanceId == workflowInstanceId) {
      this.reviewWorkflowInstanceId = null;
      this.review = null;
      return;
    }

    const elsaClient = await this.createClient();
    this.review = await elsaClient.workflowActivityCheckpointsApi.getReview(workflowInstanceId);
    this.reviewWorkflowInstanceId = workflowInstanceId;
  }

  private async onMinimumAgeChanged(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = parseInt(input.value);
    this.minimumAgeSeconds = isNaN(value) ? ElsaStudioStaleCheckpointsList.DEFAULT_MINIMUM_AGE_SECONDS : Math.max(30, value);
    this.currentPage = 0;
    await this.load();
  }

  private onPaged = async (e: CustomEvent<PagerData>) => {
    this.currentPage = e.detail.page;
    await this.load();
  };

  private async changeMode(mode: 'stale' | 'running' | 'faulted' | 'recovered') {
    this.mode = mode;
    this.currentPage = 0;
    this.review = null;
    this.reviewWorkflowInstanceId = null;
    await this.load();
  }

  private formatDate(value?: any) {
    if (!value)
      return '-';

    const date = this.dateTimeMode == 'utc' ? moment.utc(value) : moment(value);
    return `${date.format('DD-MM-YYYY HH:mm:ss')} ${this.dateTimeMode.toUpperCase()}`;
  }

  private getStaleReason(row: any) {
    if (row.reason)
      return row.reason;

    if (row.reviewHint)
      return row.reviewHint;

    if (row.workflowStatus == 'Running' && row.checkpointStatus == 'Executing')
      return 'Workflow is Running with an activity checkpoint still marked Executing past the selected minimum age.';

    if (row.workflowStatus == 'Faulted')
      return 'Workflow is Faulted; review exception details before same-instance revive.';

    return 'Review checkpoint and execution log evidence.';
  }

  private async applySearch() {
    this.currentPage = 0;
    this.review = null;
    this.reviewWorkflowInstanceId = null;
    await this.load();
  }

  private async clearSearch() {
    this.searchTerm = '';
    await this.applySearch();
  }

  private async onSearchKeyDown(e: KeyboardEvent) {
    if (e.key == 'Enter')
      await this.applySearch();
  }

  private getExceptionDetail() {
    if (!this.review)
      return null;

    const faultLog = (this.review.executionLogs || [])
      .find(x => (x.eventName || '').toLowerCase() == 'faulted' && !!x.message);

    return this.review.faultMessage || faultLog?.message || null;
  }

  private getFaults(): Array<WorkflowFaultReviewEntry> {
    if (!this.review)
      return [];

    return this.review.faults || [];
  }

  private renderException(exception?: SimpleExceptionReviewEntry, level: number = 0) {
    if (!exception)
      return null;

    const hasInnerException = !!exception.innerException;
    const dataEntries = Object.entries(exception.data || {});

    return (
      <div class={`${level > 0 ? 'elsa-ml-4 elsa-mt-3 elsa-border-l elsa-border-gray-200 elsa-pl-4' : ''}`}>
        <div class="elsa-text-xs elsa-font-semibold elsa-text-red-700">{exception.type || 'Exception'}</div>
        {!!exception.message && <div class="elsa-mt-1 elsa-text-xs elsa-text-red-700 elsa-whitespace-pre-wrap">{exception.message}</div>}
        {!!exception.stackTrace && (
          <details class="elsa-mt-2">
            <summary class="elsa-cursor-pointer elsa-text-xs elsa-text-gray-700">Stack trace</summary>
            <pre class="elsa-mt-2 elsa-p-3 elsa-bg-gray-50 elsa-border elsa-border-gray-300 elsa-text-gray-900 elsa-rounded-md elsa-text-xs elsa-whitespace-pre-wrap elsa-overflow-auto">
              {exception.stackTrace}
            </pre>
          </details>
        )}
        {dataEntries.length > 0 && (
          <details class="elsa-mt-2">
            <summary class="elsa-cursor-pointer elsa-text-xs elsa-text-gray-700">Data</summary>
            <pre class="elsa-mt-2 elsa-p-3 elsa-bg-white elsa-border elsa-border-gray-200 elsa-rounded-md elsa-text-xs elsa-whitespace-pre-wrap">
              {JSON.stringify(exception.data, null, 2)}
            </pre>
          </details>
        )}
        {hasInnerException && (
          <details class="elsa-mt-2" open={level == 0}>
            <summary class="elsa-cursor-pointer elsa-text-xs elsa-font-medium elsa-text-red-700">Inner exception</summary>
            {this.renderException(exception.innerException, level + 1)}
          </details>
        )}
      </div>
    );
  }

  private renderFault(fault: WorkflowFaultReviewEntry, index: number) {
    return (
      <details class="elsa-mt-2 elsa-bg-white elsa-border elsa-border-gray-200 elsa-rounded-md" open={index == 0}>
        <summary class="elsa-cursor-pointer elsa-px-3 elsa-py-2 elsa-text-sm elsa-font-medium elsa-text-gray-900">
          Fault #{index + 1}: {fault.exception?.type || 'Workflow fault'} {fault.faultedActivityId ? `(${fault.faultedActivityId})` : ''}
        </summary>
        <div class="elsa-px-3 elsa-pb-3">
          {!!fault.message && (
            <div class="elsa-mb-3">
              <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-700">Message</div>
              <div class="elsa-mt-1 elsa-text-xs elsa-text-red-700 elsa-whitespace-pre-wrap">{fault.message}</div>
            </div>
          )}
          <div class="elsa-mb-3 elsa-grid elsa-grid-cols-3 elsa-gap-4 elsa-text-xs elsa-text-gray-600">
            <div>Faulted activity: {fault.faultedActivityId || '-'}</div>
            <div>Resuming: {fault.resuming ? 'Yes' : 'No'}</div>
          </div>
          {this.renderException(fault.exception)}
          {!!fault.activityInput && (
            <details class="elsa-mt-3">
              <summary class="elsa-cursor-pointer elsa-text-xs elsa-text-gray-700">Activity input</summary>
              <pre class="elsa-mt-2 elsa-p-3 elsa-bg-white elsa-border elsa-border-gray-200 elsa-rounded-md elsa-text-xs elsa-whitespace-pre-wrap elsa-overflow-auto">
                {JSON.stringify(fault.activityInput, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </details>
    );
  }

  private renderRecoveryDialog() {
    const dialog = this.recoveryDialog;

    if (!dialog)
      return null;

    const row: any = dialog.row;
    const activityId = this.getRowActivityId(row);
    const activityType = this.getRowActivityType(row);
    const activityName = this.getRowActivityName(row);

    return (
      <div class="elsa-fixed elsa-inset-0 elsa-z-50 elsa-overflow-y-auto" role="dialog" aria-modal="true">
        <div class="elsa-flex elsa-min-h-screen elsa-items-center elsa-justify-center elsa-px-4 elsa-py-8">
          <div class="elsa-fixed elsa-inset-0 elsa-bg-gray-900 elsa-opacity-60" onClick={() => this.closeRecoveryDialog()}></div>
          <div class="elsa-relative elsa-bg-white elsa-rounded-lg elsa-shadow-xl elsa-w-full elsa-max-w-3xl">
            <div class="elsa-flex elsa-items-start elsa-justify-between elsa-px-6 elsa-py-5 elsa-border-b elsa-border-gray-200">
              <div class="elsa-flex elsa-items-start">
                <div class={`elsa-flex-shrink-0 elsa-h-10 elsa-w-10 elsa-rounded-full elsa-flex elsa-items-center elsa-justify-center ${dialog.dangerous ? 'elsa-bg-yellow-100' : 'elsa-bg-blue-100'}`}>
                  <span class={`elsa-text-lg ${dialog.dangerous ? 'elsa-text-yellow-700' : 'elsa-text-blue-700'}`}>!</span>
                </div>
                <div class="elsa-ml-4">
                  <h3 class="elsa-text-lg elsa-leading-6 elsa-font-medium elsa-text-gray-900">{dialog.title}</h3>
                  <p class="elsa-mt-1 elsa-text-sm elsa-text-gray-500">{dialog.description}</p>
                </div>
              </div>
              <button type="button" class="elsa-text-gray-400 hover:elsa-text-gray-600" onClick={() => this.closeRecoveryDialog()}>?</button>
            </div>
            <div class="elsa-px-6 elsa-py-5 elsa-space-y-4">
              {dialog.resultSuccess === false && (
                <div class="elsa-rounded-md elsa-bg-red-50 elsa-border elsa-border-red-200 elsa-p-4">
                  <div class="elsa-flex">
                    <div class="elsa-flex-shrink-0">
                      <span class="elsa-inline-flex elsa-items-center elsa-justify-center elsa-h-6 elsa-w-6 elsa-rounded-full elsa-bg-red-100 elsa-text-red-700 elsa-text-sm elsa-font-semibold">!</span>
                    </div>
                    <div class="elsa-ml-3">
                      <h4 class="elsa-text-sm elsa-font-medium elsa-text-red-800">Recovery was rejected</h4>
                      <div class="elsa-mt-1 elsa-text-sm elsa-text-red-700 elsa-whitespace-pre-wrap">{dialog.resultMessage}</div>
                      <dl class="elsa-mt-3 elsa-grid elsa-grid-cols-1 sm:elsa-grid-cols-2 elsa-gap-x-4 elsa-gap-y-2 elsa-text-xs">
                        <div>
                          <dt class="elsa-font-semibold elsa-text-red-800">Workflow instance</dt>
                          <dd class="elsa-font-mono elsa-text-red-700 elsa-break-all">{dialog.resultWorkflowInstanceId || row.workflowInstanceId || '-'}</dd>
                        </div>
                        <div>
                          <dt class="elsa-font-semibold elsa-text-red-800">Activity</dt>
                          <dd class="elsa-font-mono elsa-text-red-700 elsa-break-all">{dialog.resultActivityId || activityId || '-'}</dd>
                        </div>
                        <div>
                          <dt class="elsa-font-semibold elsa-text-red-800">Checkpoint</dt>
                          <dd class="elsa-font-mono elsa-text-red-700 elsa-break-all">{dialog.resultCheckpointId || row.checkpointId || '-'}</dd>
                        </div>
                        <div>
                          <dt class="elsa-font-semibold elsa-text-red-800">Hangfire job</dt>
                          <dd class="elsa-font-mono elsa-text-red-700 elsa-break-all">{dialog.resultHangfireJobId || '-'}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              )}
              <div class="elsa-grid elsa-grid-cols-2 elsa-gap-4 elsa-text-sm">
                <div>
                  <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-500 elsa-uppercase">Workflow instance</div>
                  <div class="elsa-mt-1 elsa-font-mono elsa-text-gray-900 elsa-break-all">{row.workflowInstanceId}</div>
                </div>
                <div>
                  <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-500 elsa-uppercase">Correlation id</div>
                  <div class="elsa-mt-1 elsa-font-mono elsa-text-gray-900 elsa-break-all">{row.correlationId || '-'}</div>
                </div>
                <div>
                  <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-500 elsa-uppercase">Activity</div>
                  <div class="elsa-mt-1 elsa-text-gray-900">{activityName}</div>
                  <div class="elsa-text-xs elsa-text-gray-500">{activityType || '-'} / {activityId || '-'}</div>
                </div>
                <div>
                  <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-500 elsa-uppercase">Status</div>
                  <div class="elsa-mt-1 elsa-text-gray-900">{row.workflowStatus || '-'}</div>
                  <div class="elsa-text-xs elsa-text-gray-500">{row.checkpointStatus || '-'}</div>
                </div>
              </div>
              <div class="elsa-rounded-md elsa-bg-gray-50 elsa-border elsa-border-gray-200 elsa-p-3">
                <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-500 elsa-uppercase">Why this is stale</div>
                <div class="elsa-mt-1 elsa-text-sm elsa-text-gray-700">{this.getStaleReason(row)}</div>
              </div>
              {dialog.action == 'restart' && (
                <div>
                  <label class="elsa-block elsa-text-sm elsa-font-medium elsa-text-gray-700">Resume activity</label>
                  <select
                    class="elsa-mt-1 elsa-shadow-sm focus:elsa-ring-blue-500 focus:elsa-border-blue-500 elsa-block elsa-w-full sm:elsa-text-sm elsa-border-gray-300 elsa-rounded-md"
                    onChange={e => this.recoveryDialog = {...dialog, selectedActivityId: (e.target as HTMLSelectElement).value}}>
                    {(dialog.activityChoices || []).map(choice => (
                      <option value={choice.activityId} selected={choice.activityId == dialog.selectedActivityId}>{this.formatActivityChoice(choice)}</option>
                    ))}
                  </select>
                  <p class="elsa-mt-1 elsa-text-xs elsa-text-gray-500">The checkpoint activity is selected by default. Choose another activity only after reviewing side effects.</p>
                </div>
              )}
              <div>
                <label class="elsa-block elsa-text-sm elsa-font-medium elsa-text-gray-700">Recovery reason</label>
                <textarea
                  class="elsa-mt-1 elsa-shadow-sm focus:elsa-ring-blue-500 focus:elsa-border-blue-500 elsa-block elsa-w-full sm:elsa-text-sm elsa-border-gray-300 elsa-rounded-md"
                  rows={4}
                  value={dialog.reason}
                  onInput={e => this.recoveryDialog = {...dialog, reason: (e.target as HTMLTextAreaElement).value}}
                />
                <p class="elsa-mt-1 elsa-text-xs elsa-text-gray-500">This reason will be stored in the recovery audit trail.</p>
              </div>
            </div>
            <div class="elsa-bg-gray-50 elsa-px-6 elsa-py-4 elsa-flex elsa-justify-end elsa-space-x-3">
              <button type="button"
                      class="elsa-inline-flex elsa-items-center elsa-px-4 elsa-py-2 elsa-border elsa-border-gray-300 elsa-shadow-sm elsa-text-sm elsa-font-medium elsa-rounded-md elsa-text-gray-700 elsa-bg-white hover:elsa-bg-gray-50"
                      disabled={this.actionBusy}
                      onClick={() => this.closeRecoveryDialog()}>
                Cancel
              </button>
              <button type="button"
                      class={`elsa-inline-flex elsa-items-center elsa-px-4 elsa-py-2 elsa-border elsa-border-transparent elsa-shadow-sm elsa-text-sm elsa-font-medium elsa-rounded-md elsa-text-white ${dialog.dangerous ? 'elsa-bg-yellow-600 hover:elsa-bg-yellow-700' : 'elsa-bg-blue-600 hover:elsa-bg-blue-700'}`}
                      disabled={this.actionBusy}
                      onClick={() => this.executeRecoveryDialog()}>
                {this.actionBusy ? 'Working...' : dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  render() {
    const items = this.loading ? [] : (this.page.items || []);
    const basePath = this.basePath || '';
    const description =
      this.mode == 'running'
        ? 'Running workflow instances for evidence review. Recover is only enabled when a stale Executing checkpoint is still current or scheduled.'
        : this.mode == 'faulted'
          ? 'Faulted workflow instances for evidence review. Use this to inspect checkpoint and execution-log evidence before same-instance revive or manual retry.'
          : this.mode == 'recovered'
            ? 'Recovered checkpoint audit history. Use this to see whether stale workflows were handled manually by a user or automatically by a sweeper.'
            : 'Running workflow bursts with stale Executing activity checkpoints, plus stale suspended Delay activities whose Hangfire job can be safely requeued.';
    const emptyText =
      this.mode == 'running'
        ? 'No running workflow instances found for review.'
        : this.mode == 'faulted'
          ? 'No faulted workflow instances found for review.'
          : this.mode == 'recovered'
            ? 'No recovered checkpoints found.'
            : 'No stale checkpoints found.';

    return (
      <div>
        {this.renderRecoveryDialog()}
        <div class="elsa-bg-white elsa-border-b elsa-border-gray-200 elsa-px-8 elsa-py-6">
          <div class="elsa-flex elsa-items-center elsa-justify-between">
            <div>
              <h1 class="elsa-text-2xl elsa-font-semibold elsa-text-gray-900">Stale Checkpoints</h1>
              <p class="elsa-mt-1 elsa-text-sm elsa-text-gray-500">{description}</p>
            </div>
            <div class="elsa-flex elsa-items-center elsa-space-x-3">
              <select class="elsa-shadow-sm focus:elsa-ring-blue-500 focus:elsa-border-blue-500 elsa-block sm:elsa-text-sm elsa-border-gray-300 elsa-rounded-md"
                      onChange={e => this.dateTimeMode = (e.target as HTMLSelectElement).value as any}>
                <option value="local" selected={this.dateTimeMode == 'local'}>Local time</option>
                <option value="utc" selected={this.dateTimeMode == 'utc'}>UTC</option>
              </select>
              <button type="button"
                      class="elsa-inline-flex elsa-items-center elsa-px-4 elsa-py-2 elsa-border elsa-border-transparent elsa-text-sm elsa-font-medium elsa-rounded-md elsa-shadow-sm elsa-text-white elsa-bg-blue-600 hover:elsa-bg-blue-700"
                      onClick={() => this.load()}>
                {this.loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>

        <div class="elsa-relative elsa-z-10 elsa-flex-shrink-0 elsa-flex elsa-h-16 elsa-bg-white elsa-border-b elsa-border-gray-200">
          <div class="elsa-flex-1 elsa-px-4 elsa-flex elsa-items-center elsa-justify-between sm:elsa-px-6 lg:elsa-px-8">
            <form class="elsa-w-full elsa-flex md:elsa-ml-0" onSubmit={e => {
              e.preventDefault();
              this.applySearch();
            }}>
              <label htmlFor="stale_checkpoint_search_field" class="elsa-sr-only">Search</label>
              <div class="elsa-relative elsa-w-full elsa-text-gray-400 focus-within:elsa-text-gray-600">
                <div class="elsa-absolute elsa-inset-y-0 elsa-left-0 elsa-flex elsa-items-center elsa-pointer-events-none">
                  <svg class="elsa-h-5 elsa-w-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" clip-rule="evenodd"
                          d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"/>
                  </svg>
                </div>
                <input id="stale_checkpoint_search_field"
                       name="searchTerm"
                       class="elsa-block elsa-w-full elsa-h-full elsa-pl-8 elsa-pr-3 elsa-py-2 elsa-rounded-md elsa-text-gray-900 elsa-placeholder-gray-500 focus:elsa-placeholder-gray-400 sm:elsa-text-sm elsa-border-0 focus:elsa-outline-none focus:elsa-ring-0"
                       placeholder="Search by workflow instance ID or correlation ID"
                       type="search"
                       value={this.searchTerm}
                       onInput={e => this.searchTerm = (e.target as HTMLInputElement).value}/>
              </div>
            </form>
          </div>
        </div>

        <div class="elsa-p-8 elsa-bg-white elsa-border-b elsa-border-gray-200 elsa-space-y-4">
          <div class="elsa-flex elsa-items-center elsa-justify-between elsa-gap-4">
            <div class="elsa-flex elsa-items-center elsa-space-x-3">
              <button type="button"
                      class={`elsa-inline-flex elsa-items-center elsa-px-3 elsa-py-2 elsa-border elsa-text-sm elsa-font-medium elsa-rounded-md ${this.mode == 'stale' ? 'elsa-bg-blue-600 elsa-text-white elsa-border-blue-600' : 'elsa-bg-white elsa-text-gray-700 elsa-border-gray-300'}`}
                      onClick={() => this.changeMode('stale')}>
                Actionable stale
              </button>
              <button type="button"
                      class={`elsa-inline-flex elsa-items-center elsa-px-3 elsa-py-2 elsa-border elsa-text-sm elsa-font-medium elsa-rounded-md ${this.mode == 'running' ? 'elsa-bg-blue-600 elsa-text-white elsa-border-blue-600' : 'elsa-bg-white elsa-text-gray-700 elsa-border-gray-300'}`}
                      onClick={() => this.changeMode('running')}>
                Running review
              </button>
              <button type="button"
                      class={`elsa-inline-flex elsa-items-center elsa-px-3 elsa-py-2 elsa-border elsa-text-sm elsa-font-medium elsa-rounded-md ${this.mode == 'faulted' ? 'elsa-bg-blue-600 elsa-text-white elsa-border-blue-600' : 'elsa-bg-white elsa-text-gray-700 elsa-border-gray-300'}`}
                      onClick={() => this.changeMode('faulted')}>
                Faulted review
              </button>
              <button type="button"
                      class={`elsa-inline-flex elsa-items-center elsa-px-3 elsa-py-2 elsa-border elsa-text-sm elsa-font-medium elsa-rounded-md ${this.mode == 'recovered' ? 'elsa-bg-blue-600 elsa-text-white elsa-border-blue-600' : 'elsa-bg-white elsa-text-gray-700 elsa-border-gray-300'}`}
                      onClick={() => this.changeMode('recovered')}>
                Recovered history
              </button>
            </div>
            {this.mode != 'recovered' && (
              <div class="elsa-flex elsa-items-center elsa-space-x-3">
                <label class="elsa-text-sm elsa-font-medium elsa-text-gray-700" htmlFor="minimum-age">Minimum age seconds</label>
                <input id="minimum-age"
                       type="number"
                       min="30"
                       value={this.minimumAgeSeconds}
                       class="elsa-shadow-sm focus:elsa-ring-blue-500 focus:elsa-border-blue-500 elsa-block elsa-w-32 sm:elsa-text-sm elsa-border-gray-300 elsa-rounded-md"
                       onChange={e => this.onMinimumAgeChanged(e)}/>
              </div>
            )}
          </div>
          <div class="elsa-flex elsa-items-center elsa-space-x-3">
            {!!this.searchTerm && (
              <button type="button"
                      class="elsa-inline-flex elsa-items-center elsa-px-3 elsa-py-2 elsa-border elsa-border-gray-300 elsa-text-sm elsa-font-medium elsa-rounded-md elsa-text-gray-700 elsa-bg-white hover:elsa-bg-gray-50"
                      onClick={() => this.clearSearch()}>
                Clear
              </button>
            )}
            {this.mode == 'recovered' && (
              <select class="elsa-shadow-sm focus:elsa-ring-blue-500 focus:elsa-border-blue-500 elsa-block sm:elsa-text-sm elsa-border-gray-300 elsa-rounded-md"
                      onChange={async e => {
                        this.recoveredByType = (e.target as HTMLSelectElement).value;
                        await this.applySearch();
                      }}>
                <option value="" selected={this.recoveredByType == ''}>All recovered by</option>
                <option value="DashboardUser" selected={this.recoveredByType == 'DashboardUser'}>Dashboard user</option>
                <option value="Dashboard" selected={this.recoveredByType == 'Dashboard'}>Dashboard</option>
                <option value="BackgroundWorkflowResumptionService" selected={this.recoveredByType == 'BackgroundWorkflowResumptionService'}>Background resumption</option>
                <option value="DelayActivitySweeper" selected={this.recoveredByType == 'DelayActivitySweeper'}>Delay sweeper</option>
              </select>
            )}
          </div>
        </div>

        <div class="elsa-mt-8 sm:elsa-block">
          <div class="elsa-align-middle elsa-inline-block elsa-min-w-full elsa-border-b elsa-border-gray-200">
            <table class={`elsa-min-w-full ${this.loading ? 'elsa-opacity-75' : ''}`}>
              <thead>
              <tr class="elsa-border-t elsa-border-gray-200">
                {['Workflow Instance', 'Status', 'Activity', this.mode == 'recovered' ? 'Recovered On' : 'Last Seen', this.mode == 'recovered' ? 'Recovered By' : 'Stale For', 'Transaction', 'Reason', 'Actions'].map(x =>
                  <th class="elsa-px-6 elsa-py-3 elsa-border-b elsa-border-gray-200 elsa-bg-gray-50 elsa-text-left elsa-text-xs elsa-leading-4 elsa-font-medium elsa-text-gray-500 elsa-uppercase elsa-tracking-wider">{x}</th>)}
              </tr>
              </thead>
              <tbody class="elsa-bg-white elsa-divide-y elsa-divide-gray-100">
              {this.loading && (
                <tr>
                  <td colSpan={8} class="elsa-px-6 elsa-py-8 elsa-text-center elsa-text-sm elsa-text-gray-500">
                    <div class="elsa-inline-flex elsa-items-center elsa-space-x-2">
                      <span class="elsa-inline-block elsa-h-4 elsa-w-4 elsa-rounded-full elsa-border-2 elsa-border-blue-600 elsa-border-t-transparent elsa-animate-spin"></span>
                      <span>Loading workflow data...</span>
                    </div>
                  </td>
                </tr>
              )}
              {!this.loading && items.length == 0 && (
                <tr>
                  <td colSpan={8} class="elsa-px-6 elsa-py-8 elsa-text-center elsa-text-sm elsa-text-gray-500">
                    {emptyText}
                  </td>
                </tr>
              )}
              {items.map(row => {
                const instanceUrl = `${basePath}/workflow-instances/${row.workflowInstanceId}`;
                const checkpointActivityId = (row as any).activityId || (row as any).checkpointActivityId;
                const faultedActivityId = (row as any).faultedActivityId;
                const lastExecutedActivityId = (row as any).lastExecutedActivityId;
                const checkpointActivityType = (row as any).activityType || (row as any).checkpointActivityType;
                const checkpointActivityName = (row as any).activityName || (row as any).checkpointActivityName;
                const checkpointStatus = (row as any).checkpointStatus || '-';
                const displayActivityId = checkpointActivityId || faultedActivityId || lastExecutedActivityId;
                const displayActivityName = checkpointActivityName || checkpointActivityType || displayActivityId || '-';
                const displayActivityMeta = `${checkpointActivityType || '-'} / ${displayActivityId || '-'}`;
                const lastSeenAt = !!(row as any).lastSeenAt ? moment((row as any).lastSeenAt) : (!!(row as any).checkpointLastSeenAt ? moment((row as any).checkpointLastSeenAt) : null);
                const staleMinutes = Math.floor((((row as any).staleForSeconds || (row as any).checkpointAgeSeconds || (row as any).ageSeconds || 0) / 60));
                const transactionId = (row as any).transactionId;
                const idempotencyKey = (row as any).idempotencyKey;
                const reason = this.getStaleReason(row as any);
                const recoveredByType = (row as any).recoveredByType;
                const recoveredByName = (row as any).recoveredByName;
                const recoveredOn = (row as any).recoveredOn;
                const recoveredReason = (row as any).recoveredReason;
                const canRecover = (row as any).canRecoverFromCheckpoint && !!checkpointActivityId && !!(row as any).checkpointId;
                const canRequeueDelay = (row as any).canRequeueDelay;

                return (
                  [
                    <tr>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-font-medium elsa-text-gray-900">
                        <stencil-route-link url={instanceUrl} anchorClass="elsa-truncate hover:elsa-text-gray-600">{row.workflowInstanceId}</stencil-route-link>
                        <div class="elsa-text-xs elsa-text-gray-500">{row.correlationId || '-'}</div>
                      </td>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-text-gray-500">{row.workflowStatus}</td>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-text-gray-900">
                        <div>{displayActivityName}</div>
                        <div class="elsa-text-xs elsa-text-gray-500">{displayActivityMeta}</div>
                        {this.mode == 'faulted' && !!faultedActivityId && !checkpointActivityId && (
                          <div class="elsa-text-xs elsa-text-red-600">Faulted activity</div>
                        )}
                        <div class="elsa-text-xs elsa-text-gray-400">{checkpointStatus}</div>
                      </td>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-text-gray-500">
                        {this.mode == 'recovered' ? this.formatDate(recoveredOn) : this.formatDate(lastSeenAt)}
                      </td>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-text-gray-500">
                        {this.mode == 'recovered' ? (
                          <div>
                            <div>{recoveredByName || recoveredByType || '-'}</div>
                            <div class="elsa-text-xs elsa-text-gray-400">{recoveredByType || ''}</div>
                          </div>
                        ) : `${staleMinutes} min`}
                      </td>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-text-gray-500">
                        <div>{transactionId || '-'}</div>
                        <div class="elsa-text-xs elsa-text-gray-400">{idempotencyKey || ''}</div>
                      </td>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-text-gray-500">
                        <div>{reason}</div>
                        {!!recoveredByType && (
                          <div class="elsa-mt-1 elsa-text-xs elsa-text-green-700">
                            Recovered by {recoveredByName || recoveredByType} ({recoveredByType})
                            {!!recoveredOn ? ` at ${this.formatDate(recoveredOn)}` : ''}
                          </div>
                        )}
                        {!!recoveredReason && <div class="elsa-text-xs elsa-text-green-600">{recoveredReason}</div>}
                      </td>
                      <td class="elsa-px-6 elsa-py-3 elsa-text-sm elsa-text-gray-500">
                        <div class="elsa-flex elsa-flex-wrap elsa-items-center elsa-gap-2">
                        <button type="button" class="elsa-inline-flex elsa-items-center elsa-rounded-md elsa-border elsa-border-gray-300 elsa-bg-white elsa-px-2 elsa-py-1 elsa-text-xs elsa-font-medium elsa-text-gray-700 hover:elsa-bg-gray-50 elsa-whitespace-nowrap" onClick={() => this.showReview(row)}>Review</button>
                        {canRecover && (
                          <button type="button" class="elsa-inline-flex elsa-items-center elsa-rounded-md elsa-border elsa-border-blue-200 elsa-bg-blue-50 elsa-px-2 elsa-py-1 elsa-text-xs elsa-font-medium elsa-text-blue-700 hover:elsa-bg-blue-100 elsa-whitespace-nowrap" onClick={() => this.openRecoveryDialog(
                            'recover',
                            row as any,
                            'Recover Workflow',
                            `Dispatch workflow ${row.workflowInstanceId} from checkpoint activity ${displayActivityName}. Use this when the activity did not complete and side effects are safe or idempotent.`,
                            'manual stale checkpoint recovery',
                            'Recover')}>
                            Recover
                          </button>
                        )}
                        {this.mode == 'faulted' && (
                          <button type="button" class="elsa-inline-flex elsa-items-center elsa-rounded-md elsa-border elsa-border-blue-200 elsa-bg-blue-50 elsa-px-2 elsa-py-1 elsa-text-xs elsa-font-medium elsa-text-blue-700 hover:elsa-bg-blue-100 elsa-whitespace-nowrap" onClick={() => this.openRecoveryDialog(
                            'revive',
                            row as any,
                            'Revive Faulted Workflow',
                            `Revive the same workflow instance ${row.workflowInstanceId} from its persisted faulted activity. This does not create a new workflow instance from the start.`,
                            'manual same-instance faulted revive',
                            'Revive')}>
                            Revive
                          </button>
                        )}
                        {this.mode == 'stale' && (
                          <button type="button" class="elsa-inline-flex elsa-items-center elsa-rounded-md elsa-border elsa-border-yellow-200 elsa-bg-yellow-50 elsa-px-2 elsa-py-1 elsa-text-xs elsa-font-medium elsa-text-yellow-800 hover:elsa-bg-yellow-100 elsa-whitespace-nowrap" onClick={() => this.openRecoveryDialog(
                            'restart',
                            row as any,
                            'Soft Reset From Activity',
                            `Soft-reset workflow ${row.workflowInstanceId} and resume from a selected activity. The checkpoint activity is selected by default.`,
                            'manual restart from selected activity',
                            'Soft Reset',
                            true)}>
                            Soft Reset
                          </button>
                        )}
                        {canRequeueDelay && (
                          <button type="button" class="elsa-inline-flex elsa-items-center elsa-rounded-md elsa-border elsa-border-green-200 elsa-bg-green-50 elsa-px-2 elsa-py-1 elsa-text-xs elsa-font-medium elsa-text-green-700 hover:elsa-bg-green-100 elsa-whitespace-nowrap" onClick={() => this.openRecoveryDialog(
                            'requeue-delay',
                            row as any,
                            'Requeue Delay',
                            `Requeue Delay activity ${displayActivityId} for workflow ${row.workflowInstanceId}. The server will revalidate status, blocking activity, ResumeAt, and Hangfire job state before enqueueing.`,
                            'manual stale delay requeue',
                            'Requeue Delay')}>
                            Requeue Delay
                          </button>
                        )}
                        </div>
                      </td>
                    </tr>,
                    this.reviewWorkflowInstanceId == row.workflowInstanceId && !!this.review && (
                      <tr>
                        <td colSpan={8} class="elsa-bg-gray-50 elsa-px-6 elsa-py-4">
                          {this.mode == 'faulted' ? (
                            <div>
                              <div class="elsa-text-sm elsa-text-gray-900 elsa-font-medium">Exception detail</div>
                              {this.getFaults().length > 0 ? (
                                <div class="elsa-mt-2">
                                  {this.getFaults().map((fault, index) => this.renderFault(fault, index))}
                                </div>
                              ) : (
                                <pre class="elsa-mt-2 elsa-p-3 elsa-bg-white elsa-border elsa-border-gray-200 elsa-rounded-md elsa-text-xs elsa-text-red-700 elsa-whitespace-pre-wrap">
                                  {this.getExceptionDetail() || 'No exception detail was captured for this faulted workflow.'}
                                </pre>
                              )}
                              <div class="elsa-mt-3 elsa-grid elsa-grid-cols-3 elsa-gap-4 elsa-text-xs elsa-text-gray-600">
                                <div>Current: {this.review.currentActivityId || '-'}</div>
                                <div>Faulted: {this.review.faultedActivityId || '-'}</div>
                                <div>Scheduled: {this.review.scheduledActivityCount}</div>
                                <div>Blocking: {this.review.blockingActivityCount}</div>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div class="elsa-text-sm elsa-text-gray-900 elsa-font-medium">Review recommendation</div>
                              <div class="elsa-mt-1 elsa-text-sm elsa-text-gray-600">{this.review.recommendation}</div>
                              <div class="elsa-mt-3 elsa-grid elsa-grid-cols-3 elsa-gap-4 elsa-text-xs elsa-text-gray-600">
                                <div>Current: {this.review.currentActivityId || '-'}</div>
                                <div>Scheduled: {this.review.scheduledActivityCount}</div>
                                <div>Blocking: {this.review.blockingActivityCount}</div>
                              </div>
                              <div class="elsa-mt-4 elsa-grid elsa-grid-cols-2 elsa-gap-6">
                                <div>
                                  <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-700 elsa-uppercase">Checkpoints</div>
                                  {(this.review.checkpoints || []).slice(0, 8).map(x => (
                                    <div class="elsa-mt-1 elsa-text-xs elsa-text-gray-600">
                                      {this.formatDate(x.lastSeenAt)} - {x.status} - {x.activityType || '-'} / {x.activityId}
                                      {!!x.recoveredByType && (
                                        <span class="elsa-text-green-700"> - recovered by {x.recoveredByName || x.recoveredByType} ({x.recoveredByType})</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <div>
                                  <div class="elsa-text-xs elsa-font-semibold elsa-text-gray-700 elsa-uppercase">Execution log</div>
                                  {(this.review.executionLogs || []).slice(0, 8).map(x => (
                                    <div class="elsa-mt-1 elsa-text-xs elsa-text-gray-600">
                                      {this.formatDate(x.timestamp)} - {x.eventName || '-'} - {x.activityType || '-'} / {x.activityId}
                                      {!!x.message && <div class="elsa-ml-4 elsa-text-red-700 elsa-whitespace-pre-wrap">{x.message}</div>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  ]
                );
              })}
              </tbody>
            </table>
            <elsa-pager page={this.currentPage} pageSize={this.currentPageSize} totalCount={this.page.totalCount} history={this.history} onPaged={this.onPaged} culture={this.culture}/>
          </div>
        </div>
      </div>
    );
  }
}

Tunnel.injectProps(ElsaStudioStaleCheckpointsList, ['serverUrl', 'culture', 'basePath']);
injectHistory(ElsaStudioStaleCheckpointsList);
