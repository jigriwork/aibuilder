# AI Game Builder Audit Report

## Scope
- Frontend: `src/App.jsx`, `src/pages/Landing.jsx`, `src/pages/Builder.jsx`, runtime files in `src/runtime/*`, storage helpers in `src/lib/*`
- Server: `server/index.js`

---

## 1) System Map (as implemented)

```text
Browser (React)
  ├─ App route state + history pushState (/ or /p/:projectId)
  │   ├─ Landing (prompt + template + create/open project)
  │   └─ Builder (project-scoped prompt/spec/chat/history + stream run loop)
  ├─ localStorage
  │   ├─ jigrify_projects (all projects)
  │   ├─ jigrify_active_project_id (per-user active project map)
  │   ├─ per-project message/spec caches
  │   └─ BYOK keys (openai/gemini)
  └─ HTTP
      ├─ POST /api/generate (key test + non-stream)
      ├─ POST /api/agent/stream (SSE over fetch stream; key in body)
      └─ GET /health

Node server (Express)
  ├─ Validates provider/message/key
  ├─ Classifies prompt -> template/mode/modules
  ├─ Agent loop: Plan -> Build -> Verify -> Repair -> Ready
  ├─ Emits SSE events (status/phase_update/chat/spec/spec_update/build_error)
  └─ Session cache (in-memory) by sessionId/projectId
```

---

## 2) User Flow Audit (exact flow + files/state)

### a) Open Landing
- Entry: `src/main.jsx` renders `<App />`
- `src/App.jsx`
  - route parser: `parseRoute(pathname)` detects `/p/:projectId` vs `/`
  - reads user/projects from `src/lib/projects.js`
  - renders `<Landing ... />` when route is landing
- State read/write:
  - Reads `jigrify_user`, `jigrify_projects`, `jigrify_active_project_id`

### b) Select Template
- `src/pages/Landing.jsx`:
  - templates from `getPublicTemplates()`
  - click handler `selectTemplate(template)` sets:
    - `selectedTemplateId`, `modePreference`, `selectedModules`
    - optional prompt autofill from `template.promptHints[0]`
    - writes template UI state into localStorage (`aigb_selected_template_*`)
- Evidence:
  - `selectTemplate` writes template id/mode/modules and updates UI chips

### c) Type prompt + click Next
- `Landing.handleNext(autoRun=true)`:
  - classifies prompt via `classifyPromptToTemplate(...)`
  - calls `onCreateProject({ name, prompt, provider, forceMode, templateId, requiredModules, autoRun })`
- `App.handleCreateProject(...)`:
  - `createProject(...)` persists new project with provider/mode/template/modules/prompt
  - sets active project + build request
  - navigates to `/p/:projectId`

### d) Arrive in Builder
- `src/pages/Builder.jsx` gets `activeProjectId`, `projects`, `initialRequest`
- On project change (`useEffect([project?.id])`):
  - loads project-scoped messages/spec history/cursor
  - restores prompt from project
  - if empty spec history and template exists, seeds a spec using `applyTemplateToSpec(template.defaultSpec, ...)`

### e) Click Run / Run New / Stop
- Run buttons trigger `startBuild({ buildType: "generate" })`
- Stop calls `closeStream()` and sets `runState="stopped"`
- `startBuild`:
  - checks `/health`
  - reads BYOK from localStorage/UI (`getApiKey`)
  - classifies prompt -> template metadata
  - starts streaming request using `fetch(POST /api/agent/stream)`
  - parses SSE chunks and handles events in `processStreamEvent(...)`
  - saves final `spec` via `saveSpecVersion(...)`

### f) Chat “Refine Game” + send
- Chat send button in `Builder.jsx`:
  - sets prompt to chat input
  - calls `startBuild({ messageValue: nextMessage, buildType: "refine" })`
- In `startBuild`, mode becomes patch when current spec exists:
  - `const mode = buildType === "refine" && currentSpec ? "patch" : "generate";`

### g) Click Back then create new game
- Back button in Builder calls `onBack` -> `App.navigateTo("landing")`
- New Project from Landing always calls `createProject(...)` (new projectId)
- App routes to `/p/:newProjectId`, isolating state by project

---

## 3) Project + Memory Audit

### Current storage model
- Projects are local-only in browser localStorage:
  - `src/lib/projects.js`: `PROJECTS_KEY = "jigrify_projects"`
  - active map: `ACTIVE_PROJECT_KEY = "jigrify_active_project_id"`
- Server sessions/spec versions are in-memory only:
  - `server/index.js`: `const SESSION_CACHE = new Map()`

### Why “Back + new prompt reopened old project” (root cause from initial behavior)
- No URL project route binding before this fix; app used internal `route` state only.
- Active project id stayed global; navigation did not enforce project-specific URL identity.
- Result: builder often reopened last active project context.

