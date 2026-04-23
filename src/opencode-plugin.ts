import { JusticePlugin, createGlobalFs } from "./core/justice-plugin";
import { NodeFileSystem } from "./runtime/node-file-system";
import type { HookEvent, HookResponse } from "./core/types";

/**
 * OpenCode Plugin Entrypoint for Justice
 * 
 * This file provides a unified entrypoint for the OpenCode environment.
 * It manages a singleton instance of JusticePlugin and routes events appropriately.
 */

let pluginInstance: JusticePlugin | null = null;

async function getPlugin(): Promise<JusticePlugin> {
  if (pluginInstance) {
    return pluginInstance;
  }

  const root = process.cwd();
  const fileSystem = new NodeFileSystem(root);
  const globalFs = await createGlobalFs();

  pluginInstance = new JusticePlugin(fileSystem, fileSystem, {
    globalFileSystem: globalFs || undefined,
    // Note: In an OpenCode environment, logs are typically handled by the host.
    // We could pass a custom logger here if needed.
  });

  await pluginInstance.initialize();
  return pluginInstance;
}

/**
 * Unified hook handler for all OpenCode events.
 */
export default async function handleHook(event: HookEvent): Promise<HookResponse> {
  try {
    const plugin = await getPlugin();
    return await plugin.handleEvent(event);
  } catch (error) {
    // Fail-open: log error but don't break the agent's flow
    console.error("[JUSTICE] Plugin error:", error);
    return { action: "proceed" };
  }
}
