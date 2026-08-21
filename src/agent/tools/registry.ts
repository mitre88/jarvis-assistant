import type { ToolSpec } from "../types";
import type { ToolContext } from "./context";

export interface ToolDef extends ToolSpec {
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  specs(): ToolSpec[] {
    return [...this.tools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  /** Execute a tool call. Errors are captured and returned to the model. */
  async execute(name: string, argsJson: string, ctx: ToolContext): Promise<ToolOutcome> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    let args: Record<string, unknown>;
    try {
      args = argsJson.trim() === "" ? {} : (JSON.parse(argsJson) as Record<string, unknown>);
    } catch {
      return { content: `Invalid JSON arguments for ${name}`, isError: true };
    }
    try {
      return { content: await tool.execute(args, ctx), isError: false };
    } catch (err) {
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}
