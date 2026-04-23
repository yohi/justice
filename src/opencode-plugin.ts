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
let pluginInitPromise: Promise<JusticePlugin> | null = null;

async function getPlugin(): Promise<JusticePlugin> {
  if (pluginInstance) {
    return pluginInstance;
  }

  if (pluginInitPromise) {
    return pluginInitPromise;
  }

  pluginInitPromise = (async () => {
    try {
      const root = process.cwd();
      const fileSystem = new NodeFileSystem(root);
      const globalFs = await createGlobalFs();

      const instance = new JusticePlugin(fileSystem, fileSystem, {
        globalFileSystem: globalFs || undefined,
      });

      await instance.initialize();
      pluginInstance = instance;
      return instance;
    } catch (error) {
      // Re-throw so callers can handle the initial failure
      throw error;
    } finally {
      // Clear the init promise so that future calls can retry if it failed,
      // or simply rely on pluginInstance if it succeeded.
      pluginInitPromise = null;
    }
  })();

  return pluginInitPromise;
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
