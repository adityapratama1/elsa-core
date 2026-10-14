# Journal read model

The existing execution-log API and persisted Elsa events remain unchanged.
The journal projects a bounded, manually refreshed set of raw records into
recorded executions. Executing/Resuming begin a new occurrence for an activity;
Faulted dominates Executed/Resumed within that occurrence. Executed is labelled
Result handled, never Succeeded. No business success is inferred from this event.

Duration is a matched start-to-terminal interval, not an adjacent-event delta.
Fault followed by result handling keeps the fault timestamp as the end. Missing
starts, overlapping starts or partially loaded history suppress authoritative
durations. Old records have no durable occurrence ID; parallel/missing evidence
is displayed as uncertain, not used for recovery authorization.

UI: compact rows, latest/oldest ordering, activity search, fault/waiting filters,
one expanded execution, raw-event accordions, wrapped/bounded JSON, explicit
timezone, retry/empty/partial states. Awaiting result describes persisted
evidence only; it is not a live worker count. The graph selection event contract
is preserved. Loading is 200 events per manual request, at most 1,000 displayed;
page zero is explicitly sent, avoiding the original unbounded default API read.

Run `node --test tests/journal-projection.test.cjs` and
`node node_modules/typescript/bin/tsc --noEmit --skipLibCheck`. Build using the
existing pinned Stencil version (`--config stencil.config.dist.ts`). No workflow
runtime, retry, designer editing, or event-store mutation is added by this UI.

App integration: `export-app-dashboard.ps1 -AppRepositoryPath <UniFi checkout>`
exports the built JS/CSS and canonical parameter-editor adapter to
`App.Web/wwwroot/elsa-dashboard-journal1`. App.Web serves that immutable graph
at `/elsa-studio/2.9.3-dashboard.21-journal1`. Only unchanged fonts/images and
polyfills fall back to the pinned designer package; missing JS is 404/no-store,
never an old module or SPA HTML. The old package aliases remain available.
Runtime and NuGet package versions are unchanged. Normal IIS publish includes
these files even with SkipSpaBuild; a local publish verified this path.

Use `-ReplaceUnpublishedBuild` only while iterating on a not-yet-deployed revision.
After deployment, choose a new asset pathname when rebuilding; do not rely on
query-string cache busting. The raw-log API, permissions and graph-selection
events keep their existing contracts. This journal is inspection-only and does
not provide a recovery/replay action.

## Canvas renderer improvements

The renderer validates a drawing projection without deleting/replacing saved
connections. Missing endpoints and duplicate IDs produce an explicit warning;
invalid items do not become phantom Dagre nodes. Inspection uses directed,
labelled multigraph edges (parallel outcomes preserved), without editor-only
plus nodes. Edit mode retains its add/connection controls.

Selection changes the outline only, not layout. Geometry changes are batched in
one animation frame. There is one managed resize observer, scoped event cleanup,
stale async-context rejection, non-mutating descriptor traits and escaped plain
labels. Dagre HTML measurement temporarily removes the group transform without
changing D3 zoom state; the exact transform is then restored.

Canvas controls: zoom 10–300%, Fit graph (maximum 100%), Focus selected,
Reset view, and TB/LR view direction. Fit/Focus account for the visible instance
journal panel. Direction is presentation only and never emits workflow-changed.
Large graphs may still require pan/focus; Fit is an overview, not a guarantee
that every label can be read at once. No workflow execution or persistence logic
is changed by the canvas controls.

Run `node --test tests/canvas-layout.test.cjs tests/journal-projection.test.cjs`.
Browser QA covers branches/join, missing target, two canvases/disconnect,
selection position stability, original-model preservation and mobile overflow.

## Journal outcomes, clipboard and activity output

The journal starts oldest-first for every newly opened workflow. Outcome tags
come from the execution's recorded Outcomes/outcomes; they are not inferred
from a generic Executed event. Copy JSON copies the complete value, not the
20,000-character display preview, and reports clipboard permission failures.

Activity Output prefers explicit ActivityOutput/activityOutput journal data.
Otherwise it displays the latest workflow activityOutput, or declared output
properties present in activityData (including false, zero and null). Snapshot
output is labelled as latest persisted state, not historical execution output.
No extra API, database query, output hydration or persistence write is added.

Executed/Resumed data and Activity Output use structured field lists by default.
Nested objects are expandable; homogeneous shallow record arrays use a table.
Previews are limited to 30 entries, three nesting levels and 400 characters per
scalar. Raw JSON is collapsed and retains full-value clipboard access. The
generic Result handled label and fault precedence are unchanged.

Canvas edges use axis-aligned routing rather than Bezier curves, retaining
Dagre waypoint corridors and endpoints. Bend channels snap to a 30-unit grid;
grid background scales and pans with the graph. HTML outcome labels are
nowrap, non-shrinking, with a foreignObject measurement allowance to avoid
clipping the final letter or row. Journal controls are 28px and canvas toolbar
controls 26px; accessible focus styling and explicit labels remain intact.
