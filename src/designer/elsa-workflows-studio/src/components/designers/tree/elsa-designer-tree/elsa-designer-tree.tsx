import {Component, Event, EventEmitter, h, Host, Method, Prop, State, Watch, Listen} from '@stencil/core';
import {v4 as uuid} from 'uuid';
import {
  addConnection,
  findActivity,
  getChildActivities,
  getInboundConnections,
  getOutboundConnections,
  Map,
  removeActivity,
  removeConnection
} from '../../../../utils/utils';
import {
  ActivityDescriptor,
  ActivityDesignDisplayContext,
  ActivityModel,
  ActivityTraits,
  ConnectionModel,
  EventTypes,
  WorkflowModel,
  WorkflowPersistenceBehavior
} from '../../../../models';
import {eventBus} from '../../../../services';
import * as d3 from 'd3';
import dagreD3 from 'dagre-d3';
import state from '../../../../utils/store';
import {ActivityIcon} from '../../../icons/activity-icon';
import {ActivityContextMenuState, LayoutDirection, WorkflowDesignerMode} from "./models";
import {escapeGraphText, fitCanvas, inspectCanvas, groupCanvasConnections, orthogonalCurve} from '../../../../utils/canvas-layout';

@Component({
  tag: 'elsa-designer-tree',
  styleUrls: ['elsa-designer-tree.css'],
  assetsDirs: ['assets'],
  shadow: false,
})
export class ElsaWorkflowDesigner {
  @Prop() model: WorkflowModel = {
    activities: [],
    connections: [],
    persistenceBehavior: WorkflowPersistenceBehavior.WorkflowBurst
  };
  @Prop() selectedActivityIds: Array<string> = [];
  @Prop() activityContextMenuButton?: (activity: ActivityModel) => string;
  @Prop() activityBorderColor?: (activity: ActivityModel) => string;
  @Prop() activityContextMenu?: ActivityContextMenuState;
  @Prop() connectionContextMenu?: ActivityContextMenuState;
  @Prop() activityContextTestMenu?: ActivityContextMenuState;
  @Prop() mode: WorkflowDesignerMode = WorkflowDesignerMode.Edit;
  @Prop() layoutDirection: LayoutDirection = LayoutDirection.TopBottom;
  @Prop({attribute: 'enable-multiple-connections'}) enableMultipleConnectionsFromSingleSource: boolean;
  @Event({
    eventName: 'workflow-changed',
    bubbles: true,
    composed: true,
    cancelable: true
  }) workflowChanged: EventEmitter<WorkflowModel>;
  @Event() activitySelected: EventEmitter<ActivityModel>;
  @Event() activityDeselected: EventEmitter<ActivityModel>;
  @Event() activityContextMenuButtonClicked: EventEmitter<ActivityContextMenuState>;
  @Event() connectionContextMenuButtonClicked: EventEmitter<ActivityContextMenuState>;
  @Event() activityContextMenuButtonTestClicked: EventEmitter<ActivityContextMenuState>;
  @State() workflowModel: WorkflowModel;
  @State() zoomPercent = 100;
  @State() hasSelection = false;
  @State() layoutIssues: string[] = [];
  @State() viewDirection: LayoutDirection;
  private resizeObserver?: ResizeObserver;
  private renderFrame?: number;
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private modelRevision = 0;
  private connected = false;
  private needsLayout = true;
  private startNodeId = '__elsa_canvas_start__';
  private fitAfterLayout = false;

  @State() activityContextMenuState: ActivityContextMenuState = {
    shown: false,
    x: 0,
    y: 0,
    activity: null,
    selectedActivities: {}
  };

  @State() connectionContextMenuState: ActivityContextMenuState = {
    shown: false,
    x: 0,
    y: 0,
    activity: null,
  };

  @State() activityContextMenuTestState: ActivityContextMenuState = {
    shown: false,
    x: 0,
    y: 0,
    activity: null,
  };

  el: HTMLElement;
  svg: SVGSVGElement;
  inner: SVGGElement;
  svgD3Selected: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  innerD3Selected: d3.Selection<SVGGElement, unknown, null, undefined>;
  zoomParams: { x: number; y: number; scale: number, initialZoom: boolean } = {x: 0, y: 0, scale: 1, initialZoom: true};
  dagreD3Renderer: dagreD3.Render = new dagreD3.render();

  graph: dagreD3.graphlib.Graph = new dagreD3.graphlib.Graph().setGraph({});
  zoom: d3.ZoomBehavior<Element, unknown>;
  parentActivityId?: string;
  parentActivityOutcome?: string;
  addingActivity: boolean = false;
  activityDisplayContexts: Map<ActivityDesignDisplayContext> = null;
  oldActivityDisplayContexts: Map<ActivityDesignDisplayContext> = null;
  selectedActivities: Map<ActivityModel> = {};
  ignoreCopyPasteActivities: boolean = false;

  handleContextMenuChange(state: ActivityContextMenuState) {
    this.ignoreCopyPasteActivities = true;
    this.activityContextMenuState = state;
    this.activityContextMenuButtonClicked.emit(state);
  }

  handleConnectionContextMenuChange(state: ActivityContextMenuState) {
    this.connectionContextMenuState = state;
    this.connectionContextMenuButtonClicked.emit(state);
  }

  handleContextMenuTestChange(state: ActivityContextMenuState) {
    this.ignoreCopyPasteActivities = true;
    this.activityContextMenuTestState = state;
    this.activityContextMenuButtonTestClicked.emit(state);
  }

  @Watch('model')
  handleModelChanged(newValue: WorkflowModel) {
    this.updateWorkflowModel(newValue, false);
  }

