# DSH migration retrospective 0.1.1-rc.2 → 0.2.0-rc.2 (AGTEAM-COMPAT-001)

Development performance analysis: what cost time, what was avoidable, what must be
automated. No metric is estimated: every line states its source, and
`UNKNOWN` / `NOT_AVAILABLE` is written when the data does not exist.

## 1. Measured scope and sources

| Item | Value | Source |
| --- | --- | --- |
| Repo / branch | `agent-team`, `fix/dsh-020-compat` base `main` @ `3dfc9c2` | `git log` |
| Final verified SHA | `64518c4e266ea20d5d1f75d00d6e1ed880ab9782` | `git rev-parse HEAD`, PR #12 `headRefOid` |
| PR | [limuyang2/agent-team#12](https://github.com/limuyang2/agent-team/pull/12), state `OPEN`, `mergedAt: null` | `gh pr view` |
| Main DSH session | `~/.dsh/sessions/--home-erick-project-agent-team--/session-9ee564b5-ba55-42aa-93f7-353b241ca72e/session.v4.jsonl.zstd` (2 115 events) | session log |
| Subagents (4) | `617d9c91-…`, `3b7ccd22-…`, `3e872dda-…`, `9e57429c-…` (same directories) | session logs |
| Probe sessions (excluded) | `agent-team:…` (team members created by the probe) | `ls ~/.dsh/sessions/…` |
| Git | commits, `git diff --numstat 3dfc9c2..HEAD` | repo |
| npm registry | `@deepseek-ai/dsh` versions + dates; GitHub `gh api compare` | readings taken on 2026-10-20 |

Method: the `.scratch/collect-metrics.mjs` script (shipped copy in
[tooling/dsh-session-metrics.mjs](tooling/dsh-session-metrics.mjs)), which decompresses the v4
logs (`zstdDecompressSync`) and aggregates per time window. Window analyzed:
`2026-10-20T05:40Z → 10:50Z`, the repo's session directory, excluding `agent-team~` sessions.

## 2. Metrics table

| Indicator | Measurement | Source / note |
| --- | --- | --- |
| **Total mission duration** | **5h04m10s** (05:46:12 → 10:50:22 UTC) | `user/message` prompts seq 8 and 2099 |
| of which human pause ("pause the devs" → "you can continue") | 2h02m57s (06:27:19 → 08:30:19) | seq 809 / 840 |
| **Active time** (mission − pause) | **3h01m13s** | computation |
| **Time to first fix** (first edit in `src/`) | **40m42s** (06:26:54) | collector milestone |
| **Time to first green build on the target** (first green `npm run check` after the 0.2.0 install) | **2h57m22s** wall; **57m15s** active (08:43:34) | `npm run check` signature |
| **Time to final validation** (PR created) | **4h54m25s** wall; ~2h51m active (10:40:37) | `gh pr create` |
| **LLM call count** | **591** (main session 379 + 4 subagents 212) | `assistant/message` events |
| **Input tokens** | **1 957 144** | sum of `data.usage.inputTokens` |
| **Output tokens** | **295 137** | sum of `data.usage.outputTokens` |
| **Cache tokens (read)** | **44 963 491** | sum of `usage.cacheReadTokens` |
| Cache tokens (write) | 0 | same |
| **API cost** | **UNKNOWN** — the harness logs no prices; the token totals above are the computation basis | absence verified in the events |
| **Tool calls (total 726)** | bash **603**, read **72**, write **14**, job_output **11**, edit **8**, job_kill **5**, send_message **4**, subagent **4**, todo_write **1**, job_list **1**, grep **1**, ask_user_question **1**, get_goal **1** | `tool/call` events |
| Reported failed tool calls | **3**: sandbox write refused (1), edit without a prior read (1), read outside the sandbox tree (1) | `tool/result.isError` |
| Non-zero bash exits | **12** out of 603 (10 of them with no error marker = grep/rg with no match) | `[exit code: N]` marker |
| **bash command composition** | **piped 345 (57%)**, chained 166 (28%), plain 92 (15%) | `bashCommandHygiene` |
| Compilation attempts | `npx tsc --noEmit` **23**, `npm run check` **5**, `npm install` **4**, `npm ci` **2** | command signatures |
| Fix cycles (port typecheck loop) | **22 tsc runs** in 14m31s (08:30:42 → 08:43:25) | signature timeline |
| Cumulative tool time | **111m19s**, of which `bash dsh …` **94m32s** (profile creation, `--dump-config`, test server + approval waits), `git push` 5m16s, `ask_user_question` 2m52s | `tool/call → tool/result` deltas |
| Human time / waits > 60 s | **10 intervals**, **233m56s** cumulative (including the 123 min pause) | gap analysis |
| **Human interventions** | **3 user messages** during the mission (pause, resume, model-call authorization) + **11 approval requests** (`~/.dsh` writes, push, PR) + 1 `ask_user_question` | `user/message`, `approval/asked` |
| Repeated file re-reads | **27 re-reads**; top: `team-interaction-bridge.ts` 5, `conversation-projector.ts` 5, `package.json` 4, `team-runtime.ts` 4, `.gitignore` 3, `assistant-builder-runtime.ts` 3, `cordis.patch.yml` 3 | `tool/call` count per target |
| Context compactions | **6** (`compaction/start`) | session log |
| Subagents | 4 sessions, 212 LLM calls, 325 tool calls, 1 005 156 input / 130 847 output / 15 408 549 cache, spans 19–34 min | `perSession` aggregate |
| **Diff size** | 28 files, **+2 444 / −2 595** (lockfile included); excluding the lockfile **27 files, +1 056 / −557** | `git diff --shortstat 3dfc9c2..HEAD` |
| Diff per commit | deps +5 206 lockfile lines · server runtime 13 files +592/−287 · client 8 files +79/−61 · tests 4 files +330/−166 · gitignore 1 file +2 | `git log --shortstat` |
| Most touched source files | `conversation-projector.ts` +180/−70 · `team-interaction-bridge.ts` +148/−130 · `team-runtime.ts` +69/−30 · `agent-team-service.ts` +53/−21 · 2 new modules (+81) | `git diff --numstat` |
| Cost of an investigation subagent | 38–70 LLM calls, 186k–293k input tokens, 19–34 min per investigation slice | `perSession` |

### Limits of these measurements

- The **cost side is not logged**: the harness records tokens, not prices → cost `UNKNOWN`.
- Failures are **structurally invisible**: 85% of bash commands were piped or chained, so the
  exit code observed is the pipeline's last command. The `npm install` failures (read-only
  cache) and the `vitest` ones (5 failing tests) were detected by reading output, not through
  the exit-code channel. The count of 12 non-zero exits is therefore an
  **upper bound on visible failures**, not a tally of real failures.
