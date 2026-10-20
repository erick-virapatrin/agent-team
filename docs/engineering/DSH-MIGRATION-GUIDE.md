# DSH Migration Guide for the Agent Team Plugin

Operational guide coming out of the **0.1.1-rc.2 → 0.2.0-rc.2** migration (PR #12, branch
`fix/dsh-020-compat`, SHA `64518c4`). Every command in this guide was executed during
this migration; the *Expected result* column is the actual observation.
Cost analysis: [DSH-MIGRATION-RETRO.md](DSH-MIGRATION-RETRO.md).
Reusable brief: [DSH-MIGRATION-TASKBRIEF.md](DSH-MIGRATION-TASKBRIEF.md).
Version watch: [DSH-UPGRADE-WATCH.md](DSH-UPGRADE-WATCH.md).

Shipped tools (dependency-free, read-only):
- [tooling/dsh-api-surface.mjs](tooling/dsh-api-surface.mjs) — API surface inventory (imported symbols + injected services).
- [tooling/dsh-session-metrics.mjs](tooling/dsh-session-metrics.mjs) — runtime metrics from session logs.

## 0. Ground rules (costly to learn by heart)

1. **The source of truth is the installed package tree**, never the documentation or memory:
   `$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/*` for the runtime,
   `node_modules/@deepseek-ai/*` for the plugin.
2. **Typecheck is not proof of execution.** Incompatibilities visible only at
   load/runtime (cordis waterfalls, frames, DI callback signatures, DTO fields)
   are detected only by phase 6.
3. **No piped `npm`**: a gate command runs without `| tail`/`| head`, with the cache in
   the workspace: `npm --cache .scratch/npm-cache …`. The sandbox makes the global npm cache and `~/.dsh`
   non-writable.
4. **The plugin gate is semantic**: the runtime checks `semver.satisfies(runtimeVersion, peerRange)`
   for **every** `@deepseek-ai/dsh*` peer with `includePrerelease: true`
   (`@deepseek-ai/dsh-app-boot/lib/index.js`, compatibility evaluation function). A single misaligned peer
   = plugin not loaded.
5. **Test doubles reproduce the installed `.d.ts` signatures** (rule 1 of phase 5).

## 1. Preflight (≈ 10 minutes, fully deterministic)

| # | Command | Expected result |
| --- | --- | --- |
| 1.1 | `node -v && npm -v` | Node ≥ 22 (here 26.11.1), npm ≥ 10 |
| 1.2 | `node -e "console.log(require('@deepseek-ai/dsh/package.json').version)"` (in the global tree) | target runtime version, e.g. `0.2.0-rc.2` |
| 1.3 | `npm view @deepseek-ai/dsh dist-tags --json` | `latest`/`next` → target version confirmed |
| 1.4 | `node -e "console.log(JSON.stringify(require('./package.json').peerDependencies,null,1))"` | list of peers to align (all `@deepseek-ai/dsh*` + `cordis`) |
| 1.5 | `mkdir -p .scratch && npm --cache .scratch/npm-cache ci` | `EXIT=0`; **a failure here = environment problem, not code** |
| 1.6 | `npm run check` | baseline **green on the current version**; if it fails, repair before any migration |
| 1.7 | `ls ~/.dsh/profiles` | write scope outside the workspace → **plan for approvals** |
| 1.8 | `dsh --help` then `dsh plugin --help` | check the **argument shape** (profile as a positional, not `--profile` everywhere) |

Observed traps and their signal:
- `EROFS: read-only file system … npm-cache` → use `--cache .scratch/npm-cache`.
- `option '--profile <name>' argument 'x' is invalid. select a profile only once` → the profile name
  goes as a **positional argument**: `dsh <profile> …`, `dsh plugin --profile <profile> …`
  (only `dsh plugin` accepts `--profile`).
- `Current DSH file policy: workspace-write` → any write inside `~/.dsh` requires approval.

## 2. Gap analysis before the first modified line

### 2.1 API surface probe (1 tool call, 66 symbols / 14 services measured in 2 s)

```bash
node -e "/* extract the plugin imports */"   # see §2.1 below
node docs/engineering/tooling/dsh-api-surface.mjs \
  --imports .scratch/plugin-imports.json \
  --services .scratch/plugin-services.json \
  --base node_modules/@deepseek-ai \
  --target "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai"
```

Extracting the two input files (to paste into `.scratch/`):