  @Watch('selectedActivityIds')
  handleSelectedActivityIdsChanged(newValue: Array<string>) {
    const ids = newValue || [];
    const selectedActivities = this.workflowModel.activities.filter(x => ids.includes(x.activityId));
    const map: Map<ActivityModel> = {};

    for (const activity of selectedActivities)
      map[activity.activityId] = activity;

    this.selectedActivities = map;
    this.updateHighlight();
  }

  @Watch('layoutDirection')
  handleDirectionChanged() { this.viewDirection = this.layoutDirection; this.fitAfterLayout = true; this.safeRender(); }

  @Watch('mode')
  handleModeChanged() { this.safeRender(); }

  @Watch('activityContextMenu')
  handleActivityContextMenuChanged(newValue: ActivityContextMenuState) {
    this.activityContextMenuState = newValue;
  }

  @Watch('connectionContextMenu')
  handleConnectionContextMenuChanged(newValue: ActivityContextMenuState) {
    this.connectionContextMenuState = newValue;
  }

  @Watch('activityContextTestMenu')
  handleActivityContextMenuTestChanged(newValue: ActivityContextMenuState) {
    this.activityContextMenuTestState = newValue;
  }

  // @Listen('keydown', {target: 'window'})
  // async handleKeyDown(event: KeyboardEvent) {
  //   if (this.ignoreCopyPasteActivities)
  //     return;
  //
  //   if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
  //     await this.copyActivitiesToClipboard();
  //   }
  //   if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
  //
  //     await this.pasteActivitiesFromClipboard();
  //   }
  // }

  @Method()
  async removeActivity(activity: ActivityModel) {
    this.removeActivityInternal(activity);
  }

  @Method()
  async removeSelectedActivities() {
    let model = {...this.workflowModel};

    Object.keys(this.selectedActivities).forEach((key) => {
      model = this.removeActivityInternal(this.selectedActivities[key], model);
    });

    this.updateWorkflowModel(model);
  }

  @Method()
  async showActivityEditor(activity: ActivityModel, animate: boolean) {
    await this.showActivityEditorInternal(activity, animate);
  }

  // async copyActivitiesToClipboard() {
  //   await navigator.clipboard.writeText(JSON.stringify(this.selectedActivities));
  //   await eventBus.emit(EventTypes.ClipboardCopied, this);
  // }

  // async pasteActivitiesFromClipboard() {
  //   let copiedActivities: Array<ActivityModel> = [];
  //
  //   await navigator.clipboard.readText().then(data => {
  //     copiedActivities = JSON.parse(data);
  //   });
  //   await this.addActivitiesFromClipboard(copiedActivities)
  // }

  async addActivitiesFromClipboard(copiedActivities: Array<ActivityModel>) {
    let sourceActivityId: string;
    this.parentActivityId = null;
    this.parentActivityOutcome = null;

    for (const key in this.selectedActivities) {
      sourceActivityId = this.selectedActivities[key].activityId;
    }

    if (sourceActivityId != undefined) {
      this.parentActivityId = sourceActivityId;
      this.parentActivityOutcome = this.selectedActivities[sourceActivityId].outcomes[0];
    }

    for (const key in copiedActivities) {
      this.addingActivity = true;
      copiedActivities[key].activityId = uuid();

      await eventBus.emit(EventTypes.UpdateActivity, this, copiedActivities[key]);

      this.parentActivityId = copiedActivities[key].activityId;
      this.parentActivityOutcome = copiedActivities[key].outcomes[0];
    }

    this.selectedActivities = {};
    // Set to null to avoid conflict with on Activity node click event
    this.parentActivityId = null;
    this.parentActivityOutcome = null;
  }

  connectedCallback() {
    this.connected = true;
    if (this.svgD3Selected) {
      this.applyZoom();
      this.resizeObserver?.observe(this.el);
      this.safeRender();
    }
    eventBus.on(EventTypes.ActivityPicked, this.onActivityPicked);
    eventBus.on(EventTypes.UpdateActivity, this.onUpdateActivity);
    //eventBus.on(EventTypes.PasteActivity, this.onPasteActivity);
    // eventBus.on(EventTypes.HideModalDialog, this.onCopyPasteActivityEnabled);
    // eventBus.on(EventTypes.ShowWorkflowSettings, this.onCopyPasteActivityDisabled);
    eventBus.on(EventTypes.WorkflowExecuted, this.onWorkflowExecuted);
  }

  disconnectedCallback() {
    this.connected = false;
    this.modelRevision++;
    this.resizeObserver?.disconnect();
    if (this.renderFrame !== undefined) cancelAnimationFrame(this.renderFrame);
    if (this.selectionTimer !== undefined) clearTimeout(this.selectionTimer);
    this.renderFrame = undefined;
    this.selectionTimer = undefined;
    eventBus.detach(EventTypes.ActivityPicked, this.onActivityPicked);
    eventBus.detach(EventTypes.UpdateActivity, this.onUpdateActivity);
    //eventBus.detach(EventTypes.PasteActivity, this.onPasteActivity);
    // eventBus.detach(EventTypes.HideModalDialog, this.onCopyPasteActivityEnabled);
    // eventBus.detach(EventTypes.ShowWorkflowSettings, this.onCopyPasteActivityDisabled);
    eventBus.detach(EventTypes.WorkflowExecuted, this.onWorkflowExecuted);
    d3.select(this.el).selectAll('.node').on('click', null);
    d3.select(this.el).selectAll('.edgePath').on('contextmenu', null);
    this.svgD3Selected?.on('.zoom', null);
  }

  componentWillLoad() {
    this.workflowModel = this.cleanWorkflowModel(this.model);
    this.viewDirection = this.layoutDirection;
  }

