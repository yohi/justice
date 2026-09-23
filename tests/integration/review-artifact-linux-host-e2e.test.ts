import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const SUPPORTED_OPENCODE_VERSION = "1.18.32";

function isSupportedLinuxX64Host(): boolean {
  return process.platform === "linux" && process.arch === "x64";
}

function opencodeVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("opencode", ["--version"], (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

type HostHandlers = Record<string, (input: unknown, output?: unknown) => Promise<unknown>>;

async function loadBuiltPluginHandlers(rootDir: string): Promise<HostHandlers> {
  const pluginModule = (await import("../../dist/opencode-plugin.js")) as {
    OpenCodePlugin: (init: unknown) => Promise<unknown>;
  };
  const handlers = (await pluginModule.OpenCodePlugin({
    project: { name: "justice-host-e2e", root: rootDir },
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
    directory: rootDir,
    worktree: rootDir,
  })) as HostHandlers;
  return handlers;
}

describe("review artifact supported-host acceptance (Task 3.6)", () => {
  it("fails closed as unsupported setup when the pinned OpenCode CLI is absent", async () => {
    let version: string;
    try {
      version = await opencodeVersion();
    } catch (error: unknown) {
      throw new Error(`unsupported setup: opencode CLI is not runnable: ${String(error)}`, { cause: error });
    }
    if (version !== SUPPORTED_OPENCODE_VERSION) {
      throw new Error(
        `unsupported setup: opencode ${version} is installed but the supported host is ${SUPPORTED_OPENCODE_VERSION}`,
      );
    }
    if (!isSupportedLinuxX64Host()) {
      throw new Error(
        `unsupported setup: the Task 3.6 host E2E requires Linux x86_64, found ${process.platform}/${process.arch}`,
      );
    }
    expect(version).toBe(SUPPORTED_OPENCODE_VERSION);
  });

  it("exposes built-plugin handlers without crashing on the supported host", async () => {
    const rootDir = await mkdtemp(`${tmpdir()}/justice-host-e2e-`);
    try {
      const handlers = await loadBuiltPluginHandlers(rootDir);
      expect(handlers["tool.execute.before"]).toBeInstanceOf(Function);
      expect(handlers["tool.execute.after"]).toBeInstanceOf(Function);
      expect(handlers["event"]).toBeInstanceOf(Function);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});