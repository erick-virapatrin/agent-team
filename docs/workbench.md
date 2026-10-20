# Workbench and Collaboration

[Previous: Creating Teams](./creating-teams.md) · [Documentation Home](./README.md) · [Next: Workspace](./workspace.md)

After a team is created it opens in the full-screen Workbench. Switch teams on the left, member conversations appear side by side in the middle, and the shared Workspace shows on the right when you need it.

![Multi-member Workbench](../demo/4.png)

## Top member tabs

- Click a tab to show or hide that member's conversation column.
- The Leader is marked with a crown.
- The status dot reflects the Idle, Running, Waiting, Error or Offline state.
- Hovering a tab that is not the Leader lets you remove that member directly.
- **Add assistant** opens the reusable assistant picker.
- **Team management** opens member and team lifecycle management.

Hiding a conversation column does not stop the member and does not clear its context.

## Member conversation column

Each column is an independent Harness Session, showing:

- User messages and assistant Markdown replies.
- Collapsible **Think** blocks, stamped **Thinking · …** while the model is reasoning and **Took …** once it is done.
- Tool names, run status, arguments, results and errors.
- Leader instructions, member feedback and team event cards.
- Question / Approval cards for interactions that are pending.
- Member run status and stop controls.

Double-click a member's title to expand that conversation into a floating window; close it to return to the multi-column view.

## Sending messages

- `Enter` sends the message.
- `Shift+Enter` starts a new line.
- While an input method for Chinese or another language is composing, the Enter key that confirms a candidate does not send the message.
- A message sent while a member is running is queued and handled by Harness's current rules.
- The round stop button stops only that member and leaves the others untouched.

Describe the full goal to the Leader first and let the Leader do the dispatching; open a specific member's conversation when you need to add implementation details.

## Adding and referencing files

The paperclip at the lower-left of the input box selects local files. A selected file is copied into the Workspace at `.agent-team/uploads/`, and a path the Agent can read is inserted into the message.

Typing `@` in the input box opens the Workspace file search menu. Keep typing a path fragment to filter files, select with the up and down arrow keys, and press Enter or Tab to insert; paths with spaces are quoted automatically. A file reference only provides context; it never modifies files on its own.

## Invoking a Skill with a slash

Typing `/` in the input box lists the Skills the current member is allowed to use and that support user invocation. Keep typing a name to filter, select with the up and down arrow keys, press Enter or Tab to insert, and press Esc to close the menu.

After sending, the message keeps the standard `/skill-name` literal, and Harness's Skill invocation boundary loads the matching instructions. Skills allowed for the model only, with user invocation disabled, do not appear in the menu.

## Permission for the current Session

Each input box lets you choose:

- **Read-only**: suited to analysis, review, retrieval and planning.
- **Workspace writable**: allows modifying files in the current Workspace.
- **Full access**: confirm the task really needs the higher permission before using it.

An assistant template only provides the initial default permission. Changing it at runtime affects the current team member only: it does not modify the template and does not affect other members.

## Reasoning mode

The **Reasoning mode** dropdown in the input box lists the levels the current model supports, for example Low, Medium, High, Xhigh or Max. When the model declares no capability, only the model default is used.

A change takes effect from the next turn on. The member's title area shows the current level directly, which makes it easy to compare the configuration of different members.

## Skills and context

- The `i` info icon shows the Skills loaded for the current member; Skills that support user invocation also appear in the `/` menu.
- The context ring shows how much of the context is used.
- Hovering the ring shows the context window, input tokens, output tokens and cache hit rate.

When context approaches the limit, run **Clear tasks and context** in Team Management to give every member a brand-new Session.

## How Agents communicate

Members do not read each other's chat history. Collaboration runs through the team tools:

1. The Leader creates a task and names the owner.
2. The task enters the owner's Session automatically.
3. The member reports it is running when it starts, and attaches the result when it finishes.
4. Status and results are pushed to the Leader automatically.
5. When clarification is needed, the Leader and the member exchange direct team messages.

Members with the same name also carry a stable member ID, so nothing gets confused after a member is removed and re-added.

## Switching teams

The team list on the left switches between the Workbenches of multiple teams. A team entry only shows whether work is currently running; it does not display meaningless task counts. Switching teams does not stop members that are still running in the background.
