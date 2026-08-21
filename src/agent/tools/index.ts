import { clipboardReadTool, clipboardWriteTool } from "./clipboard";
import { listDirTool, readFileTool, writeFileTool } from "./fs";
import { rememberTool, recallTool } from "./memory";
import { notifyTool } from "./notify";
import { openPathTool, openUrlTool } from "./open";
import { ToolRegistry } from "./registry";
import { runCommandTool } from "./shell";
import { datetimeTool, systemInfoTool } from "./system";

export function createStandardRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    systemInfoTool,
    datetimeTool,
    listDirTool,
    readFileTool,
    writeFileTool,
    runCommandTool,
    openUrlTool,
    openPathTool,
    clipboardReadTool,
    clipboardWriteTool,
    rememberTool,
    recallTool,
    notifyTool,
  ]) {
    registry.register(tool);
  }
  return registry;
}
