import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { nanoid } from "nanoid";
import type { Message, Session } from "@/core/types";
import { logger } from "@/utils/logger";

function defaultDir(): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "hiraxcode", "sessions");
}

export class SessionStore {
  private dir: string;

  constructor(customDir?: string) {
    this.dir = customDir ? resolve(customDir) : defaultDir();
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch (e) {
      logger.error("Could not create session dir", this.dir, e);
    }
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  create(model: string, workingDir: string, title = "New Chat"): Session {
    const now = Date.now();
    const session: Session = {
      id: nanoid(10),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      model,
      workingDir,
    };
    this.save(session);
    return session;
  }

  save(session: Session): void {
    try {
      session.updatedAt = Date.now();
      writeFileSync(this.path(session.id), JSON.stringify(session, null, 2), "utf-8");
    } catch (e) {
      logger.error("Failed to save session", session.id, e);
    }
  }

  load(id: string): Session | null {
    try {
      const p = this.path(id);
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, "utf-8")) as Session;
    } catch (e) {
      logger.error("Failed to load session", id, e);
      return null;
    }
  }

  delete(id: string): void {
    try {
      const p = this.path(id);
      if (existsSync(p)) rmSync(p);
    } catch (e) {
      logger.error("Failed to delete session", id, e);
    }
  }

  list(): Session[] {
    try {
      if (!existsSync(this.dir)) return [];
      return readdirSync(this.dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => this.load(f.replace(/\.json$/, "")))
        .filter((s): s is Session => s !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (e) {
      logger.error("Failed to list sessions", e);
      return [];
    }
  }

  update(id: string, patch: Partial<Pick<Session, "messages" | "title" | "model">>): void {
    const s = this.load(id);
    if (!s) return;
    if (patch.messages) s.messages = patch.messages;
    if (patch.title) s.title = patch.title;
    if (patch.model) s.model = patch.model;
    this.save(s);
  }
}
