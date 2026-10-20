# Assistant Library

[Previous: Installation and Startup](./installation.md) · [Documentation Home](./README.md) · [Next: Creating Teams](./creating-teams.md)

An assistant is a role template you can reuse across teams. Disbanding a team does not delete assistants, and deleting an assistant does not delete the Harness Sessions it already produced.

## Opening the assistant library

Go to **Settings → Agent Team**.

![Assistant library](../demo/2.png)

Each assistant card shows the model, Preset, default permission, reasoning mode, Skills, MCP Servers and the role description. The available actions are:

- **Edit**: change the template configuration.
- **Copy**: create a new assistant from the current configuration.
- **Delete**: delete an assistant that no team member references.

## Method 1: the built-in assistant builder

Click **Start chat** on the built-in card and describe the role you need in natural language, for example:

```text
Create an assistant in charge of React front-end development and code review, using a GLM model, writable in the workspace by default.
```

The builder fills in the missing configuration item by item and produces a complete plan. The assistant is only created for real after you confirm explicitly.

![Creating an assistant through a conversation](../demo/1.png)

The builder keeps several independent conversation histories. A new conversation where the first message has not been sent does not create a real Session and does not appear in the history.

## Method 2: manual creation

Click **New manually** in the top-right of the assistant library and configure every field directly.

| Field | Purpose |
| --- | --- |
| Name | The assistant's name in the assistant library, in team members and in conversation titles |
| Description | A short description of what the assistant is for, to make it easy to pick when forming a team |
| Provider / Model | The model source and model this assistant uses by default |
| Agent Preset | Decides the base prompt, the available tools and how it runs |
| Default permission | The permission the member uses when it starts; you can change it in the Workbench |
| Reasoning mode | The strength picked from the Harness capability catalog, when the model supports it |
| Skills | Skills the model may load on demand, or that the user can invoke with `/` |
| MCP Servers | Configured MCP servers the assistant is allowed to use |
| Assistant rules | The standing role, responsibilities, constraints and reporting style |

## How to write assistant rules

Rules should state the responsibilities, the boundaries and the way work is delivered. For a Leader:

```text
You are in charge of understanding the user's goal, breaking it into tasks, assigning them to the right members and accepting the results.
Hand coding work to members to execute; when a task fails, collect the causes first, then decide whether to retry or reassign.
When the work is done, summarize the output, the verification results and any remaining risk for the user.
```

A regular coding member can be written as:

```text
You carry out the coding tasks the Leader assigns.
Before changing anything, read the relevant files and follow the existing code style.
When you finish, run the necessary tests and report the result and the list of files through the team task tool.
```

## Permission and reasoning mode

- The template permission is only the default for a member's first start. Once you are in the Workbench you can switch it for each Session separately.
- The reasoning-mode options are decided by Harness's model capabilities. Different models may support different levels, and some may support only the model default.
- Changing the reasoning mode in the Workbench takes effect from the next message on.

## Skills and MCP

- Skills come from the catalog available to the selected Agent Preset, and the assistant stores only the names it is allowed to use; a Skill that only supports user invocation is marked "Slash command only".
- MCP connections and credentials are managed by the Harness Profile, and the assistant stores only the server names it is allowed to use.
- If the list is empty, check the Harness Profile and Agent Preset configuration first.

## Why editing does not affect team members right away

When an assistant joins a team it produces an immutable configuration snapshot, so a running member never changes model or rules suddenly because the template was edited. Therefore:

- Edits only affect members that join the team afterwards.
- To apply a new configuration to a member that is already running, remove it first, then add that assistant again.

## Deleting an assistant

If the assistant is still referenced by any team member, the delete is rejected. Remove the matching member from the relevant teams, or disband those teams, then go back to the assistant library and delete.
