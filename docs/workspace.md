# Workspace and Git Changes

[Previous: Workbench and Collaboration](./workbench.md) · [Documentation Home](./README.md) · [Next: Team Management](./team-management.md)

All members of a team share one Workspace. Members can use different permissions, but they all see the same directory and the same file changes.

## Expanding and collapsing

The **Workspace** button in the top-right of the Workbench expands the panel. Once it is open, click the collapse icon to free up more conversation space.

Expanding and collapsing only changes the layout; it does not affect member access to the Workspace.

## Files tab

The **Files** tab shows the Workspace as a directory tree:

- Click a folder to expand it one level at a time.
- New files and directory changes refresh automatically.
- The refresh icon in the top-right re-reads on demand at any time.
- The listing only shows safe paths inside the Workspace.

To prevent path escapes, the plugin rejects absolute paths, `..`, and access that leaves the Workspace through a symbolic link.

## Changes tab

When the Workspace is a Git repository, the **Changes** tab groups files by category:

- Conflicting files.
- Staged files.
- Modified files.
- Untracked files.

Each state has its own color and status code. Click a file to open a read-only Diff preview of the added, deleted and modified content.

## Non-Git Workspace

If the current Workspace is not a Git repository, the Changes tab says so explicitly. File browsing is still available.

Note: if the Workspace root is not a repository but one of its subdirectories is, the plugin does not treat that subdirectory as the Workspace repository. Select the correct repository root when creating the team.

## How auto-refresh works

The plugin tracks Workspace file changes on the Host side and refreshes the directory and Git status over the team event connection. Refresh manually in these cases:

- An external tool generates a large number of files at once.
- The operating system coalesces file system events.
- The browser resumes after a long sleep.
- The network has just reconnected after a drop.

## Choosing files from the input box

A browser cannot safely hand an arbitrary local absolute path to a Host Agent. So when you pick a file that lives outside the Workspace in the input box, the plugin:

1. Uploads the file content into the team Workspace.
2. Saves it under `.agent-team/uploads/`.
3. Inserts the in-Workspace path into the message.

Deleting an attachment and adding the same file again reuses the available name where it can; a new safe file name is generated only when the names collide.

## Suggestions for multi-member edits

Multiple members can modify the same Workspace at the same time. To reduce conflicts:

- Have the Leader split tasks by file or by module.
- State the owned file range clearly in the task description.
- Coordinate through team messages before changing a shared core file.
- After a task is done, have the Leader review the Git Diff and accept the work in one pass.
