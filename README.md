# Jarvis

A local desktop AI assistant for Windows and macOS. Dark HUD, dry wit, real tools, voice.

Jarvis is **bring-your-own-model**: you point it at OpenAI, Anthropic, any
OpenAI-compatible endpoint (Groq, Together, custom gateways), or a local model
served by Ollama or LM Studio. The app ships no API keys and phones home to
no one — the only network traffic is to the provider you configure (and,
optionally, Hugging Face when you download a Whisper model).

Beyond chat, Jarvis runs a tool-calling agent loop in the Electron main
process. The model can inspect the system, read and write files in your home
directory, run shell commands, manage the clipboard, open URLs and files, keep
durable notes, and send native notifications — with your explicit approval for
anything that mutates state.

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

macOS packages request microphone access and include entitlements for the
native Whisper addon. Grant the prompt the first time you click the orb.

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
performs a live request against the provider's model listing endpoint and
reports what it finds. Tool calling must be supported by the model you choose;
small local models vary in how well they use tools.

For local providers: start Ollama (`ollama serve`, then `ollama pull llama3.2`)
or LM Studio's local server first.

## Voice

The reactor orb in the composer is the voice control.

**Local Whisper (default)** — offline, private. Click the orb to start
auto-listen (VAD-driven turn taking). Hold the orb for push-to-talk. Jarvis
transcribes on this machine with `whisper.cpp`, then runs the same agent loop
as typed chat. Replies are spoken via the system TTS when that setting is on.

Download a ggml model from Settings (catalog hosted by
[whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp)),
or point it at a `.bin` you already have. `base.en` is the recommended first
download.

**OpenAI Realtime (optional)** — voice-to-voice, lowest latency. Shown when
the provider is OpenAI-compatible, the base URL is `api.openai.com`, and an
API key is stored. The real key never leaves the main process: it mints an
ephemeral client secret, and the renderer opens a WebRTC session to
`gpt-realtime`. Tool calls from that session go through the same registry and
approval dialogs as the local loop.

Switch engines in Settings → Voice input.

## Where things live

- **API keys** — encrypted with the OS keychain via Electron `safeStorage`
  (Keychain on macOS, DPAPI on Windows) and stored in the app's user-data
  directory. Never in the repo, never in tracked files. If the OS provides no
  encryption backend (some bare Linux setups), the key is stored base64-encoded
  without encryption — treat that machine accordingly.
- **Preferences** (provider, base URL, model, TTS, voice engine) — plain JSON
  in the user-data directory.
- **Whisper models** — ggml files under `whisper-models/` in the same place.
- **Memory** (`remember`/`recall` notes) — a small JSON file in the same place.

## Security model

- **Path sandbox**: file tools (`list_dir`, `read_file`, `write_file`,
  `open_path`) resolve every path — including `..` and symlinks — and refuse
  anything outside your home directory.
- **Write confirmation**: every `write_file` shows an in-app approval dialog
  stating the path and whether it's a create or an overwrite.
- **Shell confirmation**: `run_command` runs provably read-only commands
  (`ls`, `cat`, `git status`, …) directly; anything else — unknown binaries,
  redirects, `rm`, `sudo`, command substitution — requires your approval.
  Commands are killed after a timeout and output is capped at 64 KB.
- **Iteration cap**: the agent loop stops after a fixed number of tool rounds.
- **Renderer isolation**: context isolation and a sandboxed renderer; the UI
  talks to the system only through a narrow preload bridge. API keys never
  reach the renderer. Realtime sessions use a short-lived client secret.

## Keyboard

- `Ctrl+Enter` / `Cmd+Enter` — send
- `Ctrl+Shift+Space` / `Cmd+Shift+Space` — toggle voice (works from the tray)
- `Esc` — deny an open confirmation, stop speech / cancel an in-flight run,
  close settings, or hide to tray

The tray icon toggles the window; quitting is in the tray menu.

## Architecture

```
src/
  main/       Electron main: window, tray, IPC host, prefs, keychain, voice
  preload/    contextBridge — the only door between UI and system
  renderer/   vanilla TS HUD: orb, chat, settings, toasts, TTS, Realtime
  agent/      provider clients, tool-calling loop, Realtime session payload
  shared/     types + provider defaults + Realtime event helpers
tests/        node:test — sandbox, providers, loop, tools, VAD, models, Realtime
```

Providers are called with `fetch`. Streaming is parsed by hand (SSE / NDJSON).
Storage is JSON plus `safeStorage`. Tools never import Electron; they receive
injected capabilities, which is what makes them testable. Local STT uses
`whisper-cpp-node` (Metal on Apple Silicon, Vulkan on Windows).

## License

[MIT](LICENSE)
