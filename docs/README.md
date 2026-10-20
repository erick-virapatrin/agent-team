# Agent Team User Manual

[Back to the Chinese home page](../README_CN.md) · [English README](../README.md)

Agent Team is a DeepSeek Harness Web plugin that assembles multiple peer-level, independent AI Agents into a team. Every member has its own model, Session, context, and tool calls, while sharing a single Workspace and collaborating through team tasks and messages.

![Multi-member team workbench](../demo/4.png)

## How This Differs from a Typical Subagent Workflow

Agent Team does not implement team members as temporary subagents of the Leader. It creates an independent root-level Agent for each responsibility. The goal is not simply to have more Agents, but to split models, tools, permissions, and context along specialized roles.

| Capability | What it gives you |
| --- | --- |
| Independent model per member | High-capability models for complex planning, and more suitable or cheaper models for coding, testing, commit messages, and similar tasks |
| Independent Skills / MCP per member | One Agent no longer loads a large set of unrelated capabilities, which reduces tool-selection noise and prompt overhead |
| Independent context per member | Execution details stay with the executing member, and the Leader only receives progress and results, which limits context growth in a single Agent |
| Independent permissions per member | A review member can be read-only and a coding member gets only Workspace write access, reducing unnecessary access scope |
| Explicit team messages | Tasks, progress, and results have a clear recipient and member ID, so members with the same name can still be told apart reliably |

A team can therefore combine a high-capability Leader, a specialized coding model, a low-cost documentation Assistant, and a read-only review Assistant, instead of routing every piece of work through the same model and the same large configuration.

### Typical Configuration Example

| Member | Recommended model role | Permissions and capabilities |
| --- | --- | --- |
| GPT Leader | Requirement understanding, architecture planning, task breakdown, and result acceptance | Loads only team management and the review capabilities it needs |
| GLM coding member | Writing code, modifying files, running tests | Workspace writable, with coding Skills and development MCP loaded |
| DeepSeek Flash Commit Assistant | Reading Git changes and generating commit messages | Read-only, needs only Git analysis tools |

The Leader hands coding tasks to GLM and receives only progress, test results, and key output; after acceptance it hands a narrowly scoped Commit task to DeepSeek Flash. This keeps GPT's advantage on complex decisions without running every step through the same expensive model.

## Where to Start

| Your goal | Recommended document |
| --- | --- |
| Install and start the plugin for the first time | [Installation and Startup](./installation.md) |
| Create a Leader, a Coder, or another role | [Assistant Library](./assistants.md) |
| Select members and create a team | [Creating Teams](./creating-teams.md) |
| Use multi-member chat and team collaboration | [Workbench and Collaboration](./workbench.md) |
| Browse files and view Git changes | [Workspace and Git Changes](./workspace.md) |
| Add/remove members, clear contexts, or disband a team | [Team Management](./team-management.md) |
| Installation failures, missing models, or UI problems | [Troubleshooting](./troubleshooting.md) |

## Core Concepts

### Assistant

An Assistant is a reusable role template. It stores the Provider, model, Agent Preset, default permissions, reasoning mode, Skills, MCP Servers, and Assistant rules. An Assistant does not run by itself; a separate member instance is created only when it joins a team.

### Team Member

A team member is the runtime snapshot of an Assistant in a specific team. Selecting the same Assistant several times still produces different member IDs, Sessions, and contexts.

### Leader

Every team must have exactly one Leader. The Leader understands the goal, breaks down tasks, assigns members, receives status, and accepts results. The Leader is not the parent Agent of the other members; all members remain peer-level, independent Agents.

### Workspace

All team members share the same Workspace, so they can read and modify the same files. Whether a member may modify files is decided by the permissions of that member's current Session.

## Recommended Workflow

1. Configure the Providers, models, and credentials you need in Harness.
2. Open **Settings → Agent Team** and create at least one Leader Assistant and one regular member Assistant.
3. Click the floating **Team** button to enter the Workbench, then click `+` at the top of the team list to choose members, the Leader, and the Workspace.
4. After the team is created, describe the complete goal to the Leader in the Workbench that opens automatically.
5. Watch the Leader assign tasks, the members execute them, the status reports come back, and the final acceptance.
6. When needed, send extra requirements directly to one member, or adjust members in Team Management.

## Data and Security Boundaries

- Provider API keys and MCP credentials are managed by the Harness Profile; Agent Team does not store them.
- The permissions in an Assistant template are only the defaults used the first time a member starts; adjust them per member in the Workbench.
- Disbanding a team does not delete Assistant templates or Workspace files.
- After clearing contexts or disbanding a team, the plugin no longer restores or uses the old Sessions; Harness may still keep the underlying logs.

## Getting Help

If the documentation does not solve your problem, submit feedback on [GitHub Issues](https://github.com/limuyang2/agent-team/issues) and include:

- The DeepSeek Harness version.
- The Agent Team version.
- The steps you performed and the error message.
- Interface screenshots where needed (mask API keys, tokens, and private paths first).
