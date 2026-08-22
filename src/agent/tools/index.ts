import { clipboardReadTool, clipboardWriteTool } from "./clipboard";
import { appendFileTool, deleteFileTool, listDirTool, readFileTool, writeFileTool } from "./fs";
import { grepFilesTool } from "./grep";
import { rememberTool, recallTool, searchMemoryTool } from "./memory";
import { notifyTool } from "./notify";
import { openPathTool, openUrlTool } from "./open";
import { ToolRegistry } from "./registry";
import { runCommandTool } from "./shell";
import { datetimeTool, systemInfoTool } from "./system";
import { fetchUrlTool, webSearchTool } from "./web";

export function createStandardRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    systemInfoTool,
    datetimeTool,
    listDirTool,
    readFileTool,
    writeFileTool,
    appendFileTool,
    deleteFileTool,
    grepFilesTool,
    runCommandTool,
    openUrlTool,
    openPathTool,
    clipboardReadTool,
    clipboardWriteTool,
    rememberTool,
    recallTool,
    searchMemoryTool,
    notifyTool,
    fetchUrlTool,
    webSearchTool,
  ]) {
    registry.register(tool);
  }
  return registry;
}
