import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import type {
  AgentStatus,
  ApprovalRequest,
  Message,
  MessageImage,
  Session,
  ToolCall,
  Usage,
} from "@/core/types";
import {
  getProvider,
  providerGroups,
  modelsForProvider,
  modelHint,
  registerCustomProviders,
} from "@/core/providers";
import { supportsVision, visionHint } from "@/core/vision";
import { refreshCatalog } from "@/core/catalog";
import {
  agentSystemPrompt,
  loadAgents,
  resolveAgent,
  selectableAgents,
  toolsForAgent,
  type AgentDef,
} from "@/core/agents";
import { allTools } from "@/agent/tools";
import {
  ACCENTS,
  clampTemperature,
  customToDef,
  getApiKey,
  getApiKeys,
  loadSettings,
  saveSettings,
  configPath,
  type CustomProvider,
  type Settings,
} from "@/core/settings";
import { AgentLoop, type AgentEvent } from "@/agent/loop";
import { SYSTEM_PROMPT } from "@/agent/prompt";
import { SessionStore } from "@/store/sessions";
import { createProvider, ensureLlamaServer, fetchModels, type ResolvedProvider } from "@/providers";
import { deriveTitle } from "@/utils/helpers";
import {
  readClipboardImage,
  readClipboardFiles,
  readImageFile,
  imagesInText,
  imageMimeFor,
  fileName,
  clipboardSupported,
  imageBytes,
} from "@/utils/clipboard";
import { logger } from "@/utils/logger";
import { makeTheme } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { InputBox, INPUT_BASE_HEIGHT, ATTACHMENT_HEIGHT, APPROVAL_HEIGHT } from "./components/InputBox";
import { StatusBar } from "./components/StatusBar";
import { Header } from "./components/Header";
import { Home } from "./components/Home";
import { CommandMenu, COMMANDS, matchCommands, MAX_COMMAND_ROWS } from "./components/CommandMenu";
import { ListPicker, type ListItem } from "./components/ListPicker";
import { SettingsScreen } from "./components/SettingsScreen";
import { HelpScreen } from "./components/HelpScreen";
import { CustomProviderForm } from "./components/CustomProviderForm";

type Screen =
  | "chat"
  | "settings"
  | "help"
  | "providerPicker"
  | "modelPicker"
  | "agentPicker"
  | "customProvider";

const STATUS_H = 1;
const HEADER_H = 3;

/**
 * SGR mouse report, e.g. `[<64;12;5M`. Terminal wheel ticks are button 64
 * (up) and 65 (down); Ink hands us the sequence with the leading ESC stripped.
 */
