# HiraxCode

[![npm](https://img.shields.io/npm/v/@hirakoxx/cli.svg?label=%40hirakoxx%2Fcli)](https://www.npmjs.com/package/@hirakoxx/cli)
[![license](https://img.shields.io/npm/l/@hirakoxx/cli.svg)](https://github.com/kocakxs/HiraxCode/blob/main/LICENSE)

> An AI coding agent that lives in your terminal, built for **vibe coding**.
> Multi-provider, local models & **GGUF**, with settings right inside the TUI.

Built with **TypeScript + Ink** (React for the terminal), shipped as a single self-contained **Node.js** bundle. Bun is only used for development.

```
██╗  ██╗██╗██████╗  █████╗ ██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗
██║  ██║██║██╔══██╗██╔══██╗╚██╗██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝
███████║██║██████╔╝███████║ ╚███╔╝ ██║     ██║   ██║██║  ██║█████╗
██╔══██║██║██╔══██╗██╔══██║ ██╔██╗ ██║     ██║   ██║██║  ██║██╔══╝
██║  ██║██║██║  ██║██║  ██║██╔╝ ██╗╚██████╗╚██████╔╝██████╔╝███████╗
╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
```

## Features

- **18 providers** — OpenRouter, OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, **River AI**, FreeLLMAPI, Ollama, LM Studio, llama.cpp, local **GGUF**, and Custom (OpenAI-compatible).
- **Multiple API keys + auto-rotation** — store several keys per provider (comma-separated). When one is rejected (401/402/403) or hits its rate limit (429), HiraxCode automatically rotates to the next key mid-conversation.
- **Local GGUF, zero setup** — just point at a `.gguf` file. If `llama-server` is missing, HiraxCode **downloads** the official llama.cpp binary into `~/.cache/hiraxcode/bin` (Windows/macOS/Linux, x64 & arm64), then spawns it and waits until it is ready.
- **Image input (screenshots)** — attach a clipboard screenshot with `/paste`, `Alt+V`, or `Ctrl+V`, then send it to a vision model (GPT-4.1/4o, Claude, Gemini, LLaVA, Qwen2-VL, …). If the model can't read images, HiraxCode tells you and suggests the right ones (no cryptic errors).
- **Local vision** — GGUF models can accept images through a *multimodal projector* (`--mmproj`); set the **mmproj (vision)** field in `/settings`.
- **Cross-platform** — runs on Windows, macOS, and Linux. `run_bash` uses PowerShell on Windows and bash/zsh on macOS/Linux.
- **In-TUI settings** (`/settings`) — provider, API key, model, base URL, reasoning, temperature, max tokens, auto-approve, working dir, accent colour. Auto-saved.

### Temperature

Temperature controls how random the model's output is: `0` = deterministic and focused, higher = more varied and creative. Past ~`1.0` most models stop producing coherent text (you get word salad), so HiraxCode clamps it to **`0.00`–`1.00`** — the range that is safe across OpenAI, Anthropic and Gemini. The default is `0.20` (good for coding). Change it with `/temp 0.3` or in `/settings → Temperature`, which also shows a label (`precise` / `focused` / `balanced` / `creative`).
- **Model picker** (`/model`) — fetch models straight from the provider, filter, or type a custom one.
- **Clean TUI** — a two-tone gradient wordmark, an indented transcript (accent bar for the user, plain assistant text, per-tool icons for tool calls), a framed session header with token counters, a bordered composer with the active agent · model · provider underneath, rounded overlay panels, and markdown rendering (headings, lists, quotes, code blocks).
- **Mouse-wheel scrollback** — scroll the transcript with the wheel; `↑`/`↓` also work line by line.
- **Command palette** — type `/` for an interactive list: `↑`/`↓` move, `Tab` completes, `Enter` runs. Long lists scroll.
- **Message queue** — send another message while the agent is working; it is queued and sent automatically when the turn finishes (with an `N queued` indicator).
- **Accent themes** (`/theme`, default `#fab283`) plus **compact mode** (`/compact`) for small screens.
- **Agent loop** — thinking → tool call → approval → execution → repeat.
- **9 tools** — `read_file`, `list_dir`, `glob`, `edit_file`, `write_file`, `run_bash`, `http_request`, `port_scan` (service, version-banner and TLS certificate fingerprinting) and `cve_lookup` (NVD CVE matching by product and version).
- **Build mode** — the default agent works like a staff engineer on safety-critical software: explicit design, smallest correct diff, real verification, and a whole-tree codebase audit procedure.
- **Pentest mode** — a full attacker playbook: rules of engagement, seven phases from recon to reporting, SQL injection and injection tooling, CVE exploitation intelligence, and a complete toolkit.
- **Security review mode** — a read-only source audit that traces untrusted input to dangerous sinks and reports `file:line` with a fix. See [Agents](#agents).
- **Strict mode isolation** — one mode per session. Each agent declares its own `MODE:`, the base prompt defers to it, and a mode asked to do another mode's job hands off with `/agent` instead of drifting.
- **Approval system** — dangerous actions ask for `y`/`n` confirmation.
- **Multi-session** — session sidebar, history persisted to disk.
- **Single-file bundle** — `bun run build:npm` produces one self-contained Node file with **zero dependencies**; `bun run build` produces a native binary.

## Install

Requires **Node.js 20 or newer** — nothing else. The package has no dependencies.

```bash
npm install -g @hirakoxx/cli@latest

hiraxcode
```

Or run it without installing:

```bash
npx @hirakoxx/cli@latest
```

On first launch, open `/settings` to pick a provider and paste an API key. That's it — start chatting.

## Development

Bun is only needed to work on the source.

```bash
bun install           # or: npm install

cp .env.example .env  # optional — you can also set everything from /settings

bun run dev           # run it from source
```

Build the published npm bundle — a single self-contained Node file:

```bash
bun run build:npm     # -> dist/index.js
```

Build a native binary instead (embeds the Bun runtime, so it needs neither Node nor Bun at runtime):

```bash
bun run build        # -> dist/hiraxcode (current platform)

# Cross-compile for other platforms (from any OS):
bun run build:win    # -> dist/hiraxcode-win-x64.exe
bun run build:mac    # -> dist/hiraxcode-macos-arm64
bun run build:linux  # -> dist/hiraxcode-linux-x64
bun run build:all    # all of the above
```

Either artifact is self-contained. The npm bundle needs only Node; the native binary needs nothing at all.

## Providers

Every provider is selectable from `/settings → Provider`. Those needing an API key are under **Cloud**; the rest are **Local** (FreeLLMAPI is local but still wants its unified key).

| Provider | Env var | Default base URL |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| OpenAI | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| Anthropic | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` |
| Google Gemini | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com` |
| Groq | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` |
| DeepSeek | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |
| Mistral | `MISTRAL_API_KEY` | `https://api.mistral.ai/v1` |
| xAI (Grok) | `XAI_API_KEY` | `https://api.x.ai/v1` |
| Together | `TOGETHER_API_KEY` | `https://api.together.xyz/v1` |
| Fireworks | `FIREWORKS_API_KEY` | `https://api.fireworks.ai/inference/v1` |
| Cerebras | `CEREBRAS_API_KEY` | `https://api.cerebras.ai/v1` |
| FreeLLMAPI *(local router)* | `FREELLMAPI_API_KEY` | `http://localhost:3001/v1` |
| River AI | `RIVER_API_KEY` | `https://api.river.ai/v1` |
| Ollama *(local)* | — | `http://localhost:11434/v1` |
| LM Studio *(local)* | — | `http://localhost:1234/v1` |
| llama.cpp server *(local)* | — | `http://localhost:8080/v1` |
| **GGUF file** *(local)* | — | auto-spawns `llama-server` |
| Custom | — | your own |

All three wire protocols are implemented: **OpenAI-compatible**, **Anthropic Messages** (`/v1/messages` + tool-use blocks), and **Gemini** (`streamGenerateContent` + function calling).

### Running a local GGUF

1. **Nothing to install.** If `llama-server` isn't on your `PATH`, HiraxCode downloads an official llama.cpp build into `~/.cache/hiraxcode/bin/llama-server/` (Windows/macOS/Linux, x64 & arm64). If you already have one, it uses the one on `PATH`.
2. In the app: `/settings` → **Provider** → `GGUF file (local, auto-spawn)`.
3. Set **GGUF file** to the model path, e.g. `/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf`.
4. (Optional, for vision models) set **mmproj (vision)** to the model's `.mmproj` companion file.
5. Send a message. HiraxCode spawns `llama-server` (with `--jinja` so tool-calling works), picks a free port, and shuts it down when you exit.

If you already run your own server (`llama-server`, Ollama, LM Studio), just pick the matching **local** provider — no spawning needed.

### FreeLLMAPI (one endpoint, many free providers)

[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) runs a local router on port `3001` that stacks ~34 free provider tiers behind a single OpenAI-compatible `/v1` endpoint, with its own failover and key rotation.

1. Start it (desktop installer from its Releases page, or `docker compose up`). Open `http://localhost:3001`, add your upstream provider keys, and copy the unified **`freellmapi-…`** key.
2. In HiraxCode: `/settings` → **Provider** → `FreeLLMAPI (local router)`, then set **API key(s)** to that unified key.
3. Pick a model: `auto` (router picks), `auto:fast`, `auto:smart`, or any model id it lists (run `/model` to refresh the list from `/v1/models`).

HiraxCode's own multi-key rotation stacks with it: put several unified keys (comma-separated) and they rotate on `401/402/403/429` too.

### Sending images / screenshots

1. Copy a screenshot (Windows: `Win+Shift+S`; macOS: `Cmd+Ctrl+Shift+4`; Linux: use `xclip`/`wl-paste`).
2. In HiraxCode press `Alt+V` (or `Ctrl+V` when your terminal passes it through) or run `/paste`. A `▣ 1 image attached` indicator appears.
3. Send the message. HiraxCode converts the image to the right format per provider:
   - OpenAI-compatible → `image_url` data-URI
   - Anthropic → base64 `image` block
   - Gemini → `inlineData`
4. `/drop` to cancel attachments.

You can also attach an image **from a file**:

- `/paste <path>` or `/file <path>` — e.g. `/file C:\shots\bug.png`.
- Copy a file in your file manager and press `Alt+V` — images are attached; other files have their path inserted into the prompt.
- Drag a file onto the terminal (which types its path) and press `Enter` — any image path in your message is attached automatically.

The model must be **vision-capable**. If it isn't, HiraxCode refuses to send and suggests models (e.g. `/model gpt-4.1`, `/model llava`). For local GGUF, set **mmproj** first to enable vision.

## Usage

| Key | Action |
|---|---|
| `Enter` | Send message (queued while the agent is running) |
| `Tab` | Open/focus the session sidebar |
| `Ctrl+V` / `Alt+V` | Attach an image (or file) from the clipboard |
| `Ctrl+B` | Toggle sidebar |
| `/` | Open the command palette (`↑`/`↓` to move, `Tab` to complete) |
| `Mouse wheel` | Scroll the transcript |
| `↑` / `↓` | Scroll the transcript line by line (*or* navigate menu/sidebar when active) |
| `Ctrl+P` / `Ctrl+N` | Previous / next input history |
| `←` / `→` | Change a value in Settings |
| `y` / `n` | Approve / deny a tool call |
| `Esc` | Close overlay / go back |
| `Ctrl+C` | Quit (from any screen) |

### Slash commands

| Command | Action |
|---|---|
| `/settings` | Open settings (provider, key, model, …) |
| `/provider` | Switch provider |
| `/model` | Pick / type a model |
| `/agent [id]` | Switch agent (build / plan / pentest / security / custom) |
| `/pentest` | Jump straight to the Pentest agent |
| `/paste [path]` | Attach a clipboard image, or a file by path |
| `/file <path>` | Attach an image file |
| `/drop` | Clear image attachments |
| `/new` | New session |
| `/clear` | Clear the conversation |
| `/sessions` | Toggle the session sidebar |
| `/cd <path>` | Change the working directory |
| `/reasoning` | Toggle thinking |
| `/temp <0-1>` | Set the temperature (creativity) |
| `/compact` | Toggle compact mode (denser transcript) |
| `/yolo` | Toggle auto-approve for **all** tools (no confirmation prompts) |
| `/theme` | Cycle the accent colour |
| `/help` | Help |
| `/exit` | Quit |

## Tools

| Tool | Action | Approval? |
|---|---|---|
| `read_file` | Read a file (supports `offset`/`limit`) | no |
| `list_dir` | List a folder's contents | no |
| `glob` | Find files by pattern | no |
| `edit_file` | Replace an exact span of text | **yes** |
| `write_file` | Create / overwrite a file | **yes** |
| `run_bash` | Run a shell command (PowerShell on Windows, bash/zsh on macOS/Linux) | **yes** |
| `http_request` | Send an HTTP/HTTPS request and inspect status, headers, body (web probing) | no |
| `port_scan` | TCP-connect scan with service label, version banner and TLS certificate fingerprinting | **yes** |
| `cve_lookup` | Look up published CVEs for a product/version in the NIST NVD, with CVSS vectors and references | no |

## Agents

Four built-in agents, selectable with `/agent <id>`, `/pentest`, or the agent picker:

- **Build** (`build`, default) — works like a staff engineer on safety-critical software. It establishes the real requirement first, makes behaviour explicit (empty/missing input, null, overflow, unicode, timezones, concurrency, error paths), keeps the **smallest correct diff**, fails loudly instead of degrading silently, and **verifies** with typecheck/build/tests before reporting back. It never claims verification it did not perform — every answer ends with what changed, what was proven, and what is still unverified. When you ask it to review or "check everything", it **walks the whole tree instead of sampling**: map the modules and entry points, read every source file, work a fixed checklist (correctness, error handling, resource lifecycle, concurrency, input validation, dead code, duplication, docs vs behaviour, test quality), report `severity · file:line · why it matters · fix`, then fix in small verified batches with a regression test per bug.
- **Plan** (`plan`) — read-only exploration. Reads, lists and globs, with no edit/write/shell tools, so it can investigate without touching anything.
- **Pentest** (`pentest`) — for **authorised** engagements, a seven-phase operator playbook: scope & evidence folder → passive recon (DNS/AXFR, certificate transparency, TLS metadata, exposed files, stack fingerprinting) → active scan with version → CVE mapping → per-service enumeration (web routes and parameters, GraphQL, SMB/RPC, SSH/FTP, data stores, Docker/kubelet/etcd, SNMP/NFS) → vulnerability classes ordered by real-world yield (broken access control/IDOR first, then authn & JWT, injection, file handling, SSRF/smuggling/cache poisoning, client-side, deserialisation, secrets, business logic) → exploitation and privilege escalation (runnable PoCs, Linux and Windows privesc, pivoting only when in scope, artefact cleanup) → `findings.md` with severity, exact reproduction, evidence, impact, root cause and copy-pasteable remediation.
  It is **non-destructive by default** — no DoS, no destructive writes, no bulk exfiltration — and proves impact with the minimum action. Findings stay labelled `confirmed`, `likely` or `unverified`.
  Reconnaissance is treated as a starting point, not a result: the agent attacks with every class of technique in whatever order the target rewards — enumeration, **SQL injection** (boolean, error-based, time-based and UNION, plus NoSQL/LDAP/XPath/ORM/second-order variants, hand-verified before any `sqlmap -r` run), authentication and authorisation attacks, credential attacks, misconfiguration, exploit development and post-exploitation. For **CVE work** it calls `cve_lookup` with the product and version observed by `port_scan`, which queries the NIST NVD, filters by the real CPE version ranges, and returns CVSS severity, score and vector, so a banner becomes a checkable vulnerability instead of a guess.
- **Security** (`security`) — a **read-only** source audit: maps entry points and trust boundaries, traces untrusted input to dangerous sinks (SQL, shell, filesystem, template, deserialiser, HTTP client, logger) and reports `file:line` with the exploitable path, a concrete fix, and a prioritised fix order. No write/edit tools.

The security agents answer directly — they assume an authorised engagement and won't bury you in caveats. Point them at targets you own or are permitted to test: `port_scan` and `run_bash` require approval (unless you turn on `/yolo`), `http_request` is read-only and runs immediately.

**Modes do not mix.** Exactly one mode is active per session and it declares itself at the top of the system prompt (`MODE: BUILD`, `MODE: PENTEST`, `MODE: SECURITY REVIEW`, `MODE: PLAN`, `MODE: GENERAL`). The base prompt defers to that declaration, so:
- Build and Plan stay on software: they will not drift into payloads or exploitation.
- Pentest and Security stay on the engagement: they will not turn into product feature work.
- If you ask a mode for another mode's job, it names the right agent and tells you to switch with `/agent` instead of quietly changing role.

Switching with `/agent <id>`, `/pentest` or `/plan` starts a fresh system prompt, so the previous mode's instructions are gone rather than stacked.

Example:

```
/pentest
Scan 10.0.0.5 for open ports, fingerprint the services, then probe the web server on whatever ports you find
```

## Configuration

Two layers:

1. **`.env`** — default keys & environment (see `.env.example`).
2. **`~/.config/hiraxcode/config.json`** — written automatically whenever you change anything via `/settings`. Takes precedence over `.env`.

Main `.env` variables:

| Variable | Default | Description |
|---|---|---|
| `HIRAX_PROVIDER` | `openrouter` | Active provider |
| `MODEL` | per-provider | Default model |
| `<PROVIDER>_API_KEY` | — | Per-provider API key (comma-separate several to rotate) |
| `BASE_URL` | per-provider | Override the base URL |
| `GGUF_PATH` | — | Path to a `.gguf` file |
| `MMPROJ_PATH` | — | Path to a `.mmproj` file (vision for GGUF) |
| `LLAMA_SERVER_BIN` | `llama-server` | llama.cpp binary |
| `TEMPERATURE` | `0.2` | 0–2 |
| `MAX_TOKENS` | `0` | 0 = auto |
| `ENABLE_REASONING` | `true` | Thinking stream |
| `REASONING_EFFORT` | `medium` | `low`/`medium`/`high` |
| `AUTO_APPROVE_SAFE_TOOLS` | `true` | Run read-only tools without confirmation |
| `AUTO_APPROVE_ALL` | `false` | Skip confirmation for **every** tool — writes, shell, scans |
| `WORKING_DIR` | cwd | Agent working root |
| `SHOW_SIDEBAR` | `false` | Show the sidebar on start |
| `HIRAX_COMPACT` | `false` | Compact mode (denser transcript) |
| `HIRAX_MINIMAL` | `false` | Hide thinking blocks & inter-message spacing |
| `ACCENT` | `#fab283` | UI accent colour (also `gold`, `cyan`, `violet`, `emerald`, …) |
| `DEBUG` | `false` | Log to stderr |

## Architecture

```
src/
├── index.tsx                  # entry point, llama-server cleanup
├── core/
│   ├── providers.ts           # 18-provider registry + metadata
│   ├── settings.ts            # load/save settings (env + config.json)
│   ├── vision.ts              # detect image-capable models
│   ├── detect.ts              # detect local runtimes (ollama/lmstudio/llama.cpp)
│   └── types.ts
├── providers/
│   ├── types.ts               # Provider + StreamEvent interfaces
│   ├── openai.ts              # OpenAI-compatible (most + local)
│   ├── anthropic.ts           # Anthropic Messages + tool use
│   ├── gemini.ts              # Gemini streamGenerateContent
│   ├── llama.ts               # spawn/health-check llama-server (GGUF)
│   ├── ollama.ts, lmstudio.ts # local runtime spawn helpers
│   ├── models.ts              # list models per provider
│   └── index.ts               # createProvider() factory
├── agent/
│   ├── prompt.ts, tools.ts, tool-registry.ts, tool-schema.ts, loop.ts
├── store/sessions.ts
├── ui/
│   ├── App.tsx                # state, screen routing, slash commands, keys
│   ├── theme.ts               # design system (hex palette)
│   ├── lib/
│   │   ├── text.ts            # width/truncate/wrap/wrapCode helpers
│   │   └── markdown.tsx       # inline markdown parse + render
│   └── components/            # Banner, Sidebar, MessageList, InputBox,
│                              # Header, Home, StatusBar, CommandMenu,
│                              # ListPicker, TextField, TextInput,
│                              # SettingsScreen, HelpScreen, CustomProviderForm
└── utils/                     # runtime (Node spawn/which/ports/sleep),
                               # logger, helpers, color, binaries (auto-download),
                               # clipboard (cross-platform image/file reading)
```

Agent flow: **user → streamed answer/thinking → tool call → approval → execution → result back to the model → repeat → final answer**.

## Testing

```bash
bun test           # test suite
bun run typecheck  # typecheck (0 errors)
bun run build:npm  # build the published Node bundle
```

Coverage includes: tools (including `http_request` & `port_scan`), the agent loop, built-in agents (build/plan/pentest/security), OpenAI/Anthropic/Gemini wire formats (against a mock SSE server), image sending for every wire format, vision-model detection, Gemini tool-schema sanitization, approvals, provider errors surfaced in the chat, settings persistence, and UI rendering. No API key required.

## Troubleshooting

- **`Raw mode is not supported on the current process.stdin`** — Ink needs an interactive terminal. Run `hiraxcode` directly in a terminal (not through a pipe/CI/`nohup`). If you really must force it, set `HIRAX_FORCE_TTY=1`.
- **Provider returns `400 INVALID_ARGUMENT` (Gemini) about `additionalProperties` / `type`** — already fixed: tool schemas are normalized to Gemini's `functionDeclarations` format. Update to the latest version.
- **No response at all** — providers return errors that now show up in the chat as `⚠️ API ...`. Read the message; it's usually a wrong/empty API key or a missing model.
- **`Cannot find package 'ink'` / missing modules** — only relevant when running from source: run `bun install` (or `npm install`) in the repo. The published npm bundle is fully self-contained and pulls in no dependencies.
- **`node: command not found` / old Node** — HiraxCode needs **Node.js 20+**. Check with `node -v`. (Bun is not required.)
- **Installed the old name?** — the `hiraxcode` package is superseded by `@hirakoxx/cli`: `npm uninstall -g hiraxcode && npm i -g @hirakoxx/cli@latest`.
- **Provider says "no API key"** — open `/settings`, pick the provider, paste the API key.
- **`API 500: tools param requires --jinja flag` (GGUF)** — handled automatically: HiraxCode runs `llama-server` with `--jinja`. If you set `llama-server args` yourself, don't add `--no-jinja` (or add `--jinja`). Update to the latest version.
- **`llama-server not found`** — HiraxCode downloads llama.cpp automatically; if that fails (e.g. no internet), install it manually and set **llama-server** in `/settings` to the binary path.
- **Model can't read images** — use a vision model (GPT-4.1/4o, Claude, Gemini, LLaVA, Qwen2-VL). For local GGUF, set **mmproj** in `/settings`.
- **`/paste` says "no image in clipboard"** — make sure you copied a screenshot, not text. On Linux you need `xclip` (X11) or `wl-paste` (Wayland).
- **`Ctrl+V` does nothing** — some terminals (e.g. VS Code) capture `Ctrl+V` for their own paste. Use `Alt+V` or `/paste` instead.
- **Image not sent** — if the model is text-only, HiraxCode withholds the send and suggests models; press `/drop` to send text only.
- **Local model missing** — make sure the local server is running (Ollama/LM Studio/llama.cpp), then `/model`.
- **Logs** — `~/.local/state/hiraxcode/hiraxcode.log`.
- **Sessions** — `~/.local/share/hiraxcode/sessions/*.json`.
- **Settings** — `~/.config/hiraxcode/config.json`.

## Roadmap

- [ ] Diff preview before applying edits
- [ ] Syntax highlighting
- [ ] Subagents / parallel tasks
- [ ] MCP support
- [ ] Full themes (not just an accent)
- [ ] Per-provider cost & token tracking

## Development

Questions, ideas, or bug reports — reach the developer on Telegram: **[@hirakox](https://t.me/hirakox)**.

## License

MIT
