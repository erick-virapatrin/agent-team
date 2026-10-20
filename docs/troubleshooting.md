# Troubleshooting

[Previous: Team Management](./team-management.md) · [Documentation Home](./README.md)

## The install command reports `pnpm not found on PATH`

Harness manages Profile plugins with pnpm. Run:

```bash
npm install -g pnpm
pnpm --version
```

Once a version number is printed, install the plugin again.

## `npm login` opens a third-party mirror

Check the current registry:

```bash
npm config get registry
```

Switch to the official npm registry:

```bash
npm config set registry=https://registry.npmjs.org/ --location=user
```

## Startup fails with `EADDRINUSE 127.0.0.1:3080`

The port is taken by another Harness process. Go back to the terminal where Harness was started, press `Ctrl+C`, then run this again:

```bash
npx @deepseek-ai/dsh web
```

If you do not know which process holds the port, inspect it read-only:

```bash
lsof -nP -iTCP:3080 -sTCP:LISTEN
```

## The "Team" entry is missing after installing

Check these in order:

1. The install command used `--profile web`.
2. Harness was fully stopped and restarted after the install.
3. The browser has been refreshed.
4. `@limuyang2/dsh-agent-team` appears under **Settings → Plugins**.
5. The Harness Profile you are running is the one the plugin was installed into.

## The assistant or team list keeps refreshing

- Confirm there is no "event connection disconnected" notice in the top-right of the page.
- Check the Harness terminal for plugin load errors.
- Refresh the browser and wait for the event connection to recover.
- If `assistant.list` or `team.list` keeps timing out, restart Harness.

The list endpoints do not depend on model generation. A slow model catalog load must not block the assistants and teams that are already saved.

## The model list is incomplete

Agent Team only shows the Providers and models that the current Harness Profile has configured and made available:

1. First confirm the Provider and model in Harness's model settings.
2. Check that the credentials are valid.
3. Go back to the assistant library and click refresh.
4. Re-select the Provider and model when editing the assistant.

## GLM or another model has no reasoning mode

Reasoning levels come from Harness's model capability catalog. If the Provider declares no capabilities, the plugin shows the model default only. After you fix the model capability configuration in the Profile, refresh the assistant catalog.

Do not pick a level the model does not support; an invalid parameter can make requests fail.

## The permission stays Read-only

The assistant template permission is only the initial default. Open the team Workbench and switch the current Session permission at the lower-left of that member's input box. The change is saved to that member's run configuration, but it does not modify the assistant template.

## Sending fails, or the stop button does nothing

- Confirm the event connection and the API requests are not disconnected.
- Wait for the member's status to refresh, then retry.
- Do not click the send button repeatedly in quick succession; the same message is deduplicated by ID, but you should still wait for UI feedback while the network recovers.
- Stopping a single member affects only that member; other columns may keep running.

## Enter sends the message while typing Chinese or English

The current version tracks input method composition state. The Enter key that confirms an input method candidate does not send; in the normal state `Enter` sends and `Shift+Enter` starts a new line. If you can still reproduce it, record the operating system, browser and input method name, then open an Issue.

## An assistant cannot be deleted

The assistant is still referenced by one or more team members. Open the relevant teams:

1. Remove the member that corresponds to this assistant; or
2. Disband the teams you no longer need.

Then go back to **Settings → Agent Team** and delete it.

## The Workspace does not refresh automatically

Click the refresh icon to the right of the Workspace title. After the browser resumes from sleep, after a burst of file changes, or after the event connection reconnects, a manual refresh re-reads the directory and Git status immediately.

## The "Changes" tab says this is not a Git repository

The plugin checks the team's Workspace root directory. Confirm that this directory contains `.git`, and not only some subdirectory inside it. A plain directory can still use file browsing.

## Why the file I picked ends up in `.agent-team/uploads/`

A browser cannot safely hand an arbitrary local absolute path to a Host Agent. The plugin copies the file into the Workspace so that the Agent can read it without crossing the Workspace security boundary.

## Old logs are still there after clearing or disbanding

Harness currently has no public API to physically delete the log of a single Session. The plugin unlinks it, so it is no longer restored, displayed, or added to model context, but the underlying log may be kept.

## Reporting an issue

Open an issue on [GitHub Issues](https://github.com/limuyang2/agent-team/issues) with:

- The Harness and plugin versions.
- The Provider and model names (do not submit API keys).
- The steps that reproduce the problem.
- Harness terminal errors and UI screenshots.
- Whether a refresh or a restart recovers the behaviour.
