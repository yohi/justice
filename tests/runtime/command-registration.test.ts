import { describe, expect, it, vi } from "vitest";
import {
  JUSTICE_COMMAND_DEFINITIONS,
  registerJusticeCommands,
  type CommandRegistrationTarget,
} from "../../src/runtime/command-registration";

describe("registerJusticeCommands", () => {
  it("registers justice-start and justice-implement on an empty config.command", async () => {
    const config: CommandRegistrationTarget = {};
    const log = vi.fn(async () => {});

    await registerJusticeCommands(config, log);

    expect(config.command).toBeDefined();
    expect(Object.keys(config.command ?? {})).toEqual(
      expect.arrayContaining(["justice-start", "justice-implement"]),
    );
    expect(config.command?.["justice-start"]).toEqual({
      template: "$ARGUMENTS",
      description: "Start a Justice-managed development workflow",
    });
    expect(config.command?.["justice-implement"]).toEqual({
      template: "$ARGUMENTS",
      description: "Arm the next Justice-managed implementation delegation",
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("does not overwrite existing user-defined commands and logs a warning", async () => {
    const config: CommandRegistrationTarget = {
      command: {
        "justice-start": {
          template: "custom template",
          description: "Custom start command",
        },
      },
    };
    const existing = config.command?.["justice-start"];
    const log = vi.fn(async () => {});

    await registerJusticeCommands(config, log);

    expect(config.command?.["justice-start"]).toEqual({
      template: "custom template",
      description: "Custom start command",
    });
    expect(config.command?.["justice-start"]).toBe(existing);
    expect(config.command?.["justice-implement"]).toEqual({
      template: "$ARGUMENTS",
      description: "Arm the next Justice-managed implementation delegation",
    });
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining(
        'Command "justice-start" is already defined; skipping automatic registration.',
      ),
    );
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("initializes config.command when undefined", async () => {
    const config: CommandRegistrationTarget = { command: undefined };
    const log = vi.fn(async () => {});

    await registerJusticeCommands(config, log);

    expect(config.command).toBeDefined();
    expect(config.command?.["justice-start"]).toBeDefined();
    expect(config.command?.["justice-implement"]).toBeDefined();
  });

  it("isolates registered commands from canonical definitions", async () => {
    expect(Object.keys(JUSTICE_COMMAND_DEFINITIONS)).toEqual([
      "justice-start",
      "justice-implement",
    ]);
    expect(JUSTICE_COMMAND_DEFINITIONS["justice-start"].template).toBe(
      "$ARGUMENTS",
    );

    const config: CommandRegistrationTarget = {};
    await registerJusticeCommands(config, async () => {});
    const registered = config.command?.["justice-start"];
    expect(registered).not.toBe(JUSTICE_COMMAND_DEFINITIONS["justice-start"]);
    registered!.template = "changed";
    expect(JUSTICE_COMMAND_DEFINITIONS["justice-start"].template).toBe("$ARGUMENTS");
    expect(Object.isFrozen(JUSTICE_COMMAND_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(JUSTICE_COMMAND_DEFINITIONS["justice-start"])).toBe(true);
  });

  it("preserves unrelated existing commands", async () => {
    const unrelated = { template: "unrelated" };
    const config: CommandRegistrationTarget = { command: { other: unrelated } };
    await registerJusticeCommands(config, async () => {});
    expect(config.command?.other).toBe(unrelated);
  });

  it("awaits collision logging and propagates logger rejection", async () => {
    const config: CommandRegistrationTarget = {
      command: { "justice-start": { template: "custom" } },
    };
    const log = vi.fn(async () => {
      throw new Error("logger failed");
    });
    await expect(registerJusticeCommands(config, log)).rejects.toThrow("logger failed");
    expect(log).toHaveBeenCalledTimes(1);
  });
});