- "Model active time" vs "tool wait" is approximated: `toolWallTime` = sum of call→result
  deltas (it includes human approval waits), and gaps > 60 s isolate human waiting. LLM
  network time is not instrumented.

## 3. Timeline (UTC, 2026-10-20)

| Time | Event | Cost |
| --- | --- | --- |
| 05:46:12 | mission prompt | — |
| 05:49:58 | first `dsh plugin` command (CLI exploration) | |
| 05:54:55 | first `npm run check` **0.1.1 baseline** (green) | ~9 min |
| 05:55 → 06:23 | API investigation: 4 subagents + `.d.ts` diff | ~28 min, 212 subagent LLM calls |
| 06:23:36 | first `npm install` 0.2.0 (then 3 retries: sandbox npm cache, lockfile) | ~4 min, 4 calls |
| 06:24:32 | first `npx tsc` on 0.2.0 → **type error list = ground truth** (116 errors) | 1 call |
| 06:26:54 | **first fix in `src/`** | TTFP 40m42s |
| 06:27:19 | "pause the devs" → clean stop (notes up to date) | — |
| 08:30:19 | resume | 123 min pause |
| 08:30:42 → 08:43:25 | typecheck loop, 22 iterations (interaction bridge, projector, scopes, client) | 13 min |
| 08:43:34 | **first green `npm run check` on 0.2.0** (guard + typecheck + 114 tests + build) | |
| 08:46:50 | `npm run check` re-verified | |
| 10:18:15 | test profile creation + start (`~/.dsh` writes, 11 approvals) | 94 min of cumulative `bash:dsh` (server runtime included) |
| 10:19 → 10:30 | real API probes: catalog, skills, assistants, 2-member team, `delivered` message, member stop | |
| 10:22 (approx.) | server restart → **session resume** proven on persisted logs | |
| 10:31–10:39 | real round against the local OpenAI stub: live streaming 5→49 characters, `contextUsage` 137/1/40 | |
| 10:32:19 → 10:40:37 | `npm ci` + `npm run check`, 5 commits, push, PR #12 | |