```bash
# plugin-imports.json: { "package[:subpath]": ["Symbol", …] }
node -e "const fs=require('fs'),p=require('path');const files=[];
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);
if(e.isDirectory())w(f);else if(/\.tsx?$/.test(e.name))files.push(f)}})('src');
const m=new Map();for(const f of files){const t=fs.readFileSync(f,'utf8');
for(const x of t.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)){
if(!x[2].startsWith('@deepseek-ai/'))continue;const k=x[2].split('/').slice(0,2).join('/');
const s=m.get(k)??new Set();m.set(k,s);for(const r of x[1].split(',')){const n=r.trim().split(/\s+as\s+/)[0];if(n)s.add(n)}}}
fs.writeFileSync('.scratch/plugin-imports.json',JSON.stringify(Object.fromEntries([...m].sort().map(([k,v])=>[k,[...v]])),null,1))"

# plugin-services.json: list of injected services (src/index.ts)
node -e "const fs=require('fs');const s=fs.readFileSync('src/index.ts','utf8');
const m=s.match(/export const inject = \[([\s\S]*?)\]/);
fs.writeFileSync('.scratch/plugin-services.json',JSON.stringify([...(m?m[1]:'').matchAll(/'([^']+)'/g)].map(x=>x[1]),null,1))"
```

Output: `summary.missingInTarget` = symbols removed/renamed, `summary.signatureChanged`
= declarations whose text changed, `servicesMissingInTarget` = services that disappeared.
**This is the migration work list.**

### 2.2 Compilation error census (ground truth of the port)

```bash
npx tsc --noEmit > .scratch/tc-baseline.txt 2>&1; echo "EXIT=$?"
grep -c "error TS" .scratch/tc-baseline.txt
grep -o "error TS[0-9]*" .scratch/tc-baseline.txt | sort | uniq -c | sort -rn
```

Migrate `package.json` (peers + deps + `@types/node` aligned with the runtime) **before** the first
`npx tsc` of the port: that is what produced the exact list (116 errors) in a single call.

### 2.3 Targeted reads of the installed `.d.ts` (do them once, not ten times)

```bash
grep -rn "@deprecated" node_modules/@deepseek-ai/*/lib/types/*.d.ts | head -30
grep -rn "\.on('" node_modules/@deepseek-ai/*/lib/index.js | head -40     # cordis events available
grep -rn "@waterfall" node_modules/@deepseek-ai/*/lib/types/*.d.ts | head -30
```

Files to read in full (the ones most impacted by observation):
`dsh-session/lib/types/index.d.ts` (event reading, `session/event`),
`dsh-session-persistence/lib/types/index.d.ts` (`open`/`read`/`close`, `header`),
`dsh-agent/lib/types/index.d.ts` (`AgentSetup`, frames, `acquireScope`),
`dsh-llm/lib/types/index.d.ts` (`assistant/message.stream` + `usage`),
`dsh-client-ui-primitives` (UI exports), `dsh-workspace/lib/types/index.d.ts` (ids, `directoryPicker`).

## 3. Migration order (validated by the commit split)

| Step | Content | Why this order |
| --- | --- | --- |
| 1 | `package.json` + `package-lock.json` (peers, deps, `@types/node`, `tsconfig` if `using declare` is required) | pins the real surface; typecheck becomes readable |
| 2 | `src/domain/` (shared types with no DSH API) | creates the new-behavior constants (e.g. message source) without breaking the rest |
| 3 | `src/runtime/` (session, projector, bridge, builders) | the layer touching the most removed APIs |
| 4 | `src/service/` + `src/transport/` (contracts, endpoints) | exposes the new behavior to the client |
| 5 | `src/client/` (components, slots, icons) | 53 icon renames here: scripted batch processing, not manual |
| 6 | `tests/` (mocks matching the installed signatures) | reveals the false positives of steps 3-5 |
| 7 | runtime verification (phase 6) | the only proof of execution |

Loop per layer: `npx tsc --noEmit` **not piped**, file by file; a single error site
at a time. Observed: 22 runs for the runtime layer, 14 minutes.

## 4. Mapping tables 0.1.1-rc.2 → 0.2.0-rc.2 (verified at compile time)

