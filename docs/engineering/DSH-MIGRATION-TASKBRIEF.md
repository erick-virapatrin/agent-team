# DSH migration mission brief (reusable, self-contained)

Optimized version of the AGTEAM-COMPAT-001 brief: **~130 lines vs ~470 for the original**, with
the facts that cost integrated cycles (preflight, CLI argument forms, approval scopes,
faithful mocks, runtime proof). Marker **[U]** = universal, **[0.2]** = specific to 0.1→0.2.

Usage: copy the block below, fill in the 6 input fields. Do not add context that was not
asked for: every extra paragraph of the original brief cost re-reads.

```text
MISSION: migrate the Agent Team plugin from DSH {{VERSION_SOURCE}} to DSH {{VERSION_CIBLE}}.
Repo: {{DEPOT}} (upstream {{REMOTE_UPSTREAM}}, fork push {{REMOTE_FORK}}).
Prohibitions: do NOT touch the harness code; do NOT bump the plugin version;
do NOT refactor; do NOT merge (the PO decides); open PR only.
Deliverable: branch {{BRANCHE}} + PR, base {{BASE_SHA}} (verified SHA, not "main").
Response language: {{LANGUE}}. Identifiers, commands and APIs in exact English.

ENVIRONMENT FACTS (do not rediscover them)
- Installed DSH runtime: {{CHEMIN_RUNTIME_DSH}}; version: {{VERSION_CIBLE}}.
- Sandbox file policy: workspace-write. Writing in ~/.dsh requires an approval:
  group ALL profile writes into a single command, and request a single
  scope approval for ~/.dsh/profiles/{{PROFIL_TEST}}.
- Global npm cache is read-only: ALWAYS `npm --cache .scratch/npm-cache …`.
- No usable LLM provider: the streaming proof goes through the local stub (§7).
- CLI argument form: the profile name is POSITIONAL (`dsh <profile> --dump-config`), only `dsh plugin`
  takes `--profile`. `dsh web --profile X` is invalid.

MANDATORY ORDER (do not reorder)
1. Preflight [U]: `node -v`, runtime version, `npm --cache .scratch/npm-cache ci`,
   `npm run check` (green baseline on the current version). A red gate here = an environment
   problem: fix it before migrating. Never pipe a gate command.
2. Gap analysis [U]: `node docs/engineering/tooling/dsh-api-surface.mjs --imports … --base …
   --target …` → the work list (missing symbols, changed signatures, vanished services).
   Then `npx tsc --noEmit > .scratch/tc.txt 2>&1; grep -c "error TS" .scratch/tc.txt` after
   aligning package.json (peers): the error census IS the port plan.
3. peers [0.2]: ALL `@deepseek-ai/dsh*` + `cordis` aligned with the runtime. The loader gate
   evaluates `semver.satisfies(runtime, peer, {includePrerelease:true})` on EACH peer
   (`dsh-app-boot/lib/index.js`). Proof: `dsh {{PROFIL_TEST}} --dump-config` lists `- id: agent-team`.
4. Layered port [U]: domain → runtime → service/transport → client → tests. One file at a
   time, `npx tsc --noEmit` after each file. Mass rename (icons): substitution script +
   diff review, no per-file edits.
5. Mock rule [0.2]: every test double reproduces the signature of the installed `.d.ts`
   (`snapshotEvents()`, `setup(agentCtx, agent)`, `open/read/close`, `handle.header`). Type the
   doubles with the real interface so the typecheck rejects an incomplete mock.
6. Final gate [U]: `npm run check` (architecture guard + typecheck + tests + build), then a clean `npm ci`
   and a re-run of `npm run check`.
7. Runtime proof [U] — NOT COVERED by the build, mandatory:
   a. test profile `--from-default-profile web` (no competing experimental bundle),
   b. `dsh plugin --profile {{PROFIL_TEST}} add link:{{ABS_PATH}}` + `--dump-config` (load gate),
   c. boot `dsh {{PROFIL_TEST}} --no-open --port {{PORT}}`, client registration in the log,
   d. API probes: body `{requestId, method, payload}`, ids under `{ id }`; read
      `src/transport/contracts.ts` before writing a probe (e.g. `workbench.conversations`),
   e. 2-member team + message + `lastActiveAt`; mid-turn stop; inter-agent messages,
   f. server restart → projection of PERSISTED sessions (cold resume),
   g. streaming via the local OpenAI stub: growing live node then the durable node; non-zero `usage`.
   Use the integration script if it exists; otherwise write it in
   `docs/engineering/tooling/` and reuse it.
8. Deliverable [U]: sliced conventional commits (deps / runtime / client / tests), PR to
   {{REMOTE_UPSTREAM}}: base, head SHA, what migrated (before → after), what is proven at
   runtime, known limits.

TOOL-CALL REDUCTION (target: < 250 tool calls, < 40 for investigation)
- A single API investigation, in parallel, SHORT STRUCTURED output (a list of
  before → after pairs). No design doc writing.
- Do not re-read a file already read: re-read a contract before writing a client, once.
- Do not explore the CLI: `--help` once, then use the forms in this brief.
- Bash: no pipeline on a gate, `&&` max 2 segments, one gate command per call.
- Intermediate artifacts in `.scratch/` (tsc outputs, config dumps, probe responses):
  they avoid re-reading sources and replaying commands.
- Continuous working notes in `.dsh-notes.md` (SHA, decisions, verified facts, what is left):
  this is the defense against compaction, not a deliverable.

STOP CONDITIONS (stop, write up, ask)
- `npm run check` baseline red on the source version → stop, report it.
- A required symbol missing from the target runtime with no identifiable equivalent → stop the layer,
  document the dead end, propose 2 options to the PO.
- Writing outside the workspace and outside ~/.dsh/profiles/{{PROFIL_TEST}} → do not escalate, ask.
- Need for a real model (full turn, cost) → ask for authorization beforehand, not afterwards.
- A gap of more than 2 estimated working days between the plan and progress → deliver a partial
  state with milestones, do not continue in silence.

ACCEPTANCE CRITERIA (all proven by output quoted in the report)
- `npm run check` green, `npm ci` green from a clean tree, branch and base SHA quoted.
- Before → after table for every migrated API, with the source (`.d.ts` path or runtime file).
- Runtime proofs: plugin load, boot, team create + start, `delivered` message,
  cold resume, inter-agent messages, streaming (live + durable), preset permissions.
- Rollback described (commands) and test profile isolated from the production profile.
- No assumption presented as proof: mark VERIFIED / INFERRED / UNKNOWN.

FINAL REPORT (imposed format, no extra prose)
1. Base / head SHA, number of commits, diff size (with and without lockfile).
2. Migrated API table (before → after → source → proof).
3. Runtime proofs (command → observation).
4. Limits, behaviors deliberately not migrated (`@deprecated` accepted), residual risks.
5. What cost time and the prevention (3 lines).
```

## What is universal vs specific to 0.1 → 0.2

| Brief section | Scope |
| --- | --- |
| Preflight, gate hygiene, approval scopes, `.scratch/` artifacts, anti-compaction notes, stop conditions, report format | **[U] universal** |
| Multi-peer semantic compatibility gate, `snapshotEvents`, `setup(agentCtx, agent)`, `acquireScope`, cordis bridge, `assistant/chunk`, icons, `directoryPicker` | **[0.2]** rewrite for each target |

## What was removed from the original brief (and why)

| Removed | Measured reason |
| --- | --- |
| Product, architecture and session-archive process description | read from the repo in 2 reads; not used |
| Requirement for architecture documentation before code | produced a design doc nobody read; the tsc census makes the plan |
| Context on reference repos and handoff docs | paths that do not exist in the repo (cost: 33k tokens read) |
| API lists to check "by hand" | replaced by the surface probe (§2) and the tsc census |
| Detailed UI recommendations | 53 icon renames: the "scripted batch + diff review" rule is enough |
