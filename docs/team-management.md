# Team Management

[Previous: Workspace](./workspace.md) · [Documentation Home](./README.md) · [Next: Troubleshooting](./troubleshooting.md)

Click **Team management** at the top of the Workbench to manage members, the Leader, contexts, and the team lifecycle.

## Add Members

Clicking **Add assistant** opens the assistant list dialog:

1. Select an assistant.
2. The system creates a new member snapshot from the assistant's current configuration.
3. It creates an independent Session for the member and associates it with the team Workspace.
4. The new member joins the Workbench automatically once it starts successfully.
5. The Leader receives a notification with the member name, member ID, model, and ready status.

You can add the same assistant repeatedly, with no alias to set. The interface keeps the assistant's original name, and the system uses stable member IDs to tell the instances apart.

## Remove Members

You can remove a regular member from its member card, from the hover actions on a top tab, or from the Team Management window. A custom warning dialog appears before the action.

After you confirm:

- The member's running tasks are stopped.
- The current Session is archived and detached.
- The member is removed from the team's active members.
- The Leader is notified that the member was removed, along with the member ID.
- The Workspace files and the work the member has already completed stay unchanged.

The Leader cannot be removed directly. Transfer the Leader role to another member first.

## Change the Leader

Click **Set as Leader** on a regular member's card:

- The former Leader becomes a regular member.
- The new Leader takes on the Leader role and the team coordination rules.
- Both members keep their existing Session and context.
- The team always has exactly one Leader.

## Clear Tasks and Context

Use this when the context has grown too long, the work needs a complete restart, or the team state is in a mess.

After you confirm:

- All members stop.
- Team tasks, pending messages, and file lease state are cleared.
- A brand-new Session is created for each member that is kept.
- The member list, the Leader, the assistant snapshots, and the runtime configuration are kept.
- The Workspace and all of its files are kept.

This does not "undo file modifications" and does not roll back Git changes. Use Git or another version control tool when you need to roll files back.

## Disband the Team

Disbanding is an irreversible delete in the team domain, and the confirmation dialog does not require you to type the team name.

| Deleted | Kept |
| --- | --- |
| Team configuration | Assistant templates |
| Team tasks | Workspace files |
| Team messages and activity records | Provider, model, Skills, and MCP configuration |
| The plugin's restore links to the old Sessions | Session logs that Harness may keep at the lower layer |

After disbanding, the team disappears from the list on the left, and the assistants remain available for creating other teams.

## Why There Is No Pause for a Team

A team is a set of members and their collaboration, not a single continuously running process. Members execute no tasks while idle, so "pausing the team" has no clear value.

When you need to stop work you can:

- Stop the current output of one member.
- Clear all tasks and contexts.
- Remove members that are no longer needed.
- Disband the whole team.
