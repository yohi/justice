import type { Plugin } from "@opencode/plugin";
import JusticeV2PluginImpl from "./opencode-v2-plugin";

/**
 * Public type entry for `@yohi/justice/server` (types only; the runtime artifact is the
 * bundled `dist/opencode-v2-plugin.js`).
 *
 * The emitted declaration exposes only the default export typed as the SDK's
 * `Plugin.Plugin`, so NodeNext consumers do not traverse the internal V1 declaration
 * graph (extensionless relative imports, `@opencode-ai/plugin`). The value is the real
 * V2 entry, so tsc verifies the declared type against the implementation.
 */
const JusticeV2Plugin: Plugin.Plugin = JusticeV2PluginImpl;

export default JusticeV2Plugin;
