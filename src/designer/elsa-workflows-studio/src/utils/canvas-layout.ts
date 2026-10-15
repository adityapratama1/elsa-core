import {WorkflowModel} from '../models';

export function inspectCanvas(model: WorkflowModel) {
  const ids = new Set<string>();
  const issues: string[] = [];
  const activities = (model?.activities || []).filter(a => {
    if (!a.activityId || ids.has(a.activityId)) { issues.push(`Missing or duplicate activity ID: ${String(a.activityId || '(empty)').slice(0,80)}`); return false; }
    ids.add(a.activityId); return true;
  });
  const connections = (model?.connections || []).filter(c => {
    if (!ids.has(c.sourceId) || !ids.has(c.targetId)) { issues.push(`Connection endpoint unavailable in this view: ${String(c.sourceId).slice(0,80)} → ${String(c.targetId).slice(0,80)}`); return false; }
    return true;
  });
  const targets = new Set(connections.map(c => c.targetId));
  const roots = activities.filter(a => !targets.has(a.activityId));
  // Distinguish the path from StartProcess; this does not change runtime entry selection.
  const starts = roots.filter(a => a.type === 'StartProcess');
  const entryRoots = starts.length ? starts : roots;
  const reachable = new Set(entryRoots.map(a => a.activityId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of connections) if (reachable.has(c.sourceId) && !reachable.has(c.targetId)) {
      reachable.add(c.targetId); changed = true;
    }
  }
  const detached = starts.length ? activities.filter(a => !reachable.has(a.activityId)) : [];
  return {activities, connections, roots, entryRoots, detached, issues};
}

export function escapeGraphText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Presentation only: several outcomes reaching the same activity share one route.
export function groupCanvasConnections(connections: WorkflowModel['connections']) {
  const routes = new Map<string, {sourceId:string;targetId:string;outcomes:string[]}>();
  for (const connection of connections || []) {
    const key = JSON.stringify([connection.sourceId, connection.targetId]);
    let route = routes.get(key);
    if (!route) {
      route = {sourceId:connection.sourceId, targetId:connection.targetId, outcomes:[]};
      routes.set(key, route);
    }
    const outcome = String(connection.outcome ?? '');
    if (!route.outcomes.includes(outcome)) route.outcomes.push(outcome);
  }
  return Array.from(routes.values());
}

export function orthogonalRoute(points: {x:number;y:number}[], vertical = true, grid = 30) {
  const result: {x:number;y:number}[] = [];
  const add = (point: {x:number;y:number}) => {
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    result.push({...point});
    while (result.length >= 3) {
      const [a,b,c] = result.slice(-3);
      if ((a.x === b.x && b.x === c.x && (b.y-a.y)*(c.y-b.y) >= 0) ||
          (a.y === b.y && b.y === c.y && (b.x-a.x)*(c.x-b.x) >= 0)) result.splice(result.length - 2,1);
      else break;
    }
  };
  const unit = Number.isFinite(grid) && grid > 0 ? grid : 30;
  for (const point of points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    const last = result[result.length - 1];
    if (last && last.x !== point.x && last.y !== point.y) {
      const start = vertical ? last.y : last.x, end = vertical ? point.y : point.x;
      const midpoint = Math.max(Math.min(start,end),Math.min(Math.max(start,end),Math.round((start+end)/2/unit)*unit));
      if (vertical) { add({x:last.x,y:midpoint}); add({x:point.x,y:midpoint}); }
      else { add({x:midpoint,y:last.y}); add({x:midpoint,y:point.y}); }
    }
    add(point);
  }
  return result;
}

// D3 curve interface: exclusively moveTo/lineTo, never a Bezier or diagonal.
export function orthogonalCurve(vertical = true) {
  return (context: any) => {
    let points: {x:number;y:number}[] = [];
    return {areaStart() {}, areaEnd() {}, lineStart() { points = []; },
      point(x:number,y:number) { points.push({x,y}); },
      lineEnd() { orthogonalRoute(points,vertical).forEach((point,index) => index === 0 ? context.moveTo(point.x,point.y) : context.lineTo(point.x,point.y)); }};
  };
}

export function fitCanvas(bounds: {x:number;y:number;width:number;height:number}, width:number, height:number) {
  if (![bounds.x,bounds.y,bounds.width,bounds.height,width,height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const scale = Math.max(.1, Math.min(1, (width - 64) / Math.max(1,bounds.width), (height - 100) / Math.max(1,bounds.height)));
  return {scale, x: width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: 58 + (height - 100) / 2 - (bounds.y + bounds.height / 2) * scale};
}
