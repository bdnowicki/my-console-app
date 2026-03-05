# my-console-app

CLI tool that spawns a local PTY (pseudo-terminal) and mirrors its I/O to a WebSocket-based console server. This lets you share a live terminal session through a browser.

## Prerequisites

- **Node.js >= 18**
- **Native build tools** — `node-pty` compiles a native addon:
  - **Linux/macOS**: `python3`, `make`, `gcc`/`clang`
  - **Windows**: Visual Studio Build Tools (C++ workload) or `npm install -g windows-build-tools`

## Install

```bash
npm install -g my-console-app
```

Or run directly with npx:

```bash
npx my-console-app --server wss://your-server.example.com
```

## Usage

```
my-console-app [options] [command...]

Options:
  --server <url>   WebSocket server URL (default: "ws://localhost:3001")
  --name <name>    Session name (default: random)
  --cols <number>  Number of columns (default: terminal width)
  --rows <number>  Number of rows (default: terminal height)
  -h, --help       Display help

Arguments:
  command          Command to run (default: system shell)
```

### Examples

Connect to a server with default shell:

```bash
my-console-app --server wss://my-console.example.com
```

Connect with a named session running bash:

```bash
my-console-app --server wss://my-console.example.com --name my-session bash
```

Run a specific command:

```bash
my-console-app --server wss://my-console.example.com -- python3
```

## How it works

1. Spawns a local PTY process (your shell or specified command)
2. Connects to the WebSocket server
3. Mirrors terminal output to the server (base64-encoded)
4. Receives input from the server and writes it to the PTY
5. Handles terminal resizing
6. Auto-reconnects with exponential backoff (up to 5 attempts)

## License

MIT
