// tests/runtime/opencode-plugin-options.test.ts
import { describe, expect, it, vi } from "vitest";
import { OpenCodePlugin } from "../../src/opencode-plugin";

function fakeInit() {
  const log = vi.fn();
  const init = {
    project: {},
    client: { app: { log } },
    $: () => {},
    directory: "/tmp/justice-plugin-options-test",
    worktree: "/tmp/justice-plugin-options-test",
  };
  return { init, log };
}

describe("OpenCodePlugin PluginOptions wiring", () => {
  it("returns Hooks without warnings for valid options", async () => {
    const { init, log } = fakeInit();
    const hooks = await OpenCodePlugin(init as never, { enableAdvisoryOutputAppend: true });
    expect(hooks).toHaveProperty("tool");
    expect(hooks).toHaveProperty("event");
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a warning via client.app.log for a type-mismatched option", async () => {
    const { init, log } = fakeInit();
    const hooks = await OpenCodePlugin(
      init as never,
      {
        enableAdvisoryOutputAppend: "yes",
      } as never,
    );
    expect(hooks).toHaveProperty("tool");
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0]![0] as { level: string; service: string; message: string };
    expect(entry.level).toBe("warn");
    expect(entry.service).toBe("justice");
    expect(entry.message).toContain("enableAdvisoryOutputAppend");
  });

  it("ignores unknown keys without warnings", async () => {
    const { init, log } = fakeInit();
    await OpenCodePlugin(init as never, { futureOption: 1 } as never);
    expect(log).not.toHaveBeenCalled();
  });

  it("accepts a missing options argument (unchanged 2.x behavior)", async () => {
    const { init, log } = fakeInit();
    const hooks = await OpenCodePlugin(init as never);
    expect(hooks).toHaveProperty("tool");
    expect(log).not.toHaveBeenCalled();
  });
});