### Missing concepts identified (now addressed in P0)
- missing/weak before: route param `/p/:projectId`, strict project identity on navigation
- required: project-scoped prompt/specHistory/chat/template/mode
- session binding: projectId/sessionId should be consistently passed to server

### Minimal architecture for multi-project/shareable URLs
- Keep local project index (`jigrify_projects`) with `id`
- Route canonical state by URL `/p/:projectId`
- Opening existing uses projectId from URL/list; New always creates new id
- Open in new tab works by URL route resolution in `App.parseRoute()`

---

## 4) Template System Audit

### Where templates are defined
- `src/lib/templates.js`:
  - `TEMPLATE_REGISTRY` (cards, mode, defaultSpec, requiredModules)
  - `classifyPromptToTemplate(...)`
  - `applyTemplateToSpec(...)`

### Click behavior
- `Landing.selectTemplate(...)` updates selected template state + UI + localStorage
- Next passes selected template/mode/modules to project creation
- Builder topbar resolves template from `currentSpec.templateId || selectedTemplateId`
- Builder seeds default spec from template if project has no spec history

### Required behavior compliance
- selecting template sets base modules + mode + recommended prompt hint
- template selection affects mode/modules through project and stream payload
- selected template appears in top bar (`Template: ...`, `Mode: ...`, `Modules: ...`)

---

## 5) API Key / BYOK Audit (Critical)

### Storage + usage
- Frontend stores key in localStorage (`jigrify_openai_key`, `jigrify_gemini_key`)
- Builder sends key to server in JSON body for:
  - `POST /api/generate` (key test)
  - `POST /api/agent/stream` (streaming)

### Server receive evidence
- `server/index.js` now logs redacted key suffix only:
  - `redactApiKey(apiKey) => ***last4`
  - logs in `/api/generate/stream` and `/api/agent/stream`

### Earlier “key not used / key test failed” likely reasons
- Previously streaming path used `EventSource` query string with `apiKey` (insecure + brittle)
- EventSource cannot send custom headers; key transport constrained
- Server-side validation rejects missing/short key or non-`sk-` OpenAI key

### Endpoint confirmation
- `/api/generate`: POST JSON (non-stream)
- `/api/generate/stream`: POST SSE
- `/api/agent/stream`: POST SSE (Builder uses this)

### Secure BYOK decision implemented
- **Option A implemented**: fetch() streaming over POST with ReadableStream
- No apiKey in URL anymore for active Builder flow

---

## 6) “Brain” / Agent Loop Audit

### What schema/runtime supports today
- Schema prompt enforces GameSpec v1 with:
  - physics scene objects: ground/box/sphere/ramp
  - player movement/jump, camera follow/orbit
  - basic rules (reachArea, fallBelow, countdown)
  - board2d section with players/dice
- Runtime evidence:
  - `SceneFromSpec.jsx`: only ground/box/sphere/ramp
  - `PlayerController.jsx`: keyboard movement + jump
  - `RuleSystem.jsx`: win reachArea, lose fallBelow, countdown timer
  - `Board2DView.jsx`: simplified Ludo-like token movement model

### Why Ludo/Cricket can look wrong
- Cricket module is explicitly unavailable:
  - `MODULE_AVAILABILITY["runtime.sports.cricket"] = false`
  - classifier falls back to sports prototype
- No advanced sports mechanics runtime (bat swing timing, wickets, innings)
- Board runtime is simplified; not full Ludo ruleset/features

### Capability matrix
- **Possible now**: simple 3D obstacle/runner/platformer/driving/shooter-like MVPs, simplified board games
- **Not possible yet**: true cricket sim, full multiplayer, GTA/open-world scale, advanced combat/AI systems

### MVP scope recommendation (future phase)
- 2D board: complete Ludo + Snake rules/state UX
- 3D physics: runner/platformer/stack/obstacle polished loops
- Cricket MVP: add dedicated runtime module for bat/ball timing + scoring + wickets

---

## 7) Builder UX Audit (no redesign implemented here)

Current complexity sources:
- many panels/tabs with overlapping concepts (history/projects/settings/plan/logs)
- primary path split across topbar run + middle run new + chat send
- iterative flow visibility is present but noisy (status, plan, logs, timeline)

Suggested simplification for later redesign:
- Left: steps + project files/spec/history
- Center: preview (single primary visual target)
- Right: always-visible chat + explicit “apply changes” control

---

## 8) Root Causes & Severity

### P0
1. Project identity/routing not URL-bound -> wrong project reopen risk
2. Streaming BYOK insecure transport risk if key in querystring
3. Template click not consistently influencing initial builder spec/runtime state
4. Stream disconnect handling created duplication/retry ambiguity

### P1
5. Capability mismatch (prompt asks > runtime supports) not always obvious to user
6. Builder interaction model too fragmented

