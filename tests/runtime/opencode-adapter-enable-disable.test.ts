import { describe, expect, it, vi } from "vitest";
import { validatePluginOptions } from "../../src/core/plugin-options";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import {
  JUSTICE_COMMAND_DEFINITIONS,
  registerJusticeCommands,
} from "../../src/runtime/command-registration";
import { fakeInit } from "../helpers/fake-opencode-init";

describe("Justice workflow enable/disable controls", () => {
  it("accepts the static enabled plugin option", () => {
    expect(validatePluginOptions({ enabled: true })).toEqual({
      options: { enabled: true },
      warnings: [],
    });
    expect(validatePluginOptions({ enabled: false })).toEqual({
      options: { enabled: false },
      warnings: [],
    });
  });

  it("falls back to enabled when the static enabled option is invalid", () => {
    const result = validatePluginOptions({ enabled: "no" });
    expect(result.options).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('"enabled"');
    expect(result.warnings[0]).toContain("default (true)");
  });

  it("registers session enable and disable commands", async () => {
    const config: Parameters<typeof registerJusticeCommands>[0] = {};
    const log = vi.fn().mockResolvedValue(undefined);

    await registerJusticeCommands(config, log);

    expect(Object.keys(JUSTICE_COMMAND_DEFINITIONS)).toEqual(
      expect.arrayContaining(["justice-enable", "justice-disable"]),
    );
    expect(config.command).toHaveProperty("justice-enable");
    expect(config.command).toHaveProperty("justice-disable");
  });

  it("keeps Justice enabled by default and honors static disabled state", () => {
    const enabled = new OpenCodeAdapter(fakeInit());
    const disabled = new OpenCodeAdapter(fakeInit(), { enabled: false });

    expect(enabled.isSessionEnabled("session-default")).toBe(true);
    expect(disabled.isSessionEnabled("session-default")).toBe(false);
  });

  it("disables only the requested session and clears its active workflow state", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice failed to initialize");

    justice.getPlanBridge().setActivePlan("session-a", "docs/plans/a.md");
    justice.getPlanBridge().setActivePlan("session-b", "docs/plans/b.md");

    const output = { parts: [] };
    await adapter.onCommandExecuteBefore(
      { command: "/justice-disable", sessionID: "session-a", arguments: "" },
      output,
    );

    expect(adapter.isSessionEnabled("session-a")).toBe(false);
    expect(adapter.isSessionEnabled("session-b")).toBe(true);
    expect(justice.getPlanBridge().getActivePlan("session-a")).toBeNull();
    expect(justice.getPlanBridge().getActivePlan("session-b")).toBe("docs/plans/b.md");
    expect(output.parts).toHaveLength(1);
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: DISABLED]");
  });

  it("lets a session explicitly enable Justice even when the static default is disabled", async () => {
    const adapter = new OpenCodeAdapter(fakeInit(), { enabled: false });
    const output = { parts: [] };

    await adapter.onCommandExecuteBefore(
      { command: "justice-enable", sessionID: "session-a", arguments: "" },
      output,
    );

    expect(adapter.isSessionEnabled("session-a")).toBe(true);
    expect(adapter.isSessionEnabled("session-b")).toBe(false);
    expect(output.parts).toHaveLength(1);
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: ENABLED]");
  });


  it("inherits a parent session override into known child sessions", async () => {
    const adapter = new OpenCodeAdapter(fakeInit(), { enabled: false });
    await adapter.onCommandExecuteBefore(
      { command: "justice-enable", sessionID: "parent", arguments: "" },
      { parts: [] },
    );
    await adapter.onEvent({
      event: {
        id: "child-created",
        type: "session.created",
        properties: { info: { id: "child", parentID: "parent" } },
      },
    });

    expect(adapter.isSessionEnabled("parent")).toBe(true);
    expect(adapter.isSessionEnabled("child")).toBe(true);

    await adapter.onCommandExecuteBefore(
      { command: "justice-disable", sessionID: "parent", arguments: "" },
      { parts: [] },
    );

    expect(adapter.isSessionEnabled("parent")).toBe(false);
    expect(adapter.isSessionEnabled("child")).toBe(false);
  });

  it("passes task calls through unchanged while the session is disabled", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.onCommandExecuteBefore(
      { command: "justice-disable", sessionID: "session-a", arguments: "" },
      { parts: [] },
    );

    const args = {
      prompt: "fix the typo",
      category: "quick",
      metadata: { source: "caller" },
    };
    const output = { args: structuredClone(args) };

    const response = await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "session-a", callID: "call-a" },
      output,
    );

    expect(response).toEqual({ action: "proceed" });
    expect(output.args).toEqual(args);
    expect(adapter.getJustice()).toBeNull();
  });

  it("does not start Justice workflow commands while the session is disabled", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.onCommandExecuteBefore(
      { command: "justice-disable", sessionID: "session-a", arguments: "" },
      { parts: [] },
    );

    const output = { parts: [] };
    await adapter.onCommandExecuteBefore(
      { command: "justice-start", sessionID: "session-a", arguments: "fix typo" },
      output,
    );

    expect(adapter.getJustice()).toBeNull();
    expect(output.parts).toHaveLength(1);
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: DISABLED]");
  });


  it("wires static disabled state through the plugin and suppresses Justice system context", async () => {
    const hooks = await OpenCodePlugin(fakeInit() as never, { enabled: false } as never);
    const config = {};
    await hooks.config?.(config as never);

    const disabledOutput = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "session-a" } as never,
      disabledOutput as never,
    );
    expect(disabledOutput.system).toEqual([]);

    await hooks["command.execute.before"]?.(
      { command: "justice-enable", sessionID: "session-a", arguments: "" } as never,
      { parts: [] } as never,
    );

    const enabledOutput = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "session-a" } as never,
      enabledOutput as never,
    );
    expect(enabledOutput.system.join("\n")).toContain("[JUSTICE: AVAILABLE USER SLASH COMMANDS]");
  });

  it("rejects justice_review while the session is disabled without initializing Justice", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.onCommandExecuteBefore(
      { command: "justice-disable", sessionID: "session-a", arguments: "" },
      { parts: [] },
    );
    const definition = adapter.getTools().justice_review;
    if (definition === undefined) throw new Error("justice_review definition is missing");

    const result = await definition.execute({}, { sessionID: "session-a" } as never);
    const output = typeof result === "string" ? result : result.output;

    expect(JSON.parse(output)).toEqual({
      status: "ERROR",
      reason: "Justice disabled for this session",
    });
    expect(adapter.getJustice()).toBeNull();
  });

  it("re-enables a disabled session with clean workflow state", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.onCommandExecuteBefore(
      { command: "justice-disable", sessionID: "session-a", arguments: "" },
      { parts: [] },
    );
    await adapter.onCommandExecuteBefore(
      { command: "justice-enable", sessionID: "session-a", arguments: "" },
      { parts: [] },
    );

    expect(adapter.isSessionEnabled("session-a")).toBe(true);
    await adapter.ensureInitialized();
    expect(adapter.getJustice()?.getPlanBridge().getActivePlan("session-a")).toBeNull();
  });
});