The 2h20 between 08:46 and 10:18 is the integration verification: it is the
longest part of the mission, and the least tooled (see §4.11).

## 4. Self-critique — real difficulties, with diagnosis and cost

Format: problem → why not anticipated → diagnosis → cost → missing information →
prevention → scope.

### 4.1 `apiProxy` / `MuxFrame` removed (interaction bridge)
- **Problem**: the whole approval/questions bridge relied on a package that is gone.
- **Not anticipated**: the prompt listed "check the APIs that actually exist" without
  requiring a machine-readable gap list before any modification.
- **Diagnosis**: searched for the cordis augmentation sites (`declare module '@deepseek-ai/cordis'`)
  in the 0.2.0 tree → the `approval/request` and `user-questions/request` waterfalls.
- **Cost**: one subagent investigation slice (38–70 LLM calls per subagent) + 1 rewritten file (+148/−130).
- **Information that would have sufficed**: the list of cordis events registered by the installed packages
  (`grep -rn "ctx.plugin.*\.on(\|\.on('" node_modules/@deepseek-ai/*/lib/index.js`) — deterministic, ~10 minutes.
- **Prevention**: API surface probe (see §6.2) + event inventory.
- **Scope** **DSH-specific** (the "list the imported symbols then test their presence" mechanism is general).

### 4.2 0.2.0 version gate on peerDependencies
- **Problem**: the load refusal is triggered by `semver.satisfies(runtimeVersion, peer)`
  on **each** `@deepseek-ai/dsh*` peer with `includePrerelease`.
- **Not anticipated**: the rule (all `dsh-*` peers, not just the root package) was not in the prompt.
- **Diagnosis**: reading `dsh-app-boot/lib/index.js` (`evaluatePluginCompatibility`).
- **Cost**: 1 targeted read; **no** failure cycle (the peers were migrated before the first boot).
- **Information that would have sufficed**: the gate function name, in the brief.
- **Prevention**: the `dsh <profile> --dump-config` command as a gate test (fast, no server).
- **Scope** DSH.

### 4.3 Read-only npm cache under sandbox
- **Problem**: `npm install` fails (global cache not writable); 4 invocations, 2 lockfiles.
- **Not anticipated**: the `workspace-write` sandbox was not described in the brief.
- **Diagnosis**: reading the npm output (the **`| tail` pipeline masked the exit code** → failure
  discovered late).
- **Cost**: 4 `npm install` + 2 `npm ci`, ~10 min, 1 lockfile regenerated twice.
- **Information that would have sufficed**: "the global npm cache is read-only, use
  `--cache <workspace>/.scratch/npm-cache`" + "never pipe a gate command".
- **Prevention**: preflight (environment collection script) + bash hygiene rule.
- **Scope** **general** (any sandboxed development).

### 4.4 DSH CLI argument form
- **Problem**: `dsh web --profile X` → `option '--profile <name>' argument 'X' is invalid. select a profile only once`.
- **Diagnosis**: `--help` + positional rewrite `dsh <profile> …`.
- **Cost**: 1 cycle (~2 min).
- **Prevention**: put the exact form in the guide (done, §Guide).
- **Scope** DSH.

### 4.5 Permission escalations (`~/.dsh`)
- **Problem**: 11 approvals to create the profile, add the plugin, `--dump-config`, start the server.
- **Not anticipated**: the brief said "separate test profile" without saying that **any** write under
  `~/.dsh` leaves the sandbox scope.
- **Cost**: 94m32s of tool time attributed to `dsh` commands (server startup + approval
  waits included); 11 human interruptions.
- **Prevention**: declare the paths to pre-approve explicitly in the brief
  (`~/.dsh/profiles/<test>`, `~/.dsh/sessions`) → a single scope approval.
- **Scope** general (planning the write scope).

