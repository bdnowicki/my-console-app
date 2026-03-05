import { describe, it, expect } from "vitest";
import {
  parseArgs,
  encodeOutputMessage,
  encodeResizeMessage,
  calculateBackoffDelay,
  MAX_RECONNECT_ATTEMPTS,
} from "../index.js";

describe("CLI argument parsing", () => {
  it("should use default values when no arguments provided", () => {
    const result = parseArgs(["node", "my-console-app"]);
    expect(result.server).toBe("ws://localhost:3001");
    expect(result.cols).toBeGreaterThan(0);
    expect(result.rows).toBeGreaterThan(0);
    expect(result.name).toMatch(/^session-[0-9a-f]{4}$/);
    expect(result.command).toEqual([]);
  });

  it("should parse custom server URL", () => {
    const result = parseArgs(["node", "my-console-app", "--server", "ws://example.com:9000"]);
    expect(result.server).toBe("ws://example.com:9000");
  });

  it("should parse custom name", () => {
    const result = parseArgs(["node", "my-console-app", "--name", "my-session"]);
    expect(result.name).toBe("my-session");
  });

  it("should parse cols and rows", () => {
    const result = parseArgs(["node", "my-console-app", "--cols", "120", "--rows", "40"]);
    expect(result.cols).toBe(120);
    expect(result.rows).toBe(40);
  });

  it("should extract command arguments", () => {
    const result = parseArgs(["node", "my-console-app", "bash", "-c", "echo hello"]);
    expect(result.command).toEqual(["bash", "-c", "echo hello"]);
  });

  it("should handle all options together", () => {
    const result = parseArgs([
      "node",
      "my-console-app",
      "--server",
      "ws://remote:5000",
      "--name",
      "test-sess",
      "--cols",
      "100",
      "--rows",
      "50",
      "zsh",
    ]);
    expect(result.server).toBe("ws://remote:5000");
    expect(result.name).toBe("test-sess");
    expect(result.cols).toBe(100);
    expect(result.rows).toBe(50);
    expect(result.command).toEqual(["zsh"]);
  });
});

describe("Message encoding", () => {
  it("should encode output message with base64 data", () => {
    const msg = JSON.parse(encodeOutputMessage("hello world"));
    expect(msg.type).toBe("output");
    expect(msg.data).toBe(Buffer.from("hello world").toString("base64"));
  });

  it("should decode base64 data back to original", () => {
    const msg = JSON.parse(encodeOutputMessage("test data 123"));
    const decoded = Buffer.from(msg.data, "base64").toString();
    expect(decoded).toBe("test data 123");
  });

  it("should handle empty string", () => {
    const msg = JSON.parse(encodeOutputMessage(""));
    expect(msg.type).toBe("output");
    expect(msg.data).toBe("");
  });

  it("should handle special characters", () => {
    const input = "hello\r\nworld\ttab\x1b[31mred\x1b[0m";
    const msg = JSON.parse(encodeOutputMessage(input));
    const decoded = Buffer.from(msg.data, "base64").toString();
    expect(decoded).toBe(input);
  });

  it("should encode resize message with correct format", () => {
    const msg = JSON.parse(encodeResizeMessage(120, 40));
    expect(msg).toEqual({ type: "resize", cols: 120, rows: 40 });
  });

  it("should handle various resize dimensions", () => {
    const msg = JSON.parse(encodeResizeMessage(80, 24));
    expect(msg.type).toBe("resize");
    expect(msg.cols).toBe(80);
    expect(msg.rows).toBe(24);
  });
});

describe("Reconnection logic", () => {
  it("should calculate correct backoff delays", () => {
    expect(calculateBackoffDelay(0)).toBe(1000);  // 1s
    expect(calculateBackoffDelay(1)).toBe(2000);  // 2s
    expect(calculateBackoffDelay(2)).toBe(4000);  // 4s
    expect(calculateBackoffDelay(3)).toBe(8000);  // 8s
    expect(calculateBackoffDelay(4)).toBe(16000); // 16s
  });

  it("should have exponential growth pattern", () => {
    for (let i = 0; i < 4; i++) {
      expect(calculateBackoffDelay(i + 1)).toBe(calculateBackoffDelay(i) * 2);
    }
  });

  it("should have MAX_RECONNECT_ATTEMPTS set to 5", () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBe(5);
  });

  it("should start at 1 second", () => {
    expect(calculateBackoffDelay(0)).toBe(1000);
  });

  it("should reach 16 seconds at attempt 4", () => {
    expect(calculateBackoffDelay(4)).toBe(16000);
  });
});