### P2
7. legacy duplicated storage keys (`aigb_*` + `jigrify_*`) need cleanup migration pass

---

## 9) Sequence Diagrams

### Generate (current)
```text
Landing -> App.handleCreateProject -> createProject(localStorage)
App -> route /p/:projectId -> Builder mounts project state
Builder.startBuild(generate)
  -> POST /api/agent/stream { provider, apiKey, projectId, userPrompt, templateId, requiredModules }
Server:
  validate -> classify -> plan -> build -> verify -> (repair*) -> ready
  stream events: phase_update/chat/spec_update/spec
Builder:
  process events -> update UI/chat/timeline
  on spec -> saveSpecVersion -> persist project specHistory/messages
```

### Patch/Refine (current)
```text
Builder chat send -> startBuild(refine)
Builder computes mode=patch when currentSpec exists
Builder -> POST /api/agent/stream with currentSpec
Server runs plan/build/verify/repair against currentSpec
Server emits updated spec
Builder saves new spec version (append history cursor)
```

---

## 10) P0 Fix Plan (phased) and status

### Phase 1 (implemented)
- Project system hardening
  - route `/p/:projectId`
  - project-scoped prompt/specHistory/chat/template/mode persistence
  - New Project creates fresh projectId and navigates directly

### Phase 2 (implemented)
- Secure streaming BYOK
  - replaced EventSource query transport with POST fetch stream
  - server stream endpoints accept POST body
  - redacted key suffix logging only

### Phase 3 (implemented)
- Template end-to-end behavior
  - Landing selection -> project template/mode/modules
  - Builder seeds template default spec when empty
  - topbar reflects selected/resolved template + modules

### Phase 4 (implemented)
- Stream resilience
  - retry with exponential backoff
  - reconnect status/error messaging
  - dedupe logic to avoid repeated chat/status/template events on retry

---

## Appendix: Key code evidence snippets

### Route + project URL identity
`src/App.jsx`
```jsx
function parseRoute(pathname) {
  const match = cleanPath.match(/^\/p\/([^/]+)$/);
  if (match) return { name: "builder", projectId: decodeURIComponent(match[1]) };
  return { name: "landing", projectId: "" };
}

function pathForRoute(routeName, projectId = "") {
  if (routeName === "builder" && projectId) return `/p/${encodeURIComponent(projectId)}`;
  return "/";
}
```

### Per-project persistence model
`src/lib/projects.js`
```js
const PROJECTS_KEY = "jigrify_projects";
const ACTIVE_PROJECT_KEY = "jigrify_active_project_id";

const project = {
  id: createId("project"),
  userId,
  name: name.trim() || "Untitled",
  prompt: String(prompt || "").trim(),
  provider,
  forceMode,
  templateId,
  requiredModules,
  messages: [],
  specHistory: [],
  specCursor: -1,
};
```

### Template click and selection handoff
`src/pages/Landing.jsx`
```jsx
const selectTemplate = (template) => {
  setSelectedTemplateId(template.id);
  setModePreference(template.mode);
  setSelectedModules(Array.isArray(template.requiredModules) ? template.requiredModules : []);
  localStorage.setItem(TEMPLATE_ID_KEY, template.id);
};
```

### Builder seeding template spec
`src/pages/Builder.jsx`
```jsx
if (loadedHistory.length === 0 && project.templateId) {
  const template = getTemplateById(project.templateId);
  const seeded = applyTemplateToSpec(template.defaultSpec, { template, templateId: template.id, ... });
  loadedHistory = [seeded];
}
```

### Secure streaming BYOK (POST body, no URL key)
`src/pages/Builder.jsx`
```jsx
const response = await fetch(AGENT_STREAM_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider, apiKey: key, projectId, sessionId, userPrompt, templateId, requiredModules, currentSpec }),
});
```

### Server receives key in body + redacted log
`server/index.js`
```js
function redactApiKey(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) return "none";
  return `***${value.slice(-4)}`;
}

app.post("/api/agent/stream", async (req, res) => {
  const payload = getAgentRequestPayload(req.body);
  const { provider, apiKey, ... } = payload;
  console.info(`[agent/stream] provider=${provider} ... key=${redactApiKey(apiKey)}`);
});
```

### Runtime capability limits (why cricket/ludo degrade)
`src/lib/templates.js`
```js
const MODULE_AVAILABILITY = {
  "runtime.sports.cricket": false,
};
```

`src/runtime/SceneFromSpec.jsx`
```jsx
if (object.type === "ground") ...
if (object.type === "box") ...
if (object.type === "sphere") ...
if (object.type === "ramp") ...
```

`src/runtime/RuleSystem.jsx`
```jsx
// supported rule checks
fallBelow, reachArea, countdown timer
```