  componentDidLoad() {
    this.svgD3Selected = d3.select(this.svg);
    this.innerD3Selected = d3.select(this.inner);
    this.applyZoom();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.needsLayout) this.safeRender();
    });
    this.resizeObserver.observe(this.el);
    (document as unknown as {fonts?: {ready: Promise<unknown>}}).fonts?.ready.then(() => { if (this.connected) this.safeRender(); });
    this.safeRender();
  }

  safeRender() {
    // Rebuild D3 model if component completed its initial load.
    if (!this.svgD3Selected)
      return;

    this.needsLayout = true;
    if (this.renderFrame !== undefined || !this.connected) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = undefined;
      const rect = this.el.getBoundingClientRect();
      if (!this.connected || !this.activityDisplayContexts || rect.width <= 0 || rect.height <= 0) return;
      this.needsLayout = false;
      this.renderTree();
    });
  }

  async componentWillRender() {
    if (!!this.activityDisplayContexts)
      return;

    const revision = this.modelRevision;
    const activityModels = inspectCanvas(this.workflowModel).activities;
    const displayContexts: Map<ActivityDesignDisplayContext> = {};

    for (const model of activityModels)
      displayContexts[model.activityId] = await this.getActivityDisplayContext(model);

    if (!this.connected) return;
    if (revision !== this.modelRevision) return this.componentWillRender();
    this.activityDisplayContexts = displayContexts;
    this.safeRender();
  }

  async getActivityDisplayContext(activityModel: ActivityModel): Promise<ActivityDesignDisplayContext> {
    const activityDescriptors: Array<ActivityDescriptor> = state.activityDescriptors;
    let descriptor = activityDescriptors.find(x => x.type == activityModel.type);
    let descriptorExists = !!descriptor;
    const oldContextData = (this.oldActivityDisplayContexts && this.oldActivityDisplayContexts[activityModel.activityId]) || {expanded: false};

    if (!descriptorExists)
      descriptor = this.createNotFoundActivityDescriptor(activityModel);

    const description = descriptorExists ? activityModel.description : `Unknown activity type: ${activityModel.type}`;
    const bodyText = description && description.length > 0 ? description : undefined;
    const bodyDisplay = bodyText ? `<p>${escapeGraphText(bodyText)}</p>` : undefined;
    const color = (descriptor.traits & ActivityTraits.Trigger) == ActivityTraits.Trigger ? 'rose' : 'sky';
    const displayName = activityModel.displayName || activityModel.name || descriptor.displayName || activityModel.type;

    const displayContext: ActivityDesignDisplayContext = {
      activityModel: activityModel,
      activityDescriptor: descriptor,
      activityIcon: <ActivityIcon color={color}/>,
      bodyDisplay: bodyDisplay,
      displayName: displayName,
      outcomes: [...(activityModel.outcomes || [])],
      expanded: oldContextData.expanded
    };

    await eventBus.emit(EventTypes.ActivityDesignDisplaying, this, displayContext);
    return displayContext;
  }

  createNotFoundActivityDescriptor(activityModel: ActivityModel): ActivityDescriptor {
    return {
      outcomes: ['Done'],
      inputProperties: [],
      type: `(Not Found) ${activityModel.type}`,
      outputProperties: [],
      displayName: `(Not Found) ${activityModel.displayName || activityModel.name || activityModel.type}`,
      traits: ActivityTraits.Action,
      description: `(Not Found) ${activityModel.description}`,
      category: 'Not Found',
      browsable: false,
      customAttributes: {}
    };
  }

  async showActivityEditorInternal(activity: ActivityModel, animate: boolean) {
    await eventBus.emit(EventTypes.ActivityEditor.Show, this, activity, animate);
  }

  updateWorkflowModel(model: WorkflowModel, emitEvent: boolean = true) {
    this.modelRevision++;
    this.workflowModel = this.cleanWorkflowModel(model);
    this.oldActivityDisplayContexts = this.activityDisplayContexts;
    this.activityDisplayContexts = null;

    if (emitEvent)
      this.workflowChanged.emit(model);
  }

  cleanWorkflowModel(model: WorkflowModel): WorkflowModel {
    // Rendering validation is separate from the saved definition. Never silently
    // delete or rewrite broken edges in the caller's workflow model.
    return {...model, activities: [...(model?.activities || [])], connections: (model?.connections || []).map(c => ({...c}))};
  }

  removeActivityInternal(activity: ActivityModel, model?: WorkflowModel) {
    let workflowModel = model || {...this.workflowModel};
    const incomingConnections = getInboundConnections(workflowModel, activity.activityId);
    const outgoingConnections = getOutboundConnections(workflowModel, activity.activityId);

    // Remove activity (will also remove its connections).
    workflowModel = removeActivity(workflowModel, activity.activityId);

    // For each incoming activity, try to connect it to an outgoing activity based on outcome.
    if (outgoingConnections.length > 0 && incomingConnections.length > 0) {
      for (const incomingConnection of incomingConnections) {
        const incomingActivity = findActivity(workflowModel, incomingConnection.sourceId);
        let outgoingConnection = outgoingConnections.find(x => x.outcome === incomingConnection.outcome);

        // If not matching outcome was found, pick the first one. The user will have to manually reconnect to the desired outcome.
        if (!outgoingConnection)
          outgoingConnection = outgoingConnections[0];

        if (!!outgoingConnection)
          workflowModel = addConnection(workflowModel, {
            sourceId: incomingActivity.activityId,
            targetId: outgoingConnection.targetId,
            outcome: incomingConnection.outcome
          });
      }
    }

    delete this.selectedActivities[activity.activityId];

    if (!model) {
      this.updateWorkflowModel(workflowModel);
    }

    return workflowModel;
  }

  newActivity(activityDescriptor: ActivityDescriptor): ActivityModel {
    const activity: ActivityModel = {
      activityId: uuid(),
      type: activityDescriptor.type,
      outcomes: activityDescriptor.outcomes,
      displayName: activityDescriptor.displayName,
      properties: [],
      propertyStorageProviders: {}
    };

    for (const property of activityDescriptor.inputProperties) {
      activity.properties[property.name] = {
        syntax: '',
        expression: '',
      };
    }

    return activity;
  }

  async addActivity(activity: ActivityModel, sourceActivityId?: string, targetActivityId?: string, outcome?: string) {
    outcome = outcome || 'Done';

    const workflowModel = {...this.workflowModel, activities: [...this.workflowModel.activities, activity]};
    const activityDisplayContext = await this.getActivityDisplayContext(activity);

    if (targetActivityId) {
      const existingConnection = workflowModel.connections.find(x => x.targetId == targetActivityId && x.outcome == outcome);

      if (existingConnection) {
        workflowModel.connections = workflowModel.connections.filter(x => x != existingConnection);

        const replacementConnection = {
          ...existingConnection,
          sourceId: activity.activityId,
        };

        workflowModel.connections.push(replacementConnection);
      } else {
        workflowModel.connections.push({sourceId: activity.activityId, targetId: targetActivityId, outcome: outcome});
      }
    }

    if (sourceActivityId != null) {
      const existingConnection = workflowModel.connections.find(x => x.sourceId == sourceActivityId && x.outcome == outcome);

      if (existingConnection != null) {
        // Remove the existing connection
        workflowModel.connections = workflowModel.connections.filter(x => x != existingConnection);

        // Create a new outbound connection between the source and the added activity.
        const newOutboundConnection: ConnectionModel = {
          sourceId: existingConnection.sourceId,
          targetId: activity.activityId,
          outcome: existingConnection.outcome
        };

        workflowModel.connections.push(newOutboundConnection);

        // Create a new outbound activity between the added activity and the target of the source activity.
        const connection: ConnectionModel = {
          sourceId: activity.activityId,
          targetId: existingConnection.targetId,
          outcome: activityDisplayContext.outcomes[0]
        };

        workflowModel.connections.push(connection);
      } else {
        const connection: ConnectionModel = {
          sourceId: sourceActivityId,
          targetId: activity.activityId,
          outcome: outcome
        };
        workflowModel.connections.push(connection);
      }
    }

    this.updateWorkflowModel(workflowModel);
    this.parentActivityId = null;
    this.parentActivityOutcome = null;
  }

  getRootActivities(): Array<ActivityModel> {
    return inspectCanvas(this.workflowModel).roots;
  }

  addConnection(sourceActivityId: string, targetActivityId: string, outcome: string) {
    const workflowModel = {...this.workflowModel};
    const newConnection: ConnectionModel = {sourceId: sourceActivityId, targetId: targetActivityId, outcome: outcome};
    let connections = workflowModel.connections;

    if (!this.enableMultipleConnectionsFromSingleSource)
      connections = [...workflowModel.connections.filter(x => !(x.sourceId === sourceActivityId && x.outcome === outcome))];

    workflowModel.connections = [...connections, newConnection];
    this.updateWorkflowModel(workflowModel);
    this.parentActivityId = null;
    this.parentActivityOutcome = null;
  }

  updateActivity(activity: ActivityModel) {
    let workflowModel = {...this.workflowModel};
    const activities = [...workflowModel.activities];
    const index = activities.findIndex(x => x.activityId === activity.activityId);
    activities[index] = activity;
    this.updateWorkflowModel({...workflowModel, activities: activities});
  }

  async showActivityPicker() {
    await eventBus.emit(EventTypes.ShowActivityPicker);
  }

  removeConnection(sourceId: string, outcome: string) {
    let workflowModel = {...this.workflowModel};
    workflowModel = removeConnection(workflowModel, sourceId, outcome);
    this.updateWorkflowModel(workflowModel);
  }

  applyZoom() {
    this.zoom = d3.zoom().scaleExtent([.1, 3]).on('zoom', event => {
      const {transform} = event;
      this.innerD3Selected.attr('transform', transform);
      const canvas = this.el.querySelector('.workflow-canvas') as HTMLElement;
      if (canvas) {
        canvas.style.backgroundSize = `${30 * transform.k}px ${30 * transform.k}px`;
        canvas.style.backgroundPosition = `${transform.x}px ${transform.y}px`;
      }
      this.zoomParams = {
        x: transform.x,
        y: transform.y,
        scale: transform.k,
        initialZoom: this.zoomParams.initialZoom,
      };
      const percent = Math.round(transform.k * 100);
      if (percent !== this.zoomPercent) this.zoomPercent = percent;
    });
    this.svgD3Selected.call(this.zoom);
  }

  applyInitialZoom() {
    const start = this.graph.node(this.startNodeId) as any;
    const viewport = this.canvasViewport();
    if (start && viewport.width > 0) {
      const direction = this.getLayoutDirection();
      const x = direction === 'LR' ? 90 : direction === 'RL' ? viewport.width - 90 : viewport.width / 2;
      const y = direction === 'LR' || direction === 'RL' ? viewport.height / 2 : direction === 'BT' ? viewport.height - 90 : 90;
      this.svgD3Selected.call(this.zoom.transform, d3.zoomIdentity.translate(x - start.x, y - start.y));
    }
    this.zoomParams.initialZoom = false;
  }

  private canvasViewport() {
    const rect = this.svg.getBoundingClientRect();
    let width = rect.width;
    const viewer = this.el.closest('elsa-workflow-instance-viewer-screen');
    const panel = viewer?.querySelector('elsa-workflow-instance-journal .elsa-shadow-xl')?.getBoundingClientRect();
    if (panel && panel.width > 0 && panel.left > rect.left && panel.left < rect.right) width = panel.left - rect.left - 12;
    return {width: Math.max(1,width), height: rect.height};
  }

  private fitGraph = () => {
    if (!this.inner || !this.zoom) return;
    const viewport = this.canvasViewport();
    const fit = fitCanvas(this.inner.getBBox(), viewport.width, viewport.height);
    if (fit) this.svgD3Selected.call(this.zoom.transform, d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.scale));
  };

  private focusSelected = () => {
    const id = Object.keys(this.selectedActivities)[0];
    const node = id && this.graph.node(id) as any;
    if (!node || !this.zoom) return;
    const viewport = this.canvasViewport();
    const scale = Math.max(.8, Math.min(1.5, this.zoomParams.scale));
    this.svgD3Selected.call(this.zoom.transform, d3.zoomIdentity.translate(viewport.width / 2 - node.x * scale, viewport.height / 2 - node.y * scale).scale(scale));
  };

  private updateHighlight() {
    if (!this.svgD3Selected) return;
    const root = d3.select(this.el);
    root.selectAll('.node.activity').classed('graph-selected', (id: any) => !!this.selectedActivities[id]);
    const selected = Object.keys(this.selectedActivities).length > 0;
    if (this.hasSelection !== selected) this.hasSelection = selected;
  }

  setEntities() {
    this.graph = new dagreD3.graphlib.Graph({multigraph: true}).setGraph({ranksep: 68, nodesep: 48, edgesep: 24, marginx: 24, marginy: 24});
    (this.graph.graph() as any).rankdir = this.getLayoutDirection();
    const canvas = inspectCanvas(this.workflowModel);
    const issues = [...canvas.issues];
    const rootActivities = canvas.entryRoots;
    if (canvas.detached.length) issues.push(`${canvas.detached.length} activities have no path from StartProcess. Detached nodes are shown separately; explicit starts/triggers may still execute them.`);
    const editable = this.mode === WorkflowDesignerMode.Edit;
    this.startNodeId = '__elsa_canvas_start__';
    while (canvas.activities.some(a => a.activityId === this.startNodeId)) this.startNodeId += '_';

    // Start node.
    this.graph.setNode(this.startNodeId, {
      shape: 'rect',
      label: this.mode == WorkflowDesignerMode.Edit
        ? `<button class="elsa-px-6 elsa-py-3 elsa-border elsa-border-transparent elsa-text-base elsa-leading-6 elsa-font-medium elsa-rounded-md elsa-text-white elsa-bg-green-600 hover:elsa-bg-green-500 focus:elsa-outline-none focus:elsa-border-green-700 focus:elsa-shadow-outline-green active:elsa-bg-green-700 elsa-transition elsa-ease-in-out elsa-duration-150">Start</button>`
        : `<button class="elsa-px-6 elsa-py-3 elsa-border elsa-border-transparent elsa-text-base elsa-leading-6 elsa-font-medium elsa-rounded-md elsa-text-white elsa-bg-green-600 focus:elsa-outline-none elsa-cursor-default">Start</button>`,
      rx: 5,
      ry: 5,
      labelType: 'html',
      class: 'start',
    });

    // Connections between Start and root activities.
    rootActivities.forEach(activity => {
      if (!editable) {
        this.graph.setEdge(this.startNodeId, activity.activityId, {arrowhead: 'normal'});
        return;
      }
      this.graph.setEdge(this.startNodeId, `${activity.activityId}/start`, {
        arrowhead: 'undirected',
      });
      this.graph.setNode(`${activity.activityId}/start`, {
        shape: 'rect',
        activity,
        label: this.renderOutcomeButton(),
        labelType: 'html',
        class: 'add'
      });
      this.graph.setEdge(`${activity.activityId}/start`, activity.activityId, {arrowhead: 'undirected'});
    });

    // Connections between activities and their outcomes.
    const activityDisplayContexts = this.activityDisplayContexts || {};

    canvas.activities.forEach(activity => {

      const options = this.createActivityOptions(activity);
      if (canvas.detached.some(a => a.activityId === activity.activityId)) {
        options.label = `<div style="font-size:11px;color:#92400e;background:#fffbeb;padding:4px 8px;border:1px dashed #d97706;border-radius:4px">No path from StartProcess</div>${options.label}`;
      }
      this.graph.setNode(activity.activityId, options);
      const displayContext = activityDisplayContexts[activity.activityId] || undefined;
      const outcomes = !!displayContext ? displayContext.outcomes : activity.outcomes || [];
      if (!editable) return;
      outcomes.forEach(outcome => {
        this.graph.setNode(`${activity.activityId}/${outcome}`, {
          shape: 'rect',
          outcome,
          activity,
          label: this.renderOutcomeButton(),
          labelType: 'html',
          class: 'add'
        });
        this.graph.setEdge(activity.activityId, `${activity.activityId}/${outcome}`, {
          label: `<p class="elsa-outcome elsa-mb-4 elsa-relative elsa-z-10 elsa-px-2.5 elsa-py-0.5 elsa-rounded-full elsa-text-xs elsa-font-medium elsa-leading-4 elsa-bg-gray-100 elsa-text-gray-800 elsa-capitalize elsa-cursor-default">${escapeGraphText(outcome)}</p>`,
          labelpos: 'c',
          labelType: 'html',
          arrowhead: 'undirected',
        });
      });
    });

    if (!editable) groupCanvasConnections(canvas.connections).forEach(({sourceId,targetId,outcomes}, index) => {
      this.graph.setEdge(sourceId, targetId, {arrowhead:'normal', labelType:'html',
        label: `<span class="graph-outcomes">${outcomes.map(outcome => `<span class="graph-outcome">${escapeGraphText(outcome)}</span>`).join('')}</span>`}, `connection-${index}`);
    });
    canvas.connections.forEach(({sourceId, targetId, outcome}) => {
      if (!editable) return;
      const sourceName = `${sourceId}/${outcome}`;

      if (!this.graph.hasNode(sourceName)) {
        issues.push('Connection outcome is missing from its source activity');
        return;
      }

      this.graph.setEdge(sourceName, targetId, {arrowhead: 'undirected'});
    });
    const curve = orthogonalCurve(['TB','BT'].includes(this.getLayoutDirection()));
    this.graph.edges().forEach(edge => { (this.graph.edge(edge) as any).curve = curve; });
    if (JSON.stringify(issues) !== JSON.stringify(this.layoutIssues)) this.layoutIssues = issues;
  }

  onActivityPicked = async args => {
    if (this.mode !== WorkflowDesignerMode.Edit) return;
    const activityDescriptor = args as ActivityDescriptor;
    const activityModel = this.newActivity(activityDescriptor);
    this.addingActivity = true;
    await this.showActivityEditorInternal(activityModel, false);
  };

  onUpdateActivity = args => {
    if (this.mode !== WorkflowDesignerMode.Edit) return;
    const activityModel = args as ActivityModel;

    if (this.addingActivity) {
      console.debug(`adding activity with ID ${activityModel.activityId}`)
      const connectFromRoot = !this.parentActivityOutcome || this.parentActivityOutcome == '';
      const sourceId = connectFromRoot ? null : this.parentActivityId;
      const targetId = connectFromRoot ? this.parentActivityId : null;
      this.addActivity(activityModel, sourceId, targetId, this.parentActivityOutcome);
      this.addingActivity = false;
    } else {
      console.debug(`updating activity with ID ${activityModel.activityId}`)
      this.updateActivity(activityModel);
    }
  };

  // onPasteActivity = async args => {
  //   const activityModel = args as ActivityModel;
  //
  //   this.selectedActivities = {};
  //   activityModel.outcomes[0] = this.parentActivityOutcome;
  //   this.selectedActivities[activityModel.activityId] = activityModel;
  //   await this.pasteActivitiesFromClipboard();
  // };
  //
  // onCopyPasteActivityEnabled = () => {
  //   this.ignoreCopyPasteActivities = false
  // }
  //
  // onCopyPasteActivityDisabled = () => {
  //   this.ignoreCopyPasteActivities = true
  // }

  onWorkflowExecuted = () => {
    if (this.mode === WorkflowDesignerMode.Instance || this.mode === WorkflowDesignerMode.Blueprint) return;
    const firstNode = d3.select(this.el).select('.node.activity');

    const node = this.graph.node(firstNode.data() as any) as any;
    if (!node?.activity) return;
    const activity = node.activity;
    const activityId = activity.activityId;

    this.selectedActivities[activityId] = activity;
    this.activitySelected.emit(activity);
  }

  renderNodes() {
    const transform = d3.zoomTransform(this.svg);
    const root = d3.select(this.el);
    // Dagre HTML labels use getBoundingClientRect. Measure at scale 1 without
    // changing D3's internal zoom state, then restore the exact user viewport.
    this.innerD3Selected.attr('transform', null);
    try {
      this.dagreD3Renderer(this.innerD3Selected as any, this.graph as any);
      // Fractional HTML measurements must not clip the last letter or tag row.
      this.innerD3Selected.selectAll('.edgeLabel foreignObject').each(function() {
        const label = this as SVGForeignObjectElement;
        label.setAttribute('width',String(Math.ceil(label.width.baseVal.value) + 8));
        label.setAttribute('height',String(Math.ceil(label.height.baseVal.value) + 6));
        label.style.overflow = 'visible';
      });
    }
    finally { this.innerD3Selected.attr('transform', transform.toString()); }

    if (this.zoomParams.initialZoom === true) {
      this.applyInitialZoom();
    }

    if (this.mode == WorkflowDesignerMode.Edit) {
      root.selectAll('.node.add').each((n: any) => {
        const node = this.graph.node(n) as any;

        d3.select(node.elem)
          .on('click', async e => {
            e.preventDefault();
            root.selectAll('.node.add svg').classed('elsa-text-green-400', false).classed('elsa-text-gray-400', true).classed('hover:elsa-text-blue-500', true);
            this.parentActivityId = node.activity.activityId;
            this.parentActivityOutcome = node.outcome;

            if (e.shiftKey) {
              d3.select(node.elem).select('svg').classed('elsa-text-green-400', true).classed('elsa-text-gray-400', false).classed('hover:elsa-text-blue-500', false);
              return;
            }

            if (this.mode !== WorkflowDesignerMode.Test) await this.showActivityPicker();
          })
          .on("mouseover", e => {
            if (e.shiftKey)
              d3.select(node.elem).select('svg').classed('elsa-text-green-400', true).classed('hover:elsa-text-blue-500', false);
          })
          .on("mouseout", e => {
            d3.select(node.elem).select('svg').classed('elsa-text-green-400', false).classed('hover:elsa-text-blue-500', true);
          })
          .on('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            this.parentActivityId = node.activity.activityId;
            this.parentActivityOutcome = node.outcome;
            this.handleConnectionContextMenuChange({x: e.clientX, y: e.clientY, shown: true, activity: node.activity});
          });
      });

      root.selectAll('.node.start').each((n: any) => {
        const node = this.graph.node(n) as any;
        d3.select(node.elem).on('click', async e => {
          if (this.mode == WorkflowDesignerMode.Test) return;

          await this.showActivityPicker();
        });
      });

      root.selectAll('.edgePath').append(appendClickableEl).attr('class', 'label-clickable');

      function appendClickableEl() {
        const originalD = this.querySelector('.path').getAttribute('d');
        const newPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        newPath.setAttribute('d', originalD);
        return this.appendChild(newPath);
      }

      root.selectAll('.edgePath').each((edg: any) => {
        const edge = this.graph.edge(edg) as any;
        d3.select(edge.elem).on('contextmenu', e => {
          e.preventDefault();
          const from = edg.v.split('/');
          const to = edg.w.split('/');
          const fromActivityId = from[0];
          const outcome = from[1] || to[1];
          this.removeConnection(fromActivityId, outcome);
        });
      });
    }

    root.selectAll('.node.activity').each((n: any) => {
      const node = this.graph.node(n) as any;
      const activity = node.activity;
      const activityId = activity.activityId;

      d3.select(node.elem)
        .select('.expand').on('click', e => {
          const activityContext = this.activityDisplayContexts[activityId];

          if (activityContext) {
            activityContext.expanded = !activityContext.expanded;
          }
          e.stopPropagation();
          this.safeRender();
      });

      d3.select(node.elem).on('click', e => {
        // If a parent activity was selected to connect to:
        if (this.mode == WorkflowDesignerMode.Edit && this.parentActivityId && this.parentActivityOutcome) {
          this.addConnection(this.parentActivityId, activityId, this.parentActivityOutcome);
        } else {
          // When clicking an activity with shift:
          if (e.shiftKey) {
            if (!!this.selectedActivities[activityId])
            {
              delete this.selectedActivities[activityId];
              this.activityDeselected.emit(activity);
            }
            else {
              this.selectedActivities[activityId] = activity;
              this.activitySelected.emit(activity);
            }
          }
          // When clicking an activity:
          else {
            if (!!this.selectedActivities[activityId])
            {
              delete this.selectedActivities[activityId];
              this.activityDeselected.emit(activity);
            }
            else {
              for (const key in this.selectedActivities) {
                this.activityDeselected.emit(this.selectedActivities[key]);
              }
              this.selectedActivities = {};
              this.selectedActivities[activityId] = activity;
              this.activitySelected.emit(activity);
            }
          }

          // Delay the rerender of the tree to permit the double click action to be captured
          if (this.selectionTimer !== undefined) clearTimeout(this.selectionTimer);
          this.selectionTimer = setTimeout(() => {
            if (this.connected) this.updateHighlight();
          }, 90);
        }
      }).on('dblclick', async e => {
        e.stopPropagation();
        if (this.mode == WorkflowDesignerMode.Edit) {
          await this.showActivityEditor(activity, true);
          if (!this.selectedActivities[activityId]) {
            for (const key in this.selectedActivities) {
              this.activityDeselected.emit(this.selectedActivities[key]);
            }
            this.selectedActivities = {};
            this.selectedActivities[activityId] = activity;
            this.activitySelected.emit(activity);
            this.updateHighlight();
          }
        }
      });

      if (this.mode == WorkflowDesignerMode.Edit || this.mode == WorkflowDesignerMode.Instance) {
        d3.select(node.elem)
          .select('.context-menu-button-container button')
          .on('click', evt => {
            evt.stopPropagation();
            this.handleContextMenuChange({
              x: evt.clientX,
              y: evt.clientY,
              shown: true,
              activity: node.activity,
              selectedActivities: this.selectedActivities
            });
          });
      }
      else if (this.mode == WorkflowDesignerMode.Test) {
        d3.select(node.elem)
          .select('.context-menu-button-container button')
          .on('click', evt => {
            evt.stopPropagation();
            this.handleContextMenuTestChange({x: evt.clientX, y: evt.clientY, shown: true, activity: node.activity});
          });
      }
    });
  }

  renderTree() {
    this.setEntities();
    this.renderNodes();
    this.updateHighlight();
    if (this.fitAfterLayout) { this.fitAfterLayout = false; this.fitGraph(); }
  }

  createActivityOptions(activity: ActivityModel) {
    return {
      shape: 'rect',
      label: this.renderActivity(activity),
      rx: 5,
      ry: 5,
      labelType: 'html',
      class: 'activity',
      activity,
    };
  }

  createOutcomeActivityOptions() {
    return {shape: 'circle', label: this.renderOutcomeButton(), labelType: 'html', class: 'add', width: 32, height: 32};
  }

  renderOutcomeButton() {
    const cssClass = this.mode == WorkflowDesignerMode.Edit ? 'hover:elsa-text-blue-500 elsa-cursor-pointer' : 'elsa-cursor-default';
    return `<svg class="elsa-h-8 elsa-w-8 elsa-text-gray-400 ${cssClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>`;
  }

  renderActivity(activity: ActivityModel) {
    const activityDisplayContexts = this.activityDisplayContexts || {};
    const displayContext = activityDisplayContexts[activity.activityId] || undefined;
    const activityContextMenuButton = !!this.activityContextMenuButton ? this.activityContextMenuButton(activity) : '';
    const activityBorderColor = !!this.activityBorderColor ? this.activityBorderColor(activity) : 'gray';
    const selectedColor = !!this.activityBorderColor ? activityBorderColor : 'blue';
    const cssClass = `elsa-border-${activityBorderColor}-200 hover:elsa-border-${selectedColor}-600`;
    const displayName = displayContext != undefined ? displayContext.displayName : activity.displayName;
    const typeName = activity.type;
    const expanded = displayContext && displayContext.expanded;

    return `<div id="${escapeGraphText(`activity-${activity.activityId}`)}"
    class="activity elsa-border-2 elsa-border-solid elsa-rounded elsa-bg-white elsa-text-left elsa-text-black elsa-text-lg elsa-select-none elsa-max-w-md elsa-shadow-sm elsa-relative ${cssClass}">
      <div class="elsa-p-3">
        <div class="elsa-flex elsa-justify-between elsa-space-x-4">
          <div class="elsa-flex-shrink-0">
          ${displayContext?.activityIcon || ''}
          </div>
          <div class="graph-node-caption elsa-flex-1 elsa-font-medium elsa-leading-8 elsa-overflow-hidden">
            <p title="${escapeGraphText(displayName)}" class="elsa-overflow-ellipsis elsa-text-base">${escapeGraphText(displayName)}</p>
            ${typeName !== displayName ? `<p class="elsa-text-gray-400 elsa-text-sm">${escapeGraphText(typeName)}</p>` : ''}
          </div>
          <div class="elsa--mt-2">
            <div class="context-menu-button-container">
              ${activityContextMenuButton}
            </div>
            <button type="button" class="expand elsa-ml-1 elsa-text-gray-400 elsa-rounded-full elsa-bg-transparent hover:elsa-text-gray-500 focus:elsa-outline-none focus:elsa-text-gray-500 focus:elsa-bg-gray-100 elsa-transition elsa-ease-in-out elsa-duration-150">
              ${!expanded ? `<svg xmlns="http://www.w3.org/2000/svg" class="elsa-w-6 elsa-h-6 elsa-text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>` : ''}
              ${expanded ? `<svg xmlns="http://www.w3.org/2000/svg" class="elsa-h-6 elsa-w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
              </svg>` : ''}
            </button>
          </div>
        </div>
        ${this.renderActivityBody(displayContext)}
        </div>
      </div>`;
  }

  renderActivityBody(displayContext: ActivityDesignDisplayContext) {
    if (displayContext && displayContext.expanded) {
      return (
        `<div class="elsa-border-t elsa-border-t-solid">
          <div class="elsa-p-4 elsa-text-gray-400 elsa-text-sm">
            <div class="elsa-mb-2">${!!displayContext?.bodyDisplay ? displayContext.bodyDisplay : ''}</div>
            <div>
              <span class="elsa-inline-flex elsa-items-center elsa-px-2.5 elsa-py-0.5 elsa-rounded-full elsa-text-xs elsa-font-medium elsa-bg-gray-100 elsa-text-gray-500">
                <svg class="-elsa-ml-0.5 elsa-mr-1.5 elsa-h-2 elsa-w-2 elsa-text-gray-400" fill="currentColor" viewBox="0 0 8 8">
                  <circle cx="4" cy="4" r="3" />
                </svg>
                ${escapeGraphText(displayContext?.activityModel.activityId)}
              </span>
            </div>
          </div>
      </div>`
      );
    }

    return '';
  }

  render() {
    return (
      <Host class="workflow-canvas elsa-flex-1 elsa-flex" ref={el => (this.el = el)}>
        <div class="graph-toolbar" role="toolbar" aria-label="Workflow canvas controls">
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => this.svgD3Selected?.call(this.zoom.scaleBy, .8)}>−</button>
          <span class="graph-zoom" aria-label="Zoom level">{this.zoomPercent}%</span>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => this.svgD3Selected?.call(this.zoom.scaleBy, 1.25)}>+</button>
          <button type="button" onClick={this.fitGraph}>Fit graph</button>
          <button type="button" disabled={!this.hasSelection} onClick={this.focusSelected}>Focus selected</button>
          <button type="button" onClick={() => this.applyInitialZoom()}>Reset view</button>
          <select aria-label="Graph direction" onChange={e => {this.viewDirection = (e.target as HTMLSelectElement).value as LayoutDirection; this.fitAfterLayout = true; this.safeRender();}}>
            <option value={LayoutDirection.TopBottom} selected={this.viewDirection === LayoutDirection.TopBottom}>Top → bottom</option>
            <option value={LayoutDirection.LeftRight} selected={this.viewDirection === LayoutDirection.LeftRight}>Left → right</option>
          </select>
        </div>
        {this.layoutIssues.length > 0 && <details class="graph-warning"><summary>{this.layoutIssues.length} graph issue(s) · definition unchanged</summary>
          <p>Unavailable entries are excluded from this drawing only. Inspect the definition before editing or saving.</p>
          <ul>{this.layoutIssues.slice(0,10).map(issue => <li>{issue}</li>)}</ul></details>}
        {this.mode == WorkflowDesignerMode.Test ?
          <div>
            <div id="left" style={{border:`4px solid orange`, position:`fixed`, height: `calc(100vh - 64px)`, width:`4px`, top:`64`, bottom:`0`, left:`0`}}/>
            <div id="right" style={{border:`4px solid orange`, position:`fixed`, height: `calc(100vh - 64px)`, width:`4px`, top:`64`, bottom:`0`, right:`0`}}/>
            <div id="top" style={{border:`4px solid orange`, position:`fixed`, height:`4px`, left:`0`, right:`0`, top:`30`}}/>
            <div id="bottom" style={{border:`4px solid orange`, position:`fixed`, height:`4px`, left:`0`, right:`0`, bottom:`0`}}/>
          </div>
          :
          undefined
        }
        <svg ref={(el: SVGSVGElement) => (this.svg = el)} id="svg" style={{
          height: 'calc(100vh - 64px)',
          width: '100%',
          pointerEvents: this.activityContextMenuState.shown ? 'none' : ''
        }}>
          <g ref={(el: SVGGElement) => (this.inner = el)}/>
        </svg>
      </Host>
    );
  }

  private getLayoutDirection = () => {
    switch (this.viewDirection || this.layoutDirection) {
      case LayoutDirection.BottomTop:
        return 'BT';
      case LayoutDirection.LeftRight:
        return 'LR';
      case LayoutDirection.RightLeft:
        return 'RL';
      case LayoutDirection.TopBottom:
      default:
        return 'TB';
    }
  }
}
