import * as os from "node:os";
import type { ToolDef } from "./registry";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export const systemInfoTool: ToolDef = {
  name: "system_info",
  readOnly: true,
  description:
    "Report on the host machine: OS, version, hostname, architecture, CPU, memory, uptime, and the user's home directory.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    const info = {
      platform: os.platform(),
      release: os.release(),
      hostname: os.hostname(),
      arch: os.arch(),
      cpus: os.cpus()[0]?.model ?? "unknown",
      cores: os.cpus().length,
      memory_total_gb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      memory_free_gb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
      uptime: formatUptime(os.uptime()),
      home: os.homedir(),
      user: os.userInfo().username,
    };
    return JSON.stringify(info, null, 2);
  },
};

export const datetimeTool: ToolDef = {
  name: "datetime",
  readOnly: true,
  description: "Current local date, time, timezone, and UTC offset.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    return JSON.stringify(
      {
        local: now.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "medium" }),
        iso: now.toISOString(),
        timezone: tz,
        utc_offset: offset,
      },
      null,
      2
    );
  },
};
