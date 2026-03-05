#!/usr/bin/env node

import { Command } from "commander";
import * as pty from "node-pty";
import WebSocket from "ws";
import { randomBytes } from "crypto";

// --- Exported helpers for testing ---

export interface CliOptions {
  server: string;
  name: string;
  cols: number;
  rows: number;
  command: string[];
  token: string;
  insecure: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const program = new Command();
  program
    .option("--server <url>", "WebSocket server URL", "ws://localhost:3001")
    .option("--name <name>", "Session name")
    .option("--cols <number>", "Number of columns", String(process.stdout.columns || 80))
    .option("--rows <number>", "Number of rows", String(process.stdout.rows || 24))
    .option("--token <token>", "Auth token for server authentication", "")
    .option("--insecure", "Disable TLS certificate verification", false)
    .argument("[command...]", "Command to run")
    .allowExcessArguments(true)
    .passThroughOptions()
    .exitOverride();

  program.parse(argv);

  const opts = program.opts();
  const args = program.args;

  const name = opts.name || `session-${randomBytes(2).toString("hex")}`;
  const cols = parseInt(opts.cols, 10);
  const rows = parseInt(opts.rows, 10);
  const command = args.length > 0 ? args : [];

  return {
    server: opts.server,
    name,
    cols,
    rows,
    command,
    token: opts.token,
    insecure: opts.insecure,
  };
}

export function encodeOutputMessage(data: string): string {
  return JSON.stringify({
    type: "output",
    data: Buffer.from(data).toString("base64"),
  });
}

export function encodeResizeMessage(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

export function calculateBackoffDelay(attempt: number): number {
  // Delays: 1s, 2s, 4s, 8s, 16s
  return Math.pow(2, attempt) * 1000;
}

export const MAX_RECONNECT_ATTEMPTS = 5;

// --- Main logic ---

function getDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/sh";
}

function main(): void {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv);
  } catch (err: unknown) {
    // exitOverride() makes commander throw instead of calling process.exit().
    // Catch help/version display and exit cleanly.
    const code = (err as { exitCode?: number }).exitCode;
    process.exit(typeof code === "number" ? code : 1);
  }

  const shellCommand =
    options.command.length > 0
      ? options.command
      : [getDefaultShell()];

  const file = shellCommand[0];
  const args = shellCommand.slice(1);

  const ptyProcess = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    useConpty: true,
  });

  let ws: WebSocket | null = null;
  let reconnectAttempt = 0;
  let isShuttingDown = false;

  function connect(): void {
    let url = `${options.server}/ws/console?name=${encodeURIComponent(options.name)}&cols=${options.cols}&rows=${options.rows}`;
    if (options.token) {
      url += `&token=${encodeURIComponent(options.token)}`;
    }
    ws = new WebSocket(url, options.insecure ? { rejectUnauthorized: false } : undefined);

    ws.on("open", () => {
      console.error("[my-console-app] Connected to server");
      reconnectAttempt = 0;
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data);
            break;
          case "resize":
            ptyProcess.resize(msg.cols, msg.rows);
            break;
          case "session-info":
            console.error(
              `[my-console-app] Session info: id=${msg.session.id}, name=${msg.session.name}, cols=${msg.session.cols}, rows=${msg.session.rows}`
            );
            break;
          default:
            break;
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      console.error("[my-console-app] Disconnected from server");
      ws = null;
      if (!isShuttingDown) {
        attemptReconnect();
      }
    });

    ws.on("error", (err: Error) => {
      console.error(`[my-console-app] WebSocket error: ${err.message}`);
    });
  }

  function attemptReconnect(): void {
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[my-console-app] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting.`
      );
      cleanup(1);
      return;
    }

    const delay = calculateBackoffDelay(reconnectAttempt);
    console.error(
      `[my-console-app] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS})...`
    );
    reconnectAttempt++;
    setTimeout(() => {
      if (!isShuttingDown) {
        connect();
      }
    }, delay);
  }

  function cleanup(exitCode: number): void {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      ptyProcess.kill();
    } catch {
      // already dead
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    process.exit(exitCode);
  }

  // PTY data -> stdout + WebSocket
  ptyProcess.onData((data: string) => {
    process.stdout.write(data);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(encodeOutputMessage(data));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.error(`[my-console-app] PTY exited with code ${exitCode}`);
    cleanup(exitCode);
  });

  // Local stdin -> PTY
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", (data: Buffer) => {
    ptyProcess.write(data.toString());
  });

  // Terminal resize -> PTY + WebSocket
  process.stdout.on("resize", () => {
    const cols = process.stdout.columns;
    const rows = process.stdout.rows;
    ptyProcess.resize(cols, rows);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(encodeResizeMessage(cols, rows));
    }
  });

  // Graceful shutdown
  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));

  // Start connection
  connect();
}

// Only run main when executed directly (not when imported for testing)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") ||
    process.argv[1].endsWith("index.js") ||
    process.argv[1].endsWith("my-console-app"));

if (isDirectRun) {
  main();
}
