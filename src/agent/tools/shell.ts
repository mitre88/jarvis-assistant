import { spawn } from "node:child_process";
import { optionalNumber, optionalString, requireString } from "./args";
import { classifyCommand } from "./command-safety";
import type { ToolContext } from "./context";
import type { ToolDef } from "./registry";
import { resolveSafe } from "./sandbox";

const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 120;
const OUTPUT_CAP_BYTES = 64 * 1024;

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{ code: number | null; output: string; truncated: boolean; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd, windowsHide: true });
    let output = "";
    let truncated = false;
    let timedOut = false;
    const capture = (chunk: Buffer) => {
      if (output.length >= OUTPUT_CAP_BYTES) {
        truncated = true;
        return;
      }
      output += chunk.toString("utf8").slice(0, OUTPUT_CAP_BYTES - output.length);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, truncated, timedOut });
    });
  });
}

export const runCommandTool: ToolDef = {
  name: "run_command",
  description:
    "Run a shell command on the user's machine. Read-only commands (ls, cat, git status…) run directly; anything that could modify the system requires the user's approval first. Output is capped at 64 KB.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command line to run." },
      cwd: {
        type: "string",
        description: "Working directory (must be inside the workspace). Defaults to home.",
      },
      timeout_seconds: {
        type: "number",
        description: `Timeout in seconds (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S}).`,
      },
    },
    required: ["command"],
  },
  async execute(args, ctx: ToolContext) {
    const command = requireString(args, "command");
    const cwdArg = optionalString(args, "cwd");
    const cwd = cwdArg ? resolveSafe(cwdArg, ctx.roots, ctx.home) : ctx.home;
    const timeoutS = Math.min(optionalNumber(args, "timeout_seconds") ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S);

    if (classifyCommand(command) === "needs-confirmation") {
      const approved = await ctx.confirm({
        title: "Run this command?",
        detail: command,
      });
      if (!approved) return "The user declined to run the command. Do not retry unless asked.";
    }

    const result = await runShell(command, cwd, timeoutS * 1000);
    const parts: string[] = [];
    if (result.timedOut) parts.push(`(killed after ${timeoutS}s timeout)`);
    parts.push(`exit code: ${result.code ?? "killed"}`);
    parts.push(result.output.trim() || "(no output)");
    if (result.truncated) parts.push("… output truncated at 64 KB");
    return parts.join("\n");
  },
};
