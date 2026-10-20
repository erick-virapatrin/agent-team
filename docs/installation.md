# Installation and Startup

[Documentation Home](./README.md) · [Next: Assistant Library](./assistants.md)

## Requirements

- Node.js `22.19.0+` or `24.0.0+`
- DeepSeek Harness `0.1.1-rc.2`
- Agent Team `0.1.2`
- `pnpm` added to your terminal `PATH`

Check the versions:

```bash
node --version
pnpm --version
```

If you do not have pnpm:

```bash
npm install -g pnpm
```

## Install from npm

Run this from any directory:

```bash
npx @deepseek-ai/dsh plugin --profile web add @limuyang2/dsh-agent-team
```

Harness adds the plugin to the `web` Profile. Once the installation is complete, start it:

```bash
npx @deepseek-ai/dsh web
```

The terminal usually prints:

```text
dsh web: http://127.0.0.1:3080
```

Open that address in your browser.

## Using the Official npm Registry

If `npm login` or the install command shows a third-party mirror address, switch the user-level registry back to the official npm address:

```bash
npm config set registry=https://registry.npmjs.org/ --location=user
npm config get registry
```

The second command should output:

```text
https://registry.npmjs.org/
```

## Install from a Local Archive

Once you have the `.tgz` file, run this in the directory that contains it:

```bash
npx @deepseek-ai/dsh plugin --profile web add ./limuyang2-dsh-agent-team-0.1.2.tgz
```

The version number in the file name may differ; replace it with your actual file name.

## Verify the Installation

After starting Harness, check both entry points:

1. The floating **Team** button that opens the Workbench appears on the left side of the page; the button is draggable and remembers its position.
2. The assistant library appears under **Settings → Agent Team**.

## Restart After Installing or Updating

If Harness is already running, press `Ctrl+C` in the original terminal to stop it, then run this again:

```bash
npx @deepseek-ai/dsh web
```

If the browser page has not updated, reload the page. The plugin does not depend on modifying Harness source code.

## Uninstall the Plugin

If Harness is running, press `Ctrl+C` in the original terminal to stop the service, then run:

```bash
npx @deepseek-ai/dsh plugin --profile web remove @limuyang2/dsh-agent-team
```

This command removes the plugin dependency and its configuration layer from the `web` Profile. Restart Harness once the command completes; the Agent Team entries in the sidebar and in Settings will no longer load.

Uninstalling the plugin does not modify DeepSeek Harness source code and does not delete files in team Workspaces. Whether the assistant templates, team records, and Session references stored by the plugin itself survive depends on whether the Harness Profile data directory is still present; to clean that data up completely, take a backup first and handle the matching Profile data directory yourself.

## Next Steps

Keep reading the [Assistant Library](./assistants.md) to create your first Leader and member assistants.
