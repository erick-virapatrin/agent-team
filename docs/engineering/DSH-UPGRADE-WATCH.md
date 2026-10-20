# DSH upgrade watch for the Agent Team plugin

Measured on **2026-10-20**. The plugin is aligned with **0.2.0-rc.2** (PR #12, not merged).
Goal: prepare the next migration — without executing it — with a risk matrix and reusable
contract probes.

## 1. Harness state (verified)

| Reference | Version | Date | Source |
| --- | --- | --- | --- |
| Installed runtime (global) | `0.2.0-rc.2` | 2026-09-29 | global package `package.json`; registry `time` |
| PR #12 target | `0.2.0-rc.2` | — | branch `peerDependencies` |
| npm `latest` / `next` | **`0.2.1-rc.2`** | 2026-10-17 | `npm view @deepseek-ai/dsh dist-tags` |
| GitHub tags | `dsh-v0.2.1-rc.2`, `dsh-v0.2.1-rc.1` (17/10), alpha.3 (14/10), alpha.4 (15/10), alpha.5 (16/10) | | `gh release list` |
| Churn 0.2.0-rc.2 → 0.2.1-rc.2 | **1,925 commits**, ≥ 300 files (API ceiling) | | `gh api …/compare/dsh-v0.2.0-rc.2...dsh-v0.2.1-rc.2` |

## 2. Contract probe result 0.2.0-rc.2 → 0.2.1-rc.2 (measured)

The 24 packages used by the plugin were fetched at 0.2.1-rc.2 (`npm pack`) and compared to the installed tree:

```
symbols checked: 66   identical: 66   missing: 0   signatures changed: 0   services: 14/14 present
```

Reproduced command:

```bash
node docs/engineering/tooling/dsh-api-surface.mjs \
  --imports .scratch/plugin-imports.json --services .scratch/plugin-services.json \
  --base node_modules/@deepseek-ai --target .scratch/dsh021/target/@deepseek-ai
```

**Conclusion (VERIFIED, with its limit)**: the plugin's import surface and service surface do
**not** move between 0.2.0-rc.2 and 0.2.1-rc.2. The probe compares textual declarations: it
sees neither behavior changes, nor new runtime obligations, nor deprecations → the P1 rows
below stay open.

Load gate (computed, local `semver`): `^0.2.0-rc.2` satisfies `0.2.1-rc.1`, `0.2.1-rc.2`,
`0.2.1`; **does not satisfy** `0.3.0-rc.1` → in 0.3.x the plugin **does not load** without a peers bump.
Dependencies of `@deepseek-ai/dsh@0.2.1-rc.2`: `@deepseek-ai/cordis ~4.0.5` (plugin: `~4.0.5` ✓),
`schemastery ~3.18.5` (plugin: `^3.18.1` ✓).

## 3. Change matrix

`Package/API | Current version | Identified change | Risk | Compatibility test`

### P0 — blocks loading or breaks a core function

| Row | Detail |
| --- | --- |
| `@deepseek-ai/dsh*` (peers) | 0.2.0-rc.2 → **0.3.x** | semantic compatibility gate per peer (`includePrerelease`); 0.3.x not satisfied by `^0.2.0-rc.2` | **load refused** | `dsh <profile> --dump-config` → presence of `- id: agent-team` |
| `Session.snapshotEvents()`, `Session.ownEvents()`, `Session.eventAt()` | 0.2.1-rc.2 | all three are `@deprecated` "new calls are prohibited" (found in `dsh-session/lib/types/index.d.ts` 0.2.1-rc.2); removal is the stated goal of the deprecation | plugin **transcript / cold resume / projection** break on removal | usage probe: `grep -rn "snapshotEvents\|ownEvents\|eventAt" src/` (3 sites in 0.2.0) + cold resume test (§Guide 6.3) |

### P1 — probable functional regression, test required

| Row | Detail |
| --- | --- |
| `pi-ai` routing (prompt system + dynamic tools) | rc.1: "system prompt updates during a session and dynamic tool add/remove based on model capabilities" | Agent Team prompt construction (`systemPrompt`) and `PRESET_PROMPT_INCOMPATIBLE`; member tools | real team-member turn: stable prompt, coherent tools |
| agent / subagent presets | rc.1: configuration of one preset per subagent | `agentPresets.acquireScope()`, member presets, prompt validation | `team.create` 2 members + `team.start` → `activeMembers: 2`, `deliveryState: 'delivered'` |
| plugin lifecycle (enable/disable/update + hot reload) | rc.1: dependency synchronization, hot application of replaceable plugins | `link:` + reload without restart: the plugin assumes a restart | code change, reload, check that the new version is served |
| experimental API for plugin session-state recording | rc.1 (new) | opportunity to replace direct `storageDomain` use for team state | to assess; test = team persistence after restart |
| secret redaction in sent messages | rc.1: detection and redaction by default | content of messages relayed between agents, transcript display | send a fake token in a team message, check the display |
| `working_directory` tool + working-directory SDK | rc.1 | isolation by workspace (`workspaceRegistry`, workspace ids) | `team.create` with a workspace, check the effective directory |

### P2 — opportunities / low risk

| Row | Detail |
| --- | --- |
| `dsh-experimental-agent-team-profile` bundle | **still shipped** in 0.2.1-rc.2 | coexistence with the plugin: the test profile must stay free of a competing bundle |
| experimental developer tooling (raw session logs, log ↔ chat locating) | rc.1 | reduces the cost of the diagnostic phase |
| custom plugin indexes, plugin creation from the UI | rc.1 | plugin distribution outside `link:` |
| `/compact`, per-model reasoning presets in the UI, YAML preview of Markdown, shared `AGENTS.md` directory (`DSH_AGENTS_HOME`) | rc.1 | side effects on member context; to observe |

## 4. Contract probes to run before every upgrade

| # | Probe | Command | Expected output (0.2.1-rc.2 baseline measured) |
| --- | --- | --- | --- |
| S1 | API surface | `node docs/engineering/tooling/dsh-api-surface.mjs --imports … --base <arbre courant> --target <arbre cible>` | 0 missing, 0 signature changed, 14/14 services |
| S2 | Deprecated API usage | `grep -rn "snapshotEvents\|ownEvents\|eventAt" src/ tests/` | list of sites; **target 0** before a 0.3 |
| S3 | Load gate | `dsh <profil-test> --dump-config \| grep -A4 "id: agent-team"` | entry present, no version warning |
| S4 | cordis event inventory | `grep -rn "\.on('" <arbre-cible>/@deepseek-ai/*/lib/index.js \| head -60` | `session/event`, `agent/assistant-stream`, `approval/request`, `user-questions/request` present |
| S5 | Runtime smoke | integration script (§Guide 6.6) | team created, message `delivered`, cold resume, streaming live + durable |
| S6 | Upgrade cost | `gh api …/compare/<tagA>...<tagB> --jq '{commits:.total_commits}'` | delta volume signal (1,925 commits for 0.2.0→0.2.1-rc.2) |

## 5. Prepared plan for 0.2.0-rc.2 → 0.2.1-rc.2 (not executed)

1. **S1 + S4 on the target tree** (≈ 5 tool calls). Result already measured today: no surface
   gap → the code port is probably **zero**.
2. **S2**: migrate the 3 synchronous session-read sites to `session/event` + `open/read`
   **now** (the `session/event` seam already exists in 0.2.0-rc.2, verified) → removes the P0
   for 0.3. Independent of any upgrade.
3. **Peers bump + `npm ci` + `npm run check`** (≈ 10 calls): if S1 is clean, the gate must
   stay green.
4. **S5** with the integration script: matrix P1 (system prompt, member presets, hot reload,
   secret redaction, workspace).
5. Report: P0/P1/P2 table with what turned green and what stays open.

Expected budget, calibrated on the previous mission's measurements: investigation **< 40 tool
calls** (325 observed with the manual method), integration **< 45 min** (2h20 observed),
approvals **< 4** (11 observed).

## 6. To watch with no test possible today

- Removal date for synchronous session-event reads (deprecation with no deadline).
- Stability of assistant frames (`agent/assistant-stream`) and of the durable `stream`/`usage` format.
- Release of stable `0.2.1`, then of the first `0.3.x` (peers bump mandatory).
- Evolution of the experimental Agent Team bundle shipped with the harness (functional duplicate).
- Hot-reload behavior on a `link:` plugin (not tested in 0.2.0-rc.2).
