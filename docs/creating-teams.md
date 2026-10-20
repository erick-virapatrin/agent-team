# Creating Teams

[Previous: Assistant Library](./assistants.md) · [Documentation Home](./README.md) · [Next: Workbench and Collaboration](./workbench.md)

Before you create a team, prepare at least one assistant suited to being the Leader and one regular member assistant.

## Open the New Team Form

Click the floating **Team** button on the left side of the page to enter the Agent Team Workbench, then click `+` at the top of the team list.

## Select Members

![New team](../demo/3.png)

The assistant library is on the left and the selected members are on the right:

1. Click `+` on the right side of an assistant to add a member.
2. You can add the same assistant repeatedly; each addition creates an independent member instance.
3. Select one member on the right as the Leader.
4. Click `×` on the right side of a member to remove it before creating the team.

A team must have exactly one Leader, but there is no fixed upper limit on the total number of members. With many members, the Workbench keeps each column at a usable width and allows horizontal scrolling.

## Fill in Team Information

### Team Name

Use a name that expresses the goal, for example "Mobile Release Team", "Documentation Migration Team", or "DSH Plugin Development Team". The name is shown in the team list on the left.

### Workspace

Choose the working directory shared by all members:

- You can pick an existing Workspace in Harness.
- You can also click **Select Folder** to add a directory through the Harness directory picker.

Members read and modify files in this Workspace, so confirm the directory is correct before creating the team.

### Allow Direct Communication

When **Allow the user to chat directly with regular members** is checked, the user can bypass the Leader and send messages straight to a regular member. When it is off, regular members mainly receive tasks assigned by the Leader and team messages.

## Create and Auto-Start

After you click **Create and start**, the plugin:

1. Creates an independent Session for each selected member.
2. Associates all Sessions with the same Workspace.
3. Injects the team roles, the member list, and the collaboration tools.
4. Opens the full-screen team Workbench automatically.

There is no extra "start team" step and no "pending start" state. The team shows task execution status only when a member is actually executing a message or task.

## Team Composition Suggestions

### Software Development

- Leader: requirement understanding, task breakdown, acceptance.
- Coder: implement features and fix issues.
- Reviewer: code review and risk checks.
- Tester: run tests and regression verification.

### Content and Documentation

- Leader: plan the structure, assign sections, keep the style consistent.
- Researcher: collect and verify source material.
- Writer: write the body text.
- Reviewer: fact-check, polish, and check formatting.

The models do not have to be the same. You can make a model that is strong at planning the Leader, and use a model that is better suited to coding, or cheaper, as an executing member.

### Mixed-Model Development Team Example

- **GPT Leader**: understands requirements, defines the plan, breaks down tasks, coordinates progress, and accepts results.
- **GLM Coder**: receives coding tasks, modifies the Workspace, runs tests, and reports output.
- **DeepSeek Flash Commit Assistant**: after acceptance, analyses the Git diff read-only and quickly generates a Conventional Commit message.

Each of the three members has its own Session. GLM's code reading and tool output do not get packed into the GPT Leader's context, and the Commit Assistant does not need to inherit the Leader's high-tier model, coding Skills, or write permissions.
