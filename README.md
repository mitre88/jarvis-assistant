# Jarvis

A local desktop AI assistant for Windows and macOS. Dark HUD, dry wit, real tools.

Jarvis is **bring-your-own-model**: you point it at OpenAI, Anthropic, any
OpenAI-compatible endpoint (Groq, Together, custom gateways), or a local model
served by Ollama or LM Studio. The app ships no API keys and phones home to
no one — the only network traffic is to the provider you configure, plus
optional web tools (`web_search` / `fetch_url`) when the model uses them.

Beyond chat, Jarvis runs a tool-calling agent loop in the Electron main
process. The model can inspect the system, search and edit files in your
workspace, run shell commands, search the public web, manage the clipboard,
open URLs and files, keep durable notes, and send native notifications — with
your explicit approval for anything that mutates state.

## Run it

Requires Node.js 20+.

```bash
npm install
npm test     # unit tests (no network, no display needed)
npm start    # build + launch the app
```

Works the same on Windows (PowerShell/cmd) and macOS.

### Package installers

```bash
npm run pack      # unpacked build in release/ for a quick look
npm run dist      # installer for the current platform (NSIS on Win, DMG on Mac)
npm run dist:all  # both platforms (cross-building a mac DMG requires macOS)
```

## Connect your model

Open **Settings** (top right; it opens automatically on first run) and pick a
provider:

| Provider | Base URL | Key | Model examples |
|---|---|---|---|
| OpenAI-compatible | `https://api.openai.com` | required | `gpt-4o-mini` |
| — Groq | `https://api.groq.com/openai` | required | `llama-3.3-70b-versatile` |
| — Together, custom | your endpoint | as needed | whatever it serves |
| Anthropic | `https://api.anthropic.com` | required | `claude-sonnet-4-5` |
| Ollama | `http://127.0.0.1:11434` | none | `llama3.2`, `qwen3` |
| LM Studio | `http://127.0.0.1:1234` | none | model id from LM Studio |

A trailing `/v1` in the base URL is tolerated and stripped. **Test connection**
performs a live request against the provider's model listing endpoint, reports
what it finds, and fills the model dropdown. Tool calling must be supported by
the model you choose; small local models vary in how well they use tools.

For local providers: start Ollama (`ollama serve`, then `ollama pull llama3.2`)
or LM Studio's local server first.

## What Jarvis can do

| Tool | Role |
|---|---|
| `system_info`, `datetime` | Host facts, local clock |
| `list_dir`, `read_file`, `grep_files` | Browse and search the workspace |
| `write_file`, `append_file`, `delete_file`, `move_file` | Edit files (approval required) |
| `run_command` | Shell (read-only allowlist; mutations need approval; Stop kills the process) |
| `web_search`, `fetch_url` | Public web search (DuckDuckGo) and page fetch; private/local IPs blocked |
| `open_url`, `open_path` | Browser / default app (executables need approval) |
| `clipboard_read`, `clipboard_write` | Clipboard (writes need approval) |
| `remember`, `recall`, `search_memory` | Durable notes, newest first |
| `notify` | Native desktop notification |

Conversations persist across restarts (sidebar). Extra workspace roots and the
tool-round budget (1–32, default 8) live in Settings.

## Where things live

- **API keys** — encrypted with the OS keychain via Electron `safeStorage`
  (Keychain on macOS, DPAPI on Windows) and stored in the app's user-data
  directory. Never in the repo, never in tracked files. If the OS provides no
  encryption backend (some bare Linux setups), the key is stored base64-encoded
  without encryption — treat that machine accordingly.
- **Preferences** (provider, base URL, model, TTS, extra roots, tool rounds) —
  plain JSON in the user-data directory.
- **Sessions** — one JSON file per conversation under `sessions/` in user-data.
  The newest durable notes are injected into the system prompt at the start of
  each run.
- **Memory** (`remember` / `recall` notes) — a small JSON file in the same place.

## Security model

- **Path sandbox**: file tools resolve every path — including `..` and
  symlinks — and refuse anything outside your home directory or extra roots.
- **Write confirmation**: `write_file`, `append_file`, `delete_file`, and `move_file` show
  an in-app approval dialog. Pending confirms time out after 60 seconds (deny).
- **Shell confirmation**: `run_command` runs provably read-only commands
  (`ls`, `cat`, `git status`, …) directly; anything else — unknown binaries,
  redirects, `rm`, `sudo`, command substitution — requires your approval.
  Commands are killed after a timeout, on Stop, and output is capped at 64 KB.
- **Web SSRF guard**: `fetch_url` / `web_search` refuse `file:`, localhost,
  private, and link-local addresses (including after DNS).
- **Clipboard / executables**: replacing the clipboard or opening an
  executable requires approval.
- **Iteration cap**: the agent loop stops after a configurable number of tool
  rounds, then asks the model for a final reply with tools disabled.
- **Context trim**: only the last 16 user turns go to the model; oversized
  tool results are clipped so file dumps do not grow the window without bound.
- **Renderer isolation**: context isolation and a sandboxed renderer; the UI
  talks to the system only through a narrow preload bridge. API keys never
  reach the renderer.

## Keyboard

- `Ctrl+Enter` / `Cmd+Enter` — send
- `Ctrl+Shift+J` / `Cmd+Shift+J` — summon or hide Jarvis from anywhere
- `Esc` — deny an open confirmation, close settings, or hide to tray
- `Enter` — approve the focused confirmation dialog
- **Retry** on an error bubble re-sends the last prompt (provider 429/5xx are also retried automatically)

The tray icon toggles the window; quitting is in the tray menu. Optional
text-to-speech for replies can be enabled in Settings.

Voice *input* is deliberately not included: Chromium's speech recognition
needs Google API keys inside Electron, and shipping a broken mic helps no one.

## Architecture

```
src/
  main/       Electron main: window, tray, IPC host, prefs, sessions, keychain
  preload/    contextBridge — the only door between UI and system
  renderer/   vanilla TS HUD: chat feed, session sidebar, settings, toasts, TTS
  agent/      provider clients (OpenAI-compatible, Anthropic, Ollama),
              the tool-calling loop, context trim, and the tool registry
  shared/     types + provider defaults shared across processes
tests/        node:test suites: sandbox, tools, loop, context, sessions, web
```

Zero runtime dependencies — providers are called with `fetch`, streaming is
parsed by hand (SSE / NDJSON), storage is JSON plus `safeStorage`. Tools never
import Electron; they receive injected capabilities, which is what makes them
testable.

## License

[MIT](LICENSE)
