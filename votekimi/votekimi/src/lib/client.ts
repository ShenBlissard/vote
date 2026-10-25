import type { RecentPoll, TurnoutMode } from "./types";

export {
  cleanNameLine,
  computeRanks,
  parseVoterEntries,
  parseNamesFromLine,
  peopleWithRankAtMost,
  rankCuts,
  stripSymbols,
} from "./shared";
export type { VoterEntry } from "./shared";

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function countdownText(deadlineIso: string, now = Date.now()): string {
  const diff = new Date(deadlineIso).getTime() - now;
  if (isNaN(diff)) return "";
  if (diff <= 0) return "已截止";
  const min = Math.floor(diff / 60000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days > 0) return `剩 ${days}天${hours}小时`;
  if (hours > 0) return `剩 ${hours}小时${mins}分钟`;
  return `剩 ${mins}分钟`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function buildShareText(title: string, deadlineText: string, voteUrl: string): string {
  return `【班级投票】${title}\n请大家点击链接，选择自己的姓名参与投票：\n${voteUrl}\n截止时间：${deadlineText}`;
}

const RECENT_KEY = "vote_recent_polls";

export function loadRecentPolls(): RecentPoll[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = JSON.parse(raw ?? "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p): p is RecentPoll =>
        typeof p === "object" &&
        p !== null &&
        typeof p.id === "string" &&
        typeof p.title === "string" &&
        typeof p.adminToken === "string"
    );
  } catch {
    return [];
  }
}

export function saveRecentPoll(p: RecentPoll): void {
  try {
    const list = [p, ...loadRecentPolls().filter((x) => x.id !== p.id)].slice(0, 20);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

export function removeRecentPoll(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecentPolls().filter((x) => x.id !== id)));
  } catch {}
}

export function clearRecentPolls(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {}
}

export interface CreateDraft {
  draftId: string;
  savedAt: number;
  step: number;
  title: string;
  description: string;
  deadline: string;
  allowChange: boolean;
  candRaw: string;
  shuffleCandidates: boolean;
  minChoices: number;
  maxChoices: number;
  voterRaw: string;
  pubTopN: number;
  turnoutMode: TurnoutMode;
  anonymous: boolean;
  autoPublish: boolean;
}

const DRAFTS_KEY = "create_drafts";
const LEGACY_DRAFT_KEY = "create_draft";
const MAX_DRAFTS = 10;

export function newDraftId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function loadCreateDrafts(): CreateDraft[] {
  try {
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (legacy) {
      localStorage.removeItem(LEGACY_DRAFT_KEY);
      const d = JSON.parse(legacy);
      if (typeof d === "object" && d !== null) {
        const migrated = {
          ...d,
          draftId: newDraftId(),
          savedAt: Date.now(),
        } as CreateDraft;
        localStorage.setItem(DRAFTS_KEY, JSON.stringify([migrated]));
      }
    }
    const arr = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (d): d is CreateDraft =>
        typeof d === "object" && d !== null && typeof d.draftId === "string"
    );
  } catch {
    return [];
  }
}

export function saveCreateDraft(draft: CreateDraft): void {
  try {
    const list = [draft, ...loadCreateDrafts().filter((d) => d.draftId !== draft.draftId)]
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .slice(0, MAX_DRAFTS);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(list));
  } catch {}
}

export function removeCreateDraft(draftId: string): void {
  try {
    localStorage.setItem(
      DRAFTS_KEY,
      JSON.stringify(loadCreateDrafts().filter((d) => d.draftId !== draftId))
    );
  } catch {}
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

const loadedScripts = new Set<string>();

export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (loadedScripts.has(src)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => {
      loadedScripts.add(src);
      resolve();
    };
    s.onerror = () => reject(new Error("组件加载失败，请检查网络或联系维护者"));
    document.head.appendChild(s);
  });
}

export function randomPasscode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
