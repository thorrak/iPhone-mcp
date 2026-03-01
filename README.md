# blitz-ios-mcp

MCP server that lets AI agents control iOS simulators and physical iPhones. Works with Claude Code and any MCP-compatible client.

## Quick Start

```bash
npx blitz-ios-mcp --setup
```

This installs dependencies (idb, WebDriverAgent) and configures Claude Code to use the MCP server.

## What It Does

- **Tap, swipe, type** on iOS simulators and physical iPhones
- **Scan UI elements** — find buttons, text fields, links with coordinates
- **Take screenshots** — capture the current screen state
- **Auto-detect devices** — finds booted simulators and connected iPhones
- **Live viewer** — browser-based screen viewer for physical devices

## Usage

After setup, the MCP server starts automatically when Claude Code launches. The agent can:

1. Discover available devices (`get_execution_context`)
2. Find interactive elements (`scan_ui`)
3. Interact with the device (`device_action`, `device_actions`)
4. Verify results (`get_screenshot`, `describe_screen`)

## Tools

| Tool | Description |
|------|-------------|
| `get_execution_context` | Discover available iOS devices |
| `scan_ui` | Find interactive UI elements with coordinates |
| `describe_screen` | Get full UI element hierarchy |
| `device_action` | Execute tap, swipe, button press, text input |
| `device_actions` | Execute multiple actions in sequence |
| `get_screenshot` | Capture device screenshot |
| `list_devices` | List simulators and physical devices |
| `launch_app` | Launch app by bundle ID |
| `list_apps` | List installed apps (simulator) |

## Requirements

- macOS with Xcode installed
- Node.js >= 18
- For simulators: idb (`fb-idb`)
- For physical devices: WebDriverAgent, USB connection

## Physical Device Setup

Physical devices require WebDriverAgent (WDA) running on the device. The `--setup` command handles this automatically:

1. Installs `idb` and `idb_companion`
2. Clones WebDriverAgent from GitHub
3. Optionally builds `ax-scan` for fast simulator UI scanning

When using a physical device, the server starts a browser-based viewer at `http://localhost:5150` so you can see the device screen.

## Manual Configuration

If you prefer manual setup, add this to `~/.claude.json`:

```json
{
  "mcpServers": {
    "blitz-ios": {
      "command": "npx",
      "args": ["blitz-ios-mcp"]
    }
  }
}
```

## License

MIT
