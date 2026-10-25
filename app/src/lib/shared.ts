export interface VoterEntry {
  name: string;
  passcode: string;
}

const SYMBOL_RE =
  /["'\u2018\u2019\u201C\u201D\u00B6\u00A7\u21B5\u2190-\u21FF\u25A0-\u25FF\u2605\u2606\u2022\u2023\u25AA\u25AB|]/g;

export function stripSymbols(s: string): string {
  return s.replace(SYMBOL_RE, "");
}

export function cleanNameLine(line: string): string {
  let s = line.trim();
  s = s.replace(/^[0-9０-９]+[.、．)）]?\s*/, "");
  s = s.replace(/^[一二三四五六七八九十百]+[、.．)）]\s*/, "");
  s = s.replace(/^[•*◆●○◇\-–—]\s*/, "");
  return s.trim();
}

export function parseVoterEntries(line: string): VoterEntry[] {
  let cleaned = cleanNameLine(line);
  if (!cleaned) return [];
  cleaned = cleaned
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9·\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(" ");
  const entries: VoterEntry[] = [];
  for (const tok of tokens) {
    const glued = tok.match(/^([\u4e00-\u9fa5·]{2,12}?)(\d{2,10})$/);
    if (glued) {
      entries.push({ name: glued[1], passcode: glued[2].slice(0, 20) });
      continue;
    }
    if (/^\d$/.test(tok)) continue;
    if (!/[\u4e00-\u9fa5]/.test(tok) && /\d/.test(tok) && tok.length <= 20) {
      if (entries.length > 0 && !entries[entries.length - 1].passcode) {
        entries[entries.length - 1].passcode = tok.slice(0, 20);
      }
      continue;
    }
    if (tok.length >= 1 && tok.length <= 30) {
      entries.push({ name: tok, passcode: "" });
    }
  }
  return entries.filter((e) => e.name.length >= 1 && e.name.length <= 30);
}

export function parseNamesFromLine(line: string): string[] {
  return parseVoterEntries(line).map((e) => e.name);
}

export function computeRanks<T extends { count: number }>(sorted: T[]): number[] {
  const ranks: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    ranks.push(i > 0 && sorted[i].count === sorted[i - 1].count ? ranks[i - 1] : i + 1);
  }
  return ranks;
}

export function rankCuts(counts: number[]): { rank: number; people: number }[] {
  if (counts.length === 0) return [];
  const ranks = computeRanks(counts.map((c) => ({ count: c })));
  const distinct = [...new Set(ranks)].sort((a, b) => a - b);
  const out: { rank: number; people: number }[] = [];
  for (const r of distinct) {
    const people = ranks.filter((x) => x <= r).length;
    if (people < counts.length) out.push({ rank: r, people });
  }
  return out;
}

export function peopleWithRankAtMost(counts: number[], n: number): number {
  const ranks = computeRanks(counts.map((c) => ({ count: c })));
  return ranks.filter((x) => x <= n).length;
}

// ---------- v2.0：参与人「四位数字 + 姓名」解析 ----------

export interface ParticipantEntry {
  code: string;
  name: string;
}

export interface ParsedParticipantLine {
  entry: ParticipantEntry | null;
  raw: string;
  error: string;
}

// 每行一人：`0401 张三` / `0401,张三` / `0401张三`（粘连自动拆分）
export function parseParticipantLine(line: string): ParsedParticipantLine {
  const raw = line;
  let s = line.trim();
  if (!s) return { entry: null, raw, error: "" };
  s = s
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[,，、;；]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 粘连形式：0401张三 / 0401张
  const glued = s.match(/^(\d{4})([\u4e00-\u9fa5A-Za-z·]{1,50})$/);
  if (glued) {
    return { entry: { code: glued[1], name: glued[2] }, raw, error: "" };
  }

  const m = s.match(/^(\S+)\s+(.+)$/);
  if (m) {
    const code = m[1];
    const name = m[2]
      .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!/^\d{4}$/.test(code)) {
      return { entry: null, raw, error: "该行缺少四位数字" };
    }
    if (name.length < 1 || name.length > 50) {
      return { entry: null, raw, error: "姓名格式不正确" };
    }
    return { entry: { code, name }, raw, error: "" };
  }

  return { entry: null, raw, error: "该行缺少四位数字" };
}