### 4.6 Green tests despite a runtime incompatibility (the most expensive item)
- **Problem**: 5 service tests were failing in cascade (`deliveryState: 'queued'`, `followup` never called)
  **after** the migration, plus a runtime `TypeError` (`assistant-builder-runtime.ts:406`) in an integration test.
  Cause: the test fakes implemented the 0.1.x shapes (`session.events`, `setup(ctx)` with 1 argument)
  instead of the 0.2.0 shapes (`snapshotEvents()`, `setup(agentCtx, agent)`).
- **Not anticipated**: the instruction "adapt the tests" was generic; nothing required the **test
  doubles** to match the real signatures.
- **Diagnosis**: read the stack (`agent.session.header.cwd` undefined) then compared with the installed `.d.ts`.
- **Cost**: 4 test files rewritten (+330/−166); 2 non-linear diagnosis cycles.
- **Information that would have sufficed**: making the guide require "mocks reproduce the signatures of the
  installed `.d.ts`, never the memory of the old version".
- **Scope** **general** (any interface migration with test doubles).

### 4.7 Streaming without proof of execution
- **Problem**: `assistant/chunk` removed → new mechanism (cordis frames + durable `stream`
  record), **not verifiable by typecheck alone**.
- **Not anticipated**: no "proof of execution" constraint in the brief; the green build was first taken
  as a sufficient signal.
- **Diagnosis**: read the frame types, then a **local OpenAI stub** (`cordis.patch.yml` + `probe-openai`
  route, dummy key) → observed the live nodes going 5 → 49 characters and the persisted `dt` ≈ 250 ms/chunk.
- **Cost**: ~25 min of probing (stub + 3 probe scripts); 1 model round wasted for lack of a key
  (the configured provider had no key).
- **Information that would have sufficed**: "no usable LLM provider in this environment" in the preflight.
- **Prevention**: the test profile + stub are reusable as-is (see the Guide, §Final verification).
- **Scope** DSH + general (the need for a deterministic way to validate streaming).

### 4.8 Plugin HTTP contracts read from memory
- **Problem**: the probe read `workbench.members` while the type is `workbench.conversations`;
  the methods taking an identifier expect `{ id }`, not `{ teamId }`.
- **Not anticipated**: trusting session memory (compacted context).
- **Diagnosis**: 1 `TypeError: Cannot read properties of undefined (reading 'map')` then reading
  `src/transport/contracts.ts:219`.
- **Cost**: 2 probe cycles, ~6 min.
- **Prevention**: rule "re-read the contract before writing a client"; the file is short.
- **Scope** general (re-read the source rather than trusting the context summary).

### 4.9 Invalid internal reference docs
- **Problem**: `.scratch/reference/*` cites `docs/specifications/*`, `contracts/*`, `agents/*`: these
  paths do not exist in this repo → the handoff contracts were unusable.
- **Cost**: 2 full reads of a 33 000 token file (SEQUENTIAL-DELIVERY.md).
- **Prevention**: check that the cited paths exist **before** applying a process, and report it.
- **Scope** general.

### 4.10 `PRESET_PROMPT_INCOMPATIBLE` with the `minimal` preset
- **Problem**: `team.start` refused ("Preset 'minimal' replaced Agent Team prompt sections") → 1 cycle.
- **Cost**: ~2 min. **Prevention**: list of compatible presets in the guide.
- **Scope** DSH + product.

### 4.11 Missing integration tooling: 2h20 for the runtime verification
- **Problem**: the runtime verification (profile, plugin link, boot, probes, streaming) was done
  **by hand**, command by command, with 11 approvals.
- **Cost**: the longest phase of the mission; `bash:dsh` = 94m32s of tool time.
- **Prevention**: an idempotent test-profile script (profile + `link:` + server + health probe),
  and the API surface probe to shrink the investigation phase.
- **Scope** DSH.

### 4.12 Context pressure: 6 compactions, 45 M cache-read tokens
- **Problem**: a 5 h mission in a single session; 45 000 000 cache-read tokens,
  6 compactions, 27 file re-reads (2 of them read 5 times).
- **Cost**: detail losses compensated by re-reads; reliance on the notes file.
- **Prevention**: delegate the investigation to subagents with **short structured output**
  (186k–293k input tokens per subagent) and produce a machine artifact
  (the gap list as JSON) instead of text.
- **Scope** general.

## 5. Work performed that served no purpose