const MOUSE_SGR = /^\[<(\d+);\d+;\d+[Mm]$/;

function wheelDirection(input: string): "up" | "down" | null {
  const match = MOUSE_SGR.exec(input);
  if (!match) return null;
  const button = Number(match[1]);
  if ((button & 64) !== 64) return null; // not a wheel event
  return (button & 1) === 0 ? "up" : "down";
}

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const store = useMemo(() => new SessionStore(), []);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [screen, setScreen] = useState<Screen>("chat");

  const [sessions, setSessions] = useState<Session[]>(() => store.list());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [thought, setThought] = useState("");
  const [streamContent, setStreamContent] = useState("");
  const [activeTool, setActiveTool] = useState<ToolCall | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [input, setInputRaw] = useState("");
  // Every value that reaches the composer is folded onto a single line, so a
  // stray newline (from history, a paste, or a command) can never break the
  // prompt box.
  const setInput = useCallback(
    (value: string | ((prev: string) => string)) =>
      setInputRaw((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        return (next ?? "").replace(/[\r\n\u0000-\u001f\u007f]/g, " ");
      }),
    [],
  );
  const [attachments, setAttachments] = useState<MessageImage[]>([]);
  const [sidebar, setSidebar] = useState(settings.showSidebar);
  const [sidebarFocus, setSidebarFocus] = useState(false);
  const [sidebarIndex, setSidebarIndex] = useState(0);
  const [rows, setRows] = useState(stdout?.rows ?? 30);
  const [columns, setColumns] = useState(stdout?.columns ?? 80);
  const [notice, setNotice] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const [cmdIndex, setCmdIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [metrics, setMetrics] = useState({ total: 0, visible: 0, start: 0, atBottom: true });

  const [modelList, setModelList] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [agents, setAgents] = useState<AgentDef[]>(() => loadAgents(settings.workingDir));
  const [catalogVersion, setCatalogVersion] = useState(0);

  const approvalResolver = useRef<((approved: boolean) => void) | null>(null);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const queueRef = useRef<string[]>([]);
  const [queued, setQueued] = useState(0);
  const messagesRef = useRef<Message[]>([]);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  const providerDef = getProvider(settings.provider);
  const resolved: ResolvedProvider = useMemo(() => createProvider(settings), [settings]);
  const theme = useMemo(() => makeTheme(settings.accent), [settings.accent]);
  const accent = settings.accent;
  const hasKey = resolved.hasKey;
  const agent = useMemo(() => resolveAgent(agents, settings.agent), [agents, settings.agent]);
  const groups = useMemo(() => providerGroups(), [catalogVersion]);
  const visionSupported = useMemo(
    () => supportsVision(settings.provider, settings.model, { mmproj: !!settings.mmprojPath }),
    [settings.provider, settings.model, settings.mmprojPath],
  );

  // Refresh the models.dev catalog in the background (bundled snapshot offline).
  useEffect(() => {
    let alive = true;
    void refreshCatalog().then((changed) => {
      if (alive && changed) setCatalogVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setAgents(loadAgents(settings.workingDir));
  }, [settings.workingDir]);

  // ── bootstrap ────────────────────────────────────────────────────────────
  useEffect(() => {
    const existing = store.list();
    if (existing.length > 0) {
      const first = existing[0]!;
      setActiveId(first.id);
      setMessages(first.messages);
    } else {
      const s = store.create(settings.model, settings.workingDir);
      setSessions([s]);
      setActiveId(s.id);
      setMessages([]);
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    const onResize = () => {
      setRows(stdout?.rows ?? 30);
      setColumns(stdout?.columns ?? 80);
    };
    stdout?.on("resize", onResize);
    return () => {
      stdout?.off("resize", onResize);
    };
  }, [stdout]);

  // Turn on mouse reporting so the wheel scrolls the transcript. `1000` reports
  // button presses (wheel ticks are buttons 64/65); `1006` switches to the SGR
  // encoding that survives wide terminals.
  useEffect(() => {
    if (!stdout?.isTTY) return;
    stdout.write("\u001b[?1000h\u001b[?1006h");
    return () => {
      stdout.write("\u001b[?1000l\u001b[?1006l");
    };
  }, [stdout]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep the selected session in view when the list changes.
  useEffect(() => {
    setSidebarIndex((i) => Math.max(0, Math.min(i, sessions.length - 1)));
  }, [sessions.length]);

  // Clamp scrollback when the transcript shrinks.
  useEffect(() => {
    setScroll((s) => Math.min(s, Math.max(0, metrics.total - metrics.visible)));
  }, [metrics.total, metrics.visible]);

  // ── settings / sessions helpers ──────────────────────────────────────────
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch } as Settings;
      saveSettings(next);
      return next;
    });
  }, []);

  const refreshSessions = useCallback(() => setSessions(store.list()), [store]);

  const addAttachments = useCallback((imgs: MessageImage[], note?: string) => {
    if (imgs.length === 0) return;
    setAttachments((prev) => [...prev, ...imgs]);
    setNotice(
      note ??
        `${imgs.length} image${imgs.length === 1 ? "" : "s"} attached (${Math.max(
          1,
          Math.round(imgs.reduce((a, i) => a + imageBytes(i), 0) / 1024),
        )} KB) · enter to send`,
    );
  }, []);

  /** Attach an image from a file path (used by `/paste <path>` and drag-drop). */
  const addImagePath = useCallback(
    (path: string): boolean => {
      const img = readImageFile(path);
      if (!img) return false;
      addAttachments([{ ...img, name: fileName(path) }]);
      return true;
    },
    [addAttachments],
  );

  const attachFromClipboard = useCallback(
    async (silent = false) => {
      if (!silent) setNotice("reading clipboard…");

      // 1. A bitmap on the clipboard (screenshots from Win+Shift+S, etc.).
      const img = await readClipboardImage();
      if (img) {
        addAttachments([{ ...img, name: `clipboard-${attachments.length + 1}.png` }]);
        return;
      }

      // 2. Files copied in the file manager.
      const files = await readClipboardFiles();
      if (files.length > 0) {
        const imgs: MessageImage[] = [];
        const others: string[] = [];
        for (const path of files) {
          const im = readImageFile(path);
          if (im) imgs.push({ ...im, name: fileName(path) });
          else others.push(path);
        }
        if (imgs.length > 0) addAttachments(imgs);
        if (others.length > 0) {
          const quoted = others.map((p) => (/\s/.test(p) ? `"${p}"` : p));
          setInput((prev) => (prev ? prev + " " : "") + quoted.join(" "));
          if (imgs.length === 0) {
            setNotice(`added ${others.length} file path${others.length === 1 ? "" : "s"} to the prompt`);
          }
        }
        if (imgs.length > 0 || others.length > 0) return;
      }

      if (!silent) {
        setNotice(
          clipboardSupported()
            ? "no image in clipboard — copy a screenshot (Win+Shift+S) or a file, then /paste"
            : "clipboard images need `xclip` or `wl-paste` on this system",
        );
      }
    },
    [addAttachments, attachments.length, setInput],
  );

  const persist = useCallback(
    (id: string, msgs: Message[]) => {
      store.update(id, { messages: msgs });
      refreshSessions();
    },
    [store, refreshSessions],
  );

  const resetTransient = useCallback(() => {
    setUsage(null);
    setThought("");
    setStreamContent("");
    setActiveTool(null);
    setStatus("idle");
    setScroll(0);
    setNotice(null);
  }, []);

  const selectSession = useCallback(
    (id: string) => {
      if (runningRef.current) return;
      const s = store.load(id);
      if (!s) return;
      setActiveId(id);
      setMessages(s.messages);
      resetTransient();
    },
    [store, resetTransient],
  );

  const newSession = useCallback(() => {
    if (runningRef.current) return;
    const s = store.create(settings.model, settings.workingDir);
    setActiveId(s.id);
    setMessages([]);
    setAttachments([]);
    resetTransient();
    refreshSessions();
  }, [settings.model, settings.workingDir, store, refreshSessions, resetTransient]);

  const loadModels = useCallback(async () => {
    if (settings.provider === "gguf") return;
    setModelsLoading(true);
    const cataloged = modelsForProvider(settings.provider);
    setModelList(cataloged);
    const key = getApiKeys(settings, settings.provider);
    const discovered = await fetchModels(settings.provider, resolved.baseUrl, key);
    const merged = [...cataloged];
    for (const m of discovered) if (!merged.includes(m)) merged.push(m);
    setModelList(merged);
    setModelsLoading(false);
  }, [settings, resolved.baseUrl]);

  // ── agent ────────────────────────────────────────────────────────────────
  const runAgent = useCallback(
    async (sessionId: string, conversation: Message[]) => {
      runningRef.current = true;
      setRunning(true);
      setStatus("thinking");
      setNotice(null);

      let acc = conversation;
      let thoughtBuf = "";
      let contentBuf = "";

      const onEvent = (evt: AgentEvent) => {
        switch (evt.type) {
          case "turn_start":
            setStatus("thinking");
            break;
          case "thought":
            thoughtBuf += evt.content;
            setThought(thoughtBuf);
            setStatus("thinking");
            break;
          case "content":
            contentBuf += evt.content;
            setStreamContent(contentBuf);
            setStatus("streaming");
            break;
          case "tool_call":
            setActiveTool(evt.toolCall);
            setStatus("tool_call");
            break;
          case "tool_result":
            acc = [...acc, evt.message];
            setMessages(acc);
            persist(sessionId, acc);
            thoughtBuf = "";
            contentBuf = "";
            setThought("");
            setStreamContent("");
            setActiveTool(null);
            setStatus("thinking");
            break;
          case "usage":
            setUsage((u) => {
              if (!u) return evt.usage;
              return {
                prompt: evt.usage.prompt || u.prompt,
                completion: evt.usage.completion || u.completion,
                total: evt.usage.total || u.total,
              };
            });
            break;
          case "status":
            setNotice(evt.status);
            break;
          case "error":
            setStatus("error");
            break;
          case "done":
            break;
        }
      };

      const loop = new AgentLoop();
      let provider = resolved.provider;
      let model = settings.model;
      let providerId = settings.provider;
      let temperature = settings.temperature;

      if (agent.model) {
        const slash = agent.model.indexOf("/");
        if (slash > 0 && getProvider(agent.model.slice(0, slash))) {
          providerId = agent.model.slice(0, slash);
          model = agent.model.slice(slash + 1);
        } else {
          model = agent.model;
        }
      }
      if (agent.temperature !== undefined) temperature = agent.temperature;
      if (providerId !== settings.provider) {
        provider = createProvider({ ...settings, provider: providerId }).provider;
      }

      const agentTools = toolsForAgent(agent, allTools);
      const systemPrompt = agentSystemPrompt(agent, SYSTEM_PROMPT(settings.workingDir));

      try {
        if (providerId === "gguf") {
          setNotice("starting llama-server…");
          const extra = settings.llamaExtraArgs
            ? settings.llamaExtraArgs
                .split(/\s+/)
                .map((x) => x.trim())
                .filter(Boolean)
            : [];
          const handle = await ensureLlamaServer({
            ggufPath: settings.ggufPath,
            bin: settings.llamaServerBin,
            mmproj: settings.mmprojPath || undefined,
            onLog: (line) => logger.debug("[llama]", line),
            extra,
          });
          const next = {
            ...settings,
            baseUrls: { ...settings.baseUrls, gguf: handle.baseUrl },
          };
          patchSettings({ baseUrls: next.baseUrls });
          provider = createProvider(next).provider;
          setNotice(null);
          if (!model || model.includes("/")) {
            model = "local-gguf";
            patchSettings({ model });
          }
        }

        const finalConversation = await loop.run({
          messages: conversation,
          provider,
          model,
          systemPrompt,
          workingDir: settings.workingDir,
          temperature,
          maxTokens: settings.maxTokens,
          reasoning: settings.reasoning,
          autoApproveSafeTools: settings.autoApproveSafeTools,
          autoApproveAll: settings.autoApproveAll,
          tools: agentTools,
          onEvent,
          onApproval: (request) =>
            new Promise<boolean>((resolve) => {
              approvalResolver.current = resolve;
              setApproval(request);
              setStatus("tool_call");
            }),
        });

        setMessages(finalConversation);
        persist(sessionId, finalConversation);
      } catch (e) {
        logger.error("Agent run failed", e);
        const errMsg: Message = {
          id: nanoid(),
          role: "assistant",
          content: `! ${(e as Error).message}`,
          timestamp: Date.now(),
          done: true,
        };
        const next = [...conversation, errMsg];
        setMessages(next);
        persist(sessionId, next);
        setStatus("error");
      } finally {
        runningRef.current = false;
        setRunning(false);
        setThought("");
        setStreamContent("");
        setActiveTool(null);
        setApproval(null);
        setStatus((s) => (s === "error" ? "error" : "idle"));
        setNotice(null);
        setScroll(0);
        refreshSessions();
      }
    },
    [resolved.provider, settings, agent, patchSettings, persist, refreshSessions],
  );

  const submitMessage = useCallback(
    (text: string): boolean => {
      if (runningRef.current) return false;

      // Images from the composer plus any image files referenced by path (what
      // terminals insert when you drag-and-drop a file onto the prompt).
      const fromText = imagesInText(text).map(({ path, image }) => ({
        ...image,
        name: fileName(path),
      }));
      const imgs = [...attachments, ...fromText];
      const hasImages = imgs.length > 0;

      if (hasImages && !visionSupported) {
        setNotice(
          `⚠ ${settings.model || settings.provider} can't read images — ${visionHint(settings.provider)} · /drop to send text only`,
        );
        return false;
      }

      let sessionId = activeId;
      if (!sessionId) {
        const s = store.create(settings.model, settings.workingDir);
        sessionId = s.id;
        setActiveId(s.id);
      }

      const userMsg: Message = {
        id: nanoid(),
        role: "user",
        content: text,
        timestamp: Date.now(),
        done: true,
        ...(hasImages ? { images: imgs } : {}),
      };

      const conversation = [...messagesRef.current, userMsg];
      setMessages(conversation);
      setUsage(null);
      setScroll(0);
      setHistory((h) => (h[h.length - 1] === text ? h : [...h, text]).slice(-100));
      setHistoryIndex(-1);
      if (hasImages) setAttachments([]);

      const current = store.load(sessionId);
      if (current && current.messages.length === 0) {
        store.update(sessionId, { title: deriveTitle(text) });
        refreshSessions();
      }

      persist(sessionId, conversation);
      void runAgent(sessionId, conversation);
      return true;
    },
    [
      activeId,
      attachments,
      settings.model,
      settings.workingDir,
      visionSupported,
      persist,
      refreshSessions,
      runAgent,
      store,
    ],
  );

  // ── slash commands ───────────────────────────────────────────────────────
  const runCommand = useCallback(
    (cmd: string, arg: string) => {
      switch (cmd) {
        case "/help":
          setScreen("help");
          break;
        case "/settings":
          setScreen("settings");
          break;
        case "/provider":
          setScreen("providerPicker");
          break;
        case "/agent":
        case "/agents":
          if (arg) {
            const match = selectableAgents(agents).find(
              (a) => a.id === arg || a.name.toLowerCase() === arg.toLowerCase(),
            );
            if (match) {
              patchSettings({ agent: match.id });
              setNotice(`agent → ${match.name}`);
            } else {
              setNotice(`unknown agent: ${arg}  (try /agent)`);
            }
          } else {
            setScreen("agentPicker");
          }
          break;
        case "/model":
          setScreen("modelPicker");
          void loadModels();
          break;
        case "/pentest": {
          const match = selectableAgents(agents).find(
            (a) => a.id === "pentest" || a.name.toLowerCase() === "pentest",
          );
          if (match) {
            patchSettings({ agent: match.id });
            setNotice("agent → Pentest · authorised testing only");
          } else {
            setNotice("pentest agent unavailable");
          }
          break;
        }
        case "/paste":
        case "/image":
          if (arg) {
            if (addImagePath(arg)) {
              // notice handled by addImagePath
            } else if (imageMimeFor(arg)) {
              setNotice(`couldn't read image: ${arg}`);
            } else {
              setNotice(`not an image file: ${arg}`);
            }
          } else {
            void attachFromClipboard(false);
          }
          break;
        case "/file":
          if (!arg) {
            setNotice("usage: /file <path> — attach an image file");
          } else if (!addImagePath(arg)) {
            setNotice(`couldn't attach: ${arg}`);
          }
          break;
        case "/drop":
          setAttachments([]);
          setNotice("attachments cleared");
          break;
        case "/sessions":
          setSidebar((s) => !s);
          break;
        case "/new":
          newSession();
          break;
        case "/clear":
          if (activeId) {
            setMessages([]);
            persist(activeId, []);
            setScroll(0);
          }
          break;
        case "/cd":
          if (!arg) setNotice("usage: /cd <path>");
          else {
            patchSettings({ workingDir: arg });
            setNotice(`working dir → ${arg}`);
          }
          break;
        case "/reasoning":
          patchSettings({
            reasoning: { ...settings.reasoning, enabled: !settings.reasoning.enabled },
          });
          setNotice(`reasoning ${settings.reasoning.enabled ? "off" : "on"}`);
          break;
        case "/temp": {
          if (!arg) {
            setNotice(`temperature ${settings.temperature.toFixed(2)} · usage: /temp <0-1>`);
            break;
          }
          const n = Number(arg);
          if (!Number.isFinite(n)) {
            setNotice(`not a number: ${arg}`);
            break;
          }
          const t = clampTemperature(n);
          patchSettings({ temperature: t });
          setNotice(`temperature → ${t.toFixed(2)}`);
          break;
        }
        case "/compact":
          patchSettings({ compact: !settings.compact });
          setNotice(`compact mode ${settings.compact ? "off" : "on"}`);
          break;
        case "/theme": {
          const i = ACCENTS.findIndex((a) => a.value === settings.accent);
          const next = ACCENTS[(i + 1 + ACCENTS.length) % ACCENTS.length]!;
          patchSettings({ accent: next.value });
          setNotice(`theme → ${next.name}`);
          break;
        }
        case "/yolo": {
          const next = !settings.autoApproveAll;
          patchSettings({ autoApproveAll: next });
          setNotice(next ? "auto-approve: ALL tools, no prompts" : "approval prompts restored");
          break;
        }
        case "/exit":
        case "/quit":
          exit();
          break;
        default:
          setNotice(`unknown command: ${cmd}  (try /help)`);
      }
    },
    [
      activeId,
      agents,
      attachFromClipboard,
      addImagePath,
      exit,
      loadModels,
      newSession,
      patchSettings,
      persist,
      settings.reasoning,
      settings.compact,
      settings.accent,
      settings.temperature,
      settings.autoApproveAll,
    ],
  );

  const handleSubmit = useCallback(
    (text: string): boolean | void => {
      if (runningRef.current) {
        // Queue plain prompts typed while the agent is working; the drain effect
        // sends them one by one as each run finishes. Commands stay blocked.
        if (!text.startsWith("/")) {
          queueRef.current.push(text);
          setQueued(queueRef.current.length);
          return true;
        }
        setNotice("agent is working — wait for it to finish");
        return false;
      }
      if (!text.startsWith("/")) {
        return submitMessage(text);
      }

      // Complete a partial command to the highlighted suggestion.
      let completed = text;
      const first = text.split(/\s+/)[0]!;
      const known = COMMANDS.some((c) => c.name === first);
      if (!known) {
        const matches = matchCommands(first);
        const pick = matches[Math.min(cmdIndex, matches.length - 1)];
        if (pick) completed = pick.name;
      }

      const [cmd, ...rest] = completed.split(/\s+/);
      const arg = rest.join(" ").trim();
      setNotice(null);
      runCommand(cmd!, arg);
    },
    [cmdIndex, runCommand, submitMessage],
  );

  // Drain queued prompts whenever a run has finished.
  useEffect(() => {
    if (running) return;
    if (queueRef.current.length === 0) return;
    const next = queueRef.current[0]!;
    if (submitMessage(next) === false) return; // can't send yet; keep it queued
    queueRef.current.shift();
    setQueued(queueRef.current.length);
    if (queueRef.current.length === 0) setNotice(null);
  }, [running, submitMessage]);

  const handleApproval = useCallback((approved: boolean) => {
    setApproval(null);
    setStatus("tool_call");
    approvalResolver.current?.(approved);
    approvalResolver.current = null;
  }, []);

  const handleMetrics = useCallback(
    (m: { total: number; visible: number; start: number; atBottom: boolean }) => {
      setMetrics((prev) =>
        prev.total === m.total && prev.visible === m.visible && prev.start === m.start
          ? prev
          : m,
      );
    },
    [],
  );

  // ── command palette state ────────────────────────────────────────────────
  const showCommands = input.startsWith("/") && !running && !approval;
  const cmdMatches = useMemo(
    () => (showCommands ? matchCommands(input) : []),
    [showCommands, input],
  );
  const safeCmdIndex = Math.min(cmdIndex, Math.max(0, cmdMatches.length - 1));
  useEffect(() => {
    setCmdIndex(0);
  }, [input]);

  const scrollBy = useCallback((delta: number) => {
    setScroll((s) => {
      const max = Math.max(0, metricsRef.current.total - metricsRef.current.visible);
      return Math.max(0, Math.min(max, s + delta));
    });
  }, []);

  // ── global keys (chat only) ──────────────────────────────────────────────
  // Global: ctrl+c quits from any screen, overlay or approval prompt.
  useInput((value, key) => {
    if (key.ctrl && value === "c") exit();
  });

  useInput(
    (value, key) => {
      // Mouse wheel: scroll the transcript three lines per tick.
      const wheel = wheelDirection(value);
      if (wheel) {
        if (!sidebarFocus) scrollBy(wheel === "up" ? 3 : -3);
        return;
      }

      if (key.ctrl && value === "b") {
        setSidebar((s) => !s);
        setSidebarFocus(false);
        return;
      }
      if (key.ctrl && value === "v") {
        void attachFromClipboard(false);
        return;
      }
      // Alt+V too: many terminals hand Ctrl+V to their own paste handler, so
      // this gives a binding that reliably reaches the app.
      if (key.meta && value === "v") {
        void attachFromClipboard(false);
        return;
      }
      if (key.ctrl && value === "p") {
        historyPrev();
        return;
      }
      if (key.ctrl && value === "n") {
        historyNext();
        return;
      }

      if (sidebarFocus) {
        if (value === "n") {
          newSession();
          return;
        }
        if (value === "q" || key.escape) {
          setSidebarFocus(false);
          if (value === "q") setSidebar(false);
          return;
        }
        if (key.upArrow) {
          setSidebarIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSidebarIndex((i) => Math.min(sessions.length - 1, i + 1));
          return;
        }
        if (key.return) {
          const s = sessions[sidebarIndex];
          if (s) {
            selectSession(s.id);
            setSidebarFocus(false);
          }
        }
        return;
      }

      if (showCommands) {
        if (key.upArrow) {
          setCmdIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setCmdIndex((i) => Math.min(cmdMatches.length - 1, i + 1));
          return;
        }
        if (key.tab) {
          const pick = cmdMatches[safeCmdIndex];
          if (pick) {
            const next = pick.args ? pick.name + " " : pick.name;
            setInput(next);
          }
          return;
        }
        if (key.escape) {
          setInput("");
          return;
        }
        return;
      }

      if (key.tab) {
        if (!sidebar) {
          setSidebar(true);
          setSidebarFocus(true);
        } else {
          setSidebarFocus(true);
        }
        return;
      }
      if (key.escape) {
        if (input) setInput("");
        return;
      }
      if (key.upArrow) {
        scrollBy(1);
        return;
      }
      if (key.downArrow) {
        scrollBy(-1);
        return;
      }
    },
    { isActive: screen === "chat" && !approval },
  );

  function historyPrev() {
    if (history.length === 0) return;
    const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
    setHistoryIndex(next);
    setInput(history[next] ?? "");
  }

  function historyNext() {
    if (history.length === 0 || historyIndex < 0) return;
    const next = historyIndex + 1 >= history.length ? -1 : historyIndex + 1;
    setHistoryIndex(next);
    setInput(next === -1 ? "" : (history[next] ?? ""));
  }

  // ── overlay screens ──────────────────────────────────────────────────────
  const overlayInner = Math.max(6, rows - 3);

  if (screen === "help") {
    return (
      <Overlay theme={theme} rows={rows} footer="esc to go back">
        <HelpScreen
          accent={accent}
          theme={theme}
          width={columns - 2}
          height={rows - 3}
          configPath={configPath()}
          sessionsPath="~/.local/share/hiraxcode/sessions"
          onClose={() => setScreen("chat")}
        />
      </Overlay>
    );
  }

  if (screen === "settings") {
    return (
      <Overlay theme={theme} rows={rows} footer="settings · saved automatically">
        <SettingsScreen
          settings={settings}
          accent={accent}
          theme={theme}
          width={columns}
          height={overlayInner}
          onPatch={patchSettings}
          onPickProvider={() => setScreen("providerPicker")}
          onPickModel={() => {
            setScreen("modelPicker");
            void loadModels();
          }}
          onPickAgent={() => setScreen("agentPicker")}
          onClose={() => setScreen("chat")}
        />
      </Overlay>
    );
  }

  if (screen === "providerPicker") {
    const items: ListItem[] = groups.flatMap((g) =>
      g.providers.map((p) => ({
        label: p.name,
        value: p.id,
        hint:
          [
            p.local ? "local" : p.needsKey && !getApiKey(settings, p.id) ? "needs key" : undefined,
            p.modelCount ? `${p.modelCount} models` : undefined,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      })),
    );
    items.push({ label: "＋ Add custom provider…", value: "__add__", hint: "OpenAI-compatible" });

    return (
      <Overlay theme={theme} rows={rows} footer="esc to go back">
        <ListPicker
          title="Select provider"
          items={items}
          accent={accent}
          theme={theme}
          width={columns}
          height={Math.max(4, overlayInner - 5)}
          onCancel={() => setScreen("chat")}
          onSelect={(value) => {
            if (value === "__add__") {
              setScreen("customProvider");
              return;
            }
            const def = getProvider(value);
            const model =
              modelsForProvider(value)[0] || (def?.gguf ? "local-gguf" : settings.model);
            patchSettings({ provider: value, model });
            setScreen("chat");
          }}
        />
      </Overlay>
    );
  }

  if (screen === "agentPicker") {
    const items: ListItem[] = selectableAgents(agents).map((a) => ({
      label: a.name,
      value: a.id,
      hint:
        [
          a.id === settings.agent ? "current" : undefined,
          a.mode !== "primary" ? a.mode : undefined,
          a.source !== "builtin" ? a.source : undefined,
          a.model,
        ]
          .filter(Boolean)
          .join(" · ") || a.description,
    }));
    return (
      <Overlay theme={theme} rows={rows} footer="agents from ~/.config/hiraxcode/agents/*.md">
        <ListPicker
          title="Select agent"
          items={items}
          accent={accent}
          theme={theme}
          width={columns}
          height={Math.max(4, overlayInner - 5)}
          emptyText="No agents found"
          onCancel={() => setScreen("chat")}
          onSelect={(value) => {
            patchSettings({ agent: value });
            setNotice(`agent → ${value}`);
            setScreen("chat");
          }}
        />
      </Overlay>
    );
  }

  if (screen === "customProvider") {
    return (
      <Overlay theme={theme} rows={rows} footer="esc to go back">
        <CustomProviderForm
          accent={accent}
          theme={theme}
          width={columns}
          existing={settings.customProviders}
          onCancel={() => setScreen("providerPicker")}
          onSubmit={(cp) => {
            const list = [...settings.customProviders.filter((c) => c.id !== cp.id), cp];
            patchSettings({ customProviders: list, provider: cp.id, model: cp.models?.[0] ?? "" });
            registerCustomProviders(list.map(customToDef));
            setNotice(`provider added → ${cp.name}`);
            setScreen("settings");
          }}
        />
      </Overlay>
    );
  }

  if (screen === "modelPicker") {
    const list = modelList.length > 0 ? modelList : modelsForProvider(settings.provider);
    const items: ListItem[] = list.map((m) => ({
      label: m,
      value: m,
      hint: [m === settings.model ? "current" : undefined, modelHint(settings.provider, m)]
        .filter(Boolean)
        .join(" · "),
    }));
    return (
      <Overlay
        theme={theme}
        rows={rows}
        footer={`${list.length} model(s) · type to filter or add · caps from models.dev`}
      >
        <ListPicker
          title={`Select model · ${providerDef?.name ?? settings.provider}`}
          items={items}
          accent={accent}
          theme={theme}
          width={columns}
          loading={modelsLoading}
          height={Math.max(4, overlayInner - 5)}
          allowCustom
          customPrefix="Use"
          emptyText="No models found — type a model name and press enter"
          onCancel={() => setScreen("chat")}
          onSelect={(value) => {
            patchSettings({ model: value });
            setScreen("chat");
          }}
        />
      </Overlay>
    );
  }

  // ── chat screen ──────────────────────────────────────────────────────────
  const inputWidth = columns - (sidebar ? 30 : 0);
  const inputHeight = approval
    ? APPROVAL_HEIGHT
    : INPUT_BASE_HEIGHT + (attachments.length > 0 ? ATTACHMENT_HEIGHT : 0);
  const cmdRows = showCommands
    ? Math.min(cmdMatches.length, MAX_COMMAND_ROWS) +
      (cmdMatches.length > MAX_COMMAND_ROWS ? 1 : 0) +
      2
    : 0;
  const transcriptHeight = Math.max(3, rows - STATUS_H - HEADER_H - inputHeight - cmdRows);
  const maxScroll = Math.max(0, metrics.total - metrics.visible);
  const effectiveScroll = Math.min(scroll, maxScroll);
  const scrollHint =
    effectiveScroll > 0 ? `↑ ${effectiveScroll} line${effectiveScroll === 1 ? "" : "s"}` : null;
  const empty = messages.length === 0 && !running && !approval;
  const activeTitle = sessions.find((s) => s.id === activeId)?.title ?? "New session";
  const homeWidth = Math.max(16, Math.min(inputWidth - 4, 78));

  const renderInput = (width: number) => (
    <InputBox
      disabled={false}
      busy={running}
      focused={!sidebarFocus}
      accent={accent}
      theme={theme}
      width={width}
      value={input}
      onChange={setInput}
      onSubmit={handleSubmit}
      approval={approval}
      onApproval={handleApproval}
      attachments={attachments}
      queued={queued}
      notice={running ? null : notice}
      agentName={agent.name}
      model={settings.model}
      providerName={resolved.def.name}
    />
  );

  const statusBar = (
    <StatusBar
      messageCount={messages.length}
      usage={usage}
      running={running}
      accent={accent}
      theme={theme}
      width={columns}
      model={settings.model}
      notice={running ? null : notice}
      scrollHint={empty ? null : scrollHint}
      queued={queued}
      hint={
        sidebarFocus
          ? "esc back · enter open · q close"
          : showCommands
            ? `↑↓ pick ${safeCmdIndex + 1}/${cmdMatches.length} · tab complete · enter run`
            : empty
              ? "tab agents · / commands · ctrl+c quit"
              : "enter send · ↑↓ scroll"
      }
    />
  );

  const sidebarNode = sidebar ? (
    <Sidebar
      sessions={sessions}
      activeId={activeId}
      focused={sidebarFocus}
      index={sidebarIndex}
      accent={accent}
      theme={theme}
      width={30}
      height={rows - STATUS_H}
    />
  ) : null;

  if (empty) {
    return (
      <Box flexDirection="column" height={rows} width="100%">
        <Box flexGrow={1} flexDirection="row" width="100%">
          {sidebarNode}
          <Home
            theme={theme}
            tagline="Your coding agent · vibe coding in terminal"
            width={homeWidth}
          >
            {showCommands && (
              <CommandMenu
                query={input}
                accent={accent}
                theme={theme}
                width={homeWidth}
                selected={safeCmdIndex}
              />
            )}
            {renderInput(homeWidth)}
          </Home>
        </Box>
        {statusBar}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows} width="100%">
      <Box flexGrow={1} flexDirection="row" width="100%">
        {sidebarNode}
        <Box flexGrow={1} flexDirection="column" width="100%">
          <Header title={activeTitle} usage={usage} theme={theme} width={inputWidth} />
          <MessageList
            messages={messages}
            running={running}
            streamingThought={thought}
            streamingContent={streamContent}
            activeTool={activeTool}
            compact={settings.compact || rows < 24}
            minimal={settings.minimal}
            accent={accent}
            theme={theme}
            width={inputWidth}
            height={transcriptHeight}
            scroll={effectiveScroll}
            providerName={resolved.def.name}
            model={settings.model}
            hasKey={hasKey}
            agentName={agent.name}
            onMetrics={handleMetrics}
          />
          {showCommands && (
            <CommandMenu
              query={input}
              accent={accent}
              theme={theme}
              width={inputWidth}
              selected={safeCmdIndex}
            />
          )}
          {renderInput(inputWidth)}
        </Box>
      </Box>

      {statusBar}
    </Box>
  );
}

function Overlay({
  children,
  theme,
  rows,
  footer,
}: {
  children: ReactNode;
  theme: ReturnType<typeof makeTheme>;
  rows: number;
  footer: string;
}) {
  return (
    <Box flexDirection="column" height={rows} width="100%">
      <Box
        flexDirection="column"
        height={rows - 1}
        width="100%"
        borderStyle="round"
        borderColor={theme.border}
        overflow="hidden"
      >
        {children}
      </Box>
      <Box paddingX={1} width="100%">
        <Text>
          <Text bold color={theme.accent}>
            ✦ HiraxCode
          </Text>
          <Text color={theme.muted}>{" · " + footer}</Text>
        </Text>
      </Box>
    </Box>
  );
}

export default App;