| 0.1.1 | 0.2.0 | Note |
| --- | --- | --- |
| `apiProxy` / `MuxFrame` (`dsh-cordis-client-api-proxy`) | cordis waterfall `approval/request`, `user-questions/request` | package gone; bridge to rewrite |
| `session.events` | `session.snapshotEvents(from?, toExclusive?)` | **`@deprecated`**: migration target = `session/event` + `open/read` |
| `sessionPersistence.inspect(id)` / `.list()` | `open(id,'read')` → `read(0)` → `close()` ; `.header` | asynchronous read handle |
| `Context.agent` (1 arg) | `AgentSetup = (agentCtx, agent)` | DI 2 arguments; 1-argument mocks break at runtime |
| `standingKeyFor(...)` | `acquireScope(id?)` + `Symbol.asyncDispose` | requires `"lib": ["…, ESNext.Disposable"]` |
| `tool-result` block / message source | `ToolResultMessage`, `MessageSource` (`kind: 'agent-team'`) | typed source on the `dsh-llm` side |
| `assistant/chunk` | durable record `assistant/message.stream` + `usage`, cordis frames `agent/assistant-stream` | streaming = proven at runtime, not at typecheck |
| `workspaces.pickDirectory()` | `directoryPicker.capability()` → plugin `workspace.pick` | host server capability |
| `Icon<X>` icons | `Icon<X>Regular` / `Icon<X>OutlineRegular` | 53 sites handled in batches |
| `MarkdownText` | same + required `labels` prop | label constants centralized |
| `Modal` headless | no `closeLabel` (type union) | do not pass `closeLabel` in headless mode |
| raw user text | `projectUserText` | user message rendering |

## 5. Testing rules (the most expensive part of the migration)

1. **Every test double reproduces the installed signature.** Observed consequence: 5 cascading test
   failures (`deliveryState: 'queued'`) because the fake sessions had no
   `snapshotEvents`, and a runtime `TypeError` (`assistant-builder-runtime.ts:406`) because the
   `setup` mock accepted 1 argument.
2. Test the **new** behavior, not the old one: frame persistence, projection from
   persisted events, mid-turn stop, relayed message source.
3. An incomplete mock must be **rejected by typecheck**: type the doubles with the real
   interface (`satisfies Agent`, `satisfies Session`) instead of hand-writing them as object literals.
4. Gates: `npm run check` = `guard:architecture` + `typecheck` + `vitest run` + `build`.
   Observed reference: 20 files / 114 tests / bundles `lib/index.js` 184 kB, `lib/client.js` 323 kB.

## 6. Final verification — proof of execution (mandatory)

None of these points is covered by `npm run check`. Observed time for this phase: **2h20**
(to compress with the test profile script of §6.6).

### 6.1 Plugin loading (compatibility gate)

```bash
dsh agent-team-compat --from-default-profile web          # creates the test profile (writes to ~/.dsh)
dsh plugin --profile agent-team-compat add link:/ABS/PATH/agent-team
dsh agent-team-compat --dump-config | grep -n -A 4 "agent-team"
```
Expected result: the plugin appears (`- id: agent-team`). A missing entry or a version warning
= **peer not satisfied** → fix the `peerDependencies`, not the code.

### 6.2 Client startup and registration

```bash
dsh agent-team-compat --no-open --port 3099 > .scratch/server.log 2>&1 &
grep -n "agent-team" .scratch/server.log | head
```
Expected result: the server starts and registers the "Agent Team" navigation entry.

### 6.3 Real API probes (team, messages, resume)

```bash
curl -s -X POST http://127.0.0.1:3099/agent-team/api \
  -H 'content-type: application/json' \
  -d '{"requestId":"p1","method":"catalog","payload":{}}'
```
Exact body shape: `{ requestId, method, payload }`. Methods taking an identifier
expect `{ id }` — **not** `{ teamId }` (observed error: `Unrecognized key(s) in object: 'teamId'`).
DTO fields to read in `src/transport/contracts.ts` before writing a probe:
the work object is `workbench.conversations`, **not** `workbench.members`.

Probes to run, with observed result:
- `team.create` (2 members, model presets) then `team.start` → `activeMembers: 2`,
  `deliveryState: 'delivered'`.
- `assistant.list` → assistants with `sessionIds`; check `lastActiveAt` **after** a message.
- server restart → projection of **persisted** sessions (cold resume); the transcript
  rebuilds from the log, not from in-memory state.
- inter-agent messages: the relayed user node appears only **after** the turn is consumed
  (`agent/inbox/spliced` not projected) — behavior to verify, not to assume.
- permissions: profile preset; a `minimal` preset can trigger
  `PRESET_PROMPT_INCOMPATIBLE: Preset 'minimal' replaced Agent Team prompt sections`.

### 6.4 Streaming without a model key (local stub)

Add an OpenAI-compatible route in `~/.dsh/profiles/agent-team-compat/cordis.yml`
(`providerKind: openai-compatible`, `apiKey: PROBE_LLM_KEY`, `baseUrl` on a local port), start
an SSE stub (mission script: `.scratch/stub-llm.mjs`, response in 4 chunks, `stream: true`),
create an assistant on that route, send a message, watch `GET /api/sessions/<id>`:

