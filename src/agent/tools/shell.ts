import { spawn } from "node:child_process";
import { optionalNumber, optionalString, requireString } from "./args";
import { classifyCommand } from "./command-safety";
import type { ToolContext } from "./context";
import { throwIfAborted } from "./context";
import type { ToolDef } from "./registry";
import { resolveSafe } from "./sandbox";

const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 120;
const OUTPUT_CAP_BYTES = 64 * 1024;

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ code: number | null; output: string; truncated: boolean; timedOut: boolean; cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ code: null, output: "", truncated: false, timedOut: false, cancelled: true });
      return;
    }
    const child = spawn(command, { shell: true, cwd, windowsHide: true });
    let output = "";
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
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
    const onAbort = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, output, truncated, timedOut, cancelled });
    });
  });
}

export const runCommandTool: ToolDef = {
  name: "run_command",
  description:
    "Run a shell command on the user's machine. Read-only commands (ls, cat, git status…) run directly; anything that could modify the system requires the user's approval first. Output is capped at 64 KB. Cancelled if the user presses Stop.",
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
    throwIfAborted(ctx);
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

    throwIfAborted(ctx);
    const result = await runShell(command, cwd, timeoutS * 1000, ctx.signal);
    if (result.cancelled) return "Cancelled by the user.";
    const parts: string[] = [];
    if (result.timedOut) parts.push(`(killed after ${timeoutS}s timeout)`);
    parts.push(`exit code: ${result.code ?? "killed"}`);
    parts.push(result.output.trim() || "(no output)");
    if (result.truncated) parts.push("… output truncated at 64 KB");
    return parts.join("\n");
  },
};