| Work | Proof it was useless |
| --- | --- |
| Full read of `.scratch/reference/SEQUENTIAL-DELIVERY.md` (33k tokens) then the "SOLO" adaptation | handoff documents do not exist in the repo |
| Checking `archiveSession` / the `stopActivity` parameter | no use in the affected code; noted "to watch", never enabled |
| Investigation of `CallId` → `ToolCallId` | the type is never imported by the plugin (the import surface does not contain it) |
| 3rd `npm install` retry after a piped `npm install` | the failure was the cache, not the lockfile |
| Rewriting the probe script (`workbench` fields) | 1 contract re-read would have sufficed |
| Hunting the real model route (`deepseek-official`) then the "no API key" failure | the missing key was checkable in the preflight |

## 6. What was avoidable vs unavoidable

**Avoidable (low prevention cost)**: 4.3 (cache + pipe), 4.4 (CLI form), 4.5 (approval
scope), 4.9 (doc paths), 4.10 (presets), 5 (unverifiable routes/paths),
4.8 (contract re-read), 4.6 (faithful test doubles — authoring rule).

**Unavoidable under the environment constraints**: 4.1 (the bridge had no equivalent:
a rewrite was necessary), 4.2 (the gate semantics are only derivable from the runtime code),
4.7 (0.2.0 streaming is only observable at execution), 4.11 partly (no integration
tooling existed), 4.12 partly (a 5 h mission with no split into sessions),
the 11 approvals (writes outside the workspace under `workspace-write`).

## 7. Five ranked optimizations (gain / cost / risk / measure)

1. **API surface probe (contract probe)** — [tooling/dsh-api-surface.mjs](tooling/dsh-api-surface.mjs).
   *Mechanism*: extract the symbols imported by the plugin + the injected services,
   test presence and declaration hash in the installed tree.
   *Gain*: the complete gap list in 1 tool call (66 symbols, 14 services) against
   the 212 LLM calls of 4 subagents for the investigation phase. Gain **demonstrated** on the
   0.2.0 → 0.2.1-rc.2 probe (0 gap detected, §UPGRADE-WATCH); the gain on the
   0.1 → 0.2 investigation phase is **estimated** (the probe was written afterwards).
   *Cost*: ~150 lines, no dependency. *Risk*: false negatives on semantic
   changes (it does not see behaviors).
   *Measure*: tool call count of the "investigation" phase (target < 40 against 325).
2. **Environment preflight (script)** — DSH version, package versions, peers, Node/npm,
   npm cache accessibility, sandbox write scope, presence of a provider key.
   *Gain*: removes 4 observed failure classes (4.3, 4.5, 4.7-last, 4.10).
   *Cost*: ~60 lines + 5 min of reading output. *Risk*: a checklist to maintain.
   *Measure*: number of environment failures during the mission (0 targeted).
3. **Gate command hygiene rule** — no pipeline on a gate command,
   `set -o pipefail`, `--cache <workspace>/.scratch/npm-cache`, one gate per call.
   *Gain*: failures detected on the first call (345 piped commands = 57% of bash commands).
   *Cost*: zero (convention). *Risk*: longer output to read.
   *Measure*: the collector's `piped` ratio (target < 20%) and the number of non-zero exits ignored.
4. **Test doubles matching the installed signatures** — require that each mock reproduces
   the `.d.ts` (named list in the guide's Testing section).
   *Gain*: removes 4.6 (2 diagnosis cycles, 496 test lines rewritten in cascade).
   *Cost*: zero (authoring rule). *Risk*: more verbose mocks.
   *Measure*: number of test failures caused by a stale mock (0 targeted).
5. **Idempotent test profile + model stub** — profile creation script, `link:`,
   `--dump-config` (gate), server, then team/message/resume/streaming probes.
   *Gain*: shrinks the integration phase (2h20 observed) and makes it repeatable without a key or secret.
   *Cost*: ~120 lines + maintenance of the profile paths. *Risk*: depends on the DSH CLI versions.
   *Measure*: integration phase duration (target < 45 min) and approval count (target < 4).

## 8. Not measurable with the available data

- API cost in currency (no rate is logged) → `UNKNOWN`.
- The exact split between "model thinking time" and "network wait": the log timestamps the
  message events, not the HTTP requests; the step→step delta bounds it only roughly.
- Real number of test failures: masked by the command composition (§2, limits).
- Duration of the 4 parallel subagents: their spans overlap, and the sum (19–34 min each)
  is not additive with wall time.