Observed and expected result: live node growing character by character (5 → 49 characters,
150 ms polling), then replacement by the durable node; in the persisted log, `text-chunks`
~250 ms apart; `contextUsage` = 137 input / 1 output / 40 cache-read, window 32000.

Without a stub, the first real turn produced a `notice` node (`no API key for provider route …`):
**check provider availability during preflight**.

### 6.5 Session log inspection (durable proof)

```bash
node -e "const z=require('zlib'),fs=require('fs');
console.log(z.zstdDecompressSync(fs.readFileSync(process.env.HOME+
'/.dsh/sessions/<slug-cwd>/<session>/session.v4.jsonl.zstd')).toString('utf8'))" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const l of s.trim().split('\n')){
const e=JSON.parse(l);if(e.type==='assistant/message')console.log(e.data.usage)}})"
```
A `request/header` + `usage` event = a real model turn consumed (137 input tokens in the
probe). `toolWallTime`/gaps: [tooling/dsh-session-metrics.mjs](tooling/dsh-session-metrics.mjs).

### 6.6 Test profile script (to automate)

The 5 commands of §6.1-6.2 + the stub of §6.4 + the 4 probes of §6.3 must fit in one
idempotent script `docs/engineering/tooling/dsh-plugin-runtime-check.sh` (create the profile if missing,
`plugin add link:`, `--dump-config` as an assertion, background server on a free port,
probes with assertions, clean shutdown, profile removal on exit). Expected gain: the
integration phase of 2h20 with 11 approvals must fit in < 45 min with < 4 approvals.

## 7. Rollback

1. `git checkout main && git branch -D fix/dsh-020-compat` (unmerged port branch);
   the reference repository (`upstream`) is never touched.
2. `git checkout <sha-0.1.4> -- package.json package-lock.json && npm --cache .scratch/npm-cache ci`
   to make the 0.1.1 tree functional again.
3. Test profile: do not reuse a profile that loaded the 0.2.0 plugin; recreate it
   (`rm -rf ~/.dsh/profiles/<name>` then `--from-default-profile`) to rule out any
   `cordis.patch.yml` artifact.
4. The plugin is a `link:`: no server state to purge; the sessions created by the probes
   stay in `~/.dsh/sessions/` (name them `probe-*` to spot them).

## 8. Observed typical errors and the fix

| Error signature | Cause | Fix |
| --- | --- | --- |
| `option '--profile <name>' argument '…' is invalid. select a profile only once` | CLI shape | profile as a positional (`dsh <profile> …`) |
| `EROFS: read-only file system, open '…/profiles/<p>/cordis.yml'` | sandbox | explicit approval for `~/.dsh/profiles/<p>` |
| `npm ERR` + read-only cache | sandbox | `--cache .scratch/npm-cache`, **no pipe** |
| `Unrecognized key(s) in object: 'teamId'` + `expected: 'string', path: [Array]` | DTO | send `{ id }`; re-read `src/transport/contracts.ts` |
| `TypeError: Cannot read properties of undefined (reading 'map')` | DTO read from memory | `workbench.conversations` |
| `Cannot read properties of undefined (reading 'id')` on a persisted handle | 0.2.0 API | `handle.header.id` (no longer `snapshot.header`) |
| `this.ctx.<service>.acquireScope is not a function` | 0.2.0 API | `acquireScope(id?)` + `Symbol.asyncDispose` |
| `ctx.slots` / `ctx.workspaces`: `TS2339 Property '…' does not exist` | augmentations | import `Context` from `@deepseek-ai/dsh-client-connection` |
| `MessageText: TS2304 Cannot find name` | missing import | import from `dsh-llm` |
| failing tests `deliveryState: 'queued'` | session mock without `snapshotEvents` | mocks matching the `.d.ts` |
| `TypeError … reading 'session'` (`assistant-builder-runtime.ts`) | `setup` mocked with 1 argument | `setup(agentCtx, agent)` in the doubles |
| `expect(object).toContain` with `streaming: undefined` | vitest semantics | test for the absent key (`not.toHaveProperty`) |
| `Modal` rejecting `closeLabel` | headless union | omit `closeLabel` in headless mode |
| `PRESET_PROMPT_INCOMPATIBLE: Preset 'minimal' replaced Agent Team prompt sections` | incompatible preset | Agent Team-compatible preset (see plugin docs) |
