import type { Plugin, PluginModule } from "@opencode-ai/plugin";

export interface BigLittleOptions {
  minLines?: unknown;
  bulkReaderModel?: string;
  codeWriterModel?: string;
}

export const BigLittlePlugin: Plugin = async () => {
  return {};
};

export default { id: "big-little", server: BigLittlePlugin } satisfies PluginModule;
