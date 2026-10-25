import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { findOrCreateUser, validCode, validName } from "./auth";
import { ballots, candidates, choices, polls, users, voters, type Poll } from "@db/schema";

// ---------- ID ----------

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function newPollId(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function newId(): string {
  return randomBytes(12).toString("hex");
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------- 状态辅助 ----------

export type TurnoutMode = "none" | "voted" | "not_voted" | "both";
export type ResultsMode = "hidden" | "published" | "not_published";

export function pollIsOpen(p: Poll, now = Date.now()): boolean {
  return p.status === "open" && p.deadline > now;
}

export function pollResultsMode(p: Poll, now = Date.now()): ResultsMode {
  if (p.status !== "open" || p.deadline <= now) {
    return p.autoPublish || p.published ? "published" : "not_published";
  }
  return "hidden";
}

// 与原 SQL rank() 一致的标准竞赛排名（1,2,2,4）
export function computeRanks(counts: number[]): number[] {
  const ranks: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    ranks.push(i > 0 && counts[i] === counts[i - 1] ? ranks[i - 1] : i + 1);
  }
  return ranks;
}

// ---------- 票数统计 ----------

export interface CandidateCount {
  id: string;
  name: string;
  count: number;
  sortOrder: number;
}

export async function candidateCounts(pollId: string): Promise<CandidateCount[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      sortOrder: candidates.sortOrder,
      count: sql<number>`count(${choices.candidateId})`.mapWith(Number),
    })
    .from(candidates)
    .leftJoin(choices, eq(choices.candidateId, candidates.id))
    .where(eq(candidates.pollId, pollId))
    .groupBy(candidates.id, candidates.name, candidates.sortOrder)
    .orderBy(desc(sql`count(${choices.candidateId})`), asc(candidates.sortOrder));
  return rows;
}

// 前N名自动收缩：若并列导致所选名次不存在，按「宁可少公布」收缩并写回
export async function snapPubTopN(pollId: string): Promise<number> {
  const db = getDb();
  const [p] = await db.select().from(polls).where(eq(polls.id, pollId));
  if (!p || p.pubTopN <= 0) return p?.pubTopN ?? 0;
  const counts = await candidateCounts(pollId);
  if (counts.length === 0) return p.pubTopN;
  const ranks = computeRanks(counts.map((c) => c.count));
  const distinct = [...new Set(ranks)];
  let target = p.pubTopN;
  if (!distinct.includes(target)) {
    const below = distinct.filter((r) => r < target);
    target = Math.max(1, below.length > 0 ? Math.max(...below) : 1);
    await db.update(polls).set({ pubTopN: target }).where(eq(polls.id, pollId));
  }
  return target;
}

// ---------- 名单 / 权限辅助 ----------

export async function getPoll(pollId: string): Promise<Poll | null> {
  const db = getDb();
  const [p] = await db.select().from(polls).where(eq(polls.id, pollId));
  return p ?? null;
}

export async function getVoterRow(pollId: string, userId: string) {
  const db = getDb();
  const [v] = await db
    .select()
    .from(voters)
    .where(and(eq(voters.pollId, pollId), eq(voters.userId, userId)));
  return v ?? null;
}

// ---------- 我的投票列表 ----------

function participatingSelect() {
  const db = getDb();
  return db
    .select({
      id: polls.id,
      title: polls.title,
      deadline: polls.deadline,
      allowChange: polls.allowChange,
      ballotId: ballots.id,
      poll: polls,
    })
    .from(voters)
    .innerJoin(polls, eq(polls.id, voters.pollId))
    .leftJoin(ballots, eq(ballots.voterId, voters.id));
}

function mapParticipating(rows: {
  id: string;
  title: string;
  deadline: number;
  allowChange: boolean;
  ballotId: string | null;
  poll: Poll;
}[]) {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    deadline: new Date(r.deadline).toISOString(),
    allowChange: r.allowChange,
    open: pollIsOpen(r.poll),
    resultsMode: pollResultsMode(r.poll),
    voted: r.ballotId !== null,
  }));
}

export async function myParticipating(userId: string, historyOffset = 0, historyLimit = 20) {
  const now = Date.now();
  const safeOffset = Math.max(0, Math.floor(historyOffset));
  const safeLimit = Math.max(1, Math.min(20, Math.floor(historyLimit)));
  const openCondition = and(eq(polls.status, "open"), sql`${polls.deadline} > ${now}`);
  const closedCondition = sql`(${polls.status} <> 'open' OR ${polls.deadline} <= ${now})`;

  const [activeRows, historyRows] = await Promise.all([
    participatingSelect()
      .where(and(eq(voters.userId, userId), openCondition))
      .orderBy(asc(polls.deadline)),
    participatingSelect()
      .where(and(eq(voters.userId, userId), closedCondition))
      .orderBy(desc(polls.deadline), desc(polls.id))
      .limit(safeLimit + 1)
      .offset(safeOffset),
  ]);
  return {
    active: mapParticipating(activeRows),
    history: mapParticipating(historyRows.slice(0, safeLimit)),
    historyHasMore: historyRows.length > safeLimit,
    historyLimit: safeLimit,
  };
}

export async function myCreated(userId: string) {
  const db = getDb();
  const rows = await db.select().from(polls).where(eq(polls.creatorId, userId)).orderBy(desc(polls.createdAt));
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    createdAt: new Date(p.createdAt).toISOString(),
    deadline: new Date(p.deadline).toISOString(),
    open: pollIsOpen(p),
    resultsMode: pollResultsMode(p),
  }));
}

// ---------- 创建投票 ----------

export interface ParticipantInput {
  code: string;
  name: string;
}

export interface CreatePollInput {
  title: string;
  description: string;
  minChoices: number;
  maxChoices: number;
  shuffleCandidates: boolean;
  anonymous: boolean;
  deadline: string; // ISO
  allowChange: boolean;
  autoPublish: boolean;
  pubTopN: number;
  turnoutMode: string;
  candidates: string[];
  participants: ParticipantInput[];
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createPoll(
  creatorId: string,
  input: CreatePollInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  if (title.length === 0) return { ok: false, error: "请填写投票主题" };
  if (title.length > 100) return { ok: false, error: "投票主题过长（最多100字）" };
  if (description.length > 1000) return { ok: false, error: "投票说明过长（最多1000字）" };

  // 候选人：去重（保序）、过滤超长
  const candSeen = new Set<string>();
  const cands: string[] = [];
  for (const raw of Array.isArray(input.candidates) ? input.candidates : []) {
    const name = String(raw ?? "");
    if (name.length < 1 || name.length > 50 || candSeen.has(name)) continue;
    candSeen.add(name);
    cands.push(name);
  }
  if (cands.length < 2) return { ok: false, error: "至少需要2位候选人" };
  if (cands.length > 100) return { ok: false, error: "候选人过多（最多100位）" };

  // 参与人：「四位数字+姓名」组合去重（保序），格式必填校验
  const seen = new Set<string>();
  const participantRows: ParticipantInput[] = [];
  for (const e of Array.isArray(input.participants) ? input.participants : []) {
    if (!e || typeof e !== "object") continue;
    const code = String(e.code ?? "").trim();
    const name = String(e.name ?? "").trim();
    if (!/^\d{4}$/.test(code)) return { ok: false, error: `参与人「${name || code}」缺少四位数字，请修正后再创建` };
    if (name.length < 1 || name.length > 50) return { ok: false, error: "参与人姓名需为 1~50 字" };
    const key = `${code}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    participantRows.push({ code, name });
  }
  if (participantRows.length < 1) return { ok: false, error: "请填写参与人名单" };
  if (participantRows.length > 500) return { ok: false, error: "参与人过多（最多500人）" };

  const vMin = input.minChoices;
  const vMax = input.maxChoices;
  if (!Number.isInteger(vMin) || !Number.isInteger(vMax) || vMin < 1 || vMax < vMin || vMax > cands.length) {
    return { ok: false, error: "每人投票人数设置无效（需为1~候选人数量之间的范围）" };
  }

  const vTopN = input.pubTopN ?? -1;
  if (!Number.isInteger(vTopN) || vTopN < -1 || vTopN > cands.length) {
    return { ok: false, error: "公布设置无效（前N名需为0~候选人数量，或全部公布）" };
  }

  if (!["none", "voted", "not_voted", "both"].includes(input.turnoutMode)) {
    return { ok: false, error: "参与情况公布设置无效" };
  }

  const deadlineMs = new Date(input.deadline).getTime();
  if (isNaN(deadlineMs) || deadlineMs <= Date.now()) {
    return { ok: false, error: "截止时间必须晚于当前时间" };
  }

  const pollId = newPollId();
  const db = getDb();

  await db.insert(polls).values({
    id: pollId,
    creatorId,
    title,
    description,
    minChoices: vMin,
    maxChoices: vMax,
    shuffleCandidates: !!input.shuffleCandidates,
    anonymous: input.anonymous !== false,
    deadline: deadlineMs,
    allowChange: !!input.allowChange,
    autoPublish: input.autoPublish !== false,
    pubTopN: vTopN,
    turnoutMode: input.turnoutMode,
    published: false,
    status: "open",
    createdAt: Date.now(),
  });

  await db.insert(candidates).values(
    cands.map((name, i) => ({
      id: sha256(`${pollId}:${name}:${i + 1}`).slice(0, 32),
      pollId,
      name,
      sortOrder: i + 1,
    })),
  );

  // 逐组合查/建账号并关联（自动注册，对发起人零感知）
  const voterValues: (typeof voters.$inferInsert)[] = [];
  for (let i = 0; i < participantRows.length; i++) {
    const p = participantRows[i];
    const user = await findOrCreateUser(p.code, p.name);
    voterValues.push({
      id: sha256(`${pollId}:v:${user.id}:${i + 1}`).slice(0, 32),
      pollId,
      userId: user.id,
    });
  }
  for (let i = 0; i < voterValues.length; i += 200) {
    await db.insert(voters).values(voterValues.slice(i, i + 200));
  }

  return { ok: true, id: pollId };
}

// ---------- 公共查询：投票基本信息（需在名单中） ----------

export async function getPollPublic(pollId: string, userId: string) {
  const p = await getPoll(pollId);
  if (!p) return null;
  const membership = await getVoterRow(pollId, userId);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "你不在本投票的参与名单中" });
  const db = getDb();
  const cands = await db
    .select({ id: candidates.id, name: candidates.name })
    .from(candidates)
    .where(eq(candidates.pollId, pollId))
    .orderBy(asc(candidates.sortOrder));
  const [vc] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(voters)
    .where(eq(voters.pollId, pollId));
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    minChoices: p.minChoices,
    maxChoices: p.maxChoices,
    shuffleCandidates: p.shuffleCandidates,
    deadline: new Date(p.deadline).toISOString(),
    allowChange: p.allowChange,
    candidates: cands,
    voterCount: vc.n,
    open: pollIsOpen(p),
    resultsMode: pollResultsMode(p),
  };
}

// ---------- 当前用户投票状态 ----------

export async function voterStatus(pollId: string, userId: string) {
  const p = await getPoll(pollId);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "投票不存在或链接错误" });
  const v = await getVoterRow(pollId, userId);
  if (!v) throw new TRPCError({ code: "FORBIDDEN", message: "你不在本投票的参与名单中" });
  const db = getDb();
  const [b] = await db.select().from(ballots).where(eq(ballots.voterId, v.id));
  if (!b) return { voted: false, choices: [] as string[] };
  if (p.allowChange) {
    const rows = await db
      .select({ candidateId: choices.candidateId })
      .from(choices)
      .where(eq(choices.ballotId, b.id));
    return { voted: true, choices: rows.map((r) => r.candidateId) };
  }
  return { voted: true, choices: [] as string[] };
}

// ---------- 提交投票 ----------

export async function castVote(
  pollId: string,
  userId: string,
  candidateIds: string[],
): Promise<ActionResult> {
  const p = await getPoll(pollId);
  if (!p) return { ok: false, error: "投票不存在或链接错误" };
  if (!pollIsOpen(p)) return { ok: false, error: "投票已截止，无法提交" };

  const v = await getVoterRow(pollId, userId);
  if (!v) return { ok: false, error: "你不在本投票的参与名单中" };

  const db = getDb();
  // 候选人 ID 去重保序
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of Array.isArray(candidateIds) ? candidateIds : []) {
    const x = String(raw ?? "");
    if (x === "" || seen.has(x)) continue;
    seen.add(x);
    ids.push(x);
  }
  const n = ids.length;
  if (n < p.minChoices || n > p.maxChoices) {
    return {
      ok: false,
      error:
        p.minChoices === p.maxChoices
          ? `请选择${p.minChoices}位候选人`
          : `请选择${p.minChoices}~${p.maxChoices}位候选人`,
    };
  }
  const valid = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.pollId, pollId), inArray(candidates.id, ids)));
  if (valid.length !== n) return { ok: false, error: "所选候选人无效" };

  const now = Date.now();
  const [existing] = await db.select().from(ballots).where(eq(ballots.voterId, v.id));
  let ballotId: string;
  if (existing) {
    if (!p.allowChange) return { ok: false, error: "你已投过票，本次投票不允许修改" };
    ballotId = existing.id;
    await db.delete(choices).where(eq(choices.ballotId, ballotId));
    await db.update(ballots).set({ submittedAt: now }).where(eq(ballots.id, ballotId));
  } else {
    ballotId = newId();
    try {
      await db.insert(ballots).values({ id: ballotId, pollId, voterId: v.id, submittedAt: now });
    } catch {
      // 并发下的唯一键冲突：回到修改/拒绝路径
      const [again] = await db.select().from(ballots).where(eq(ballots.voterId, v.id));
      if (!again) return { ok: false, error: "提交失败，请重试" };
      if (!p.allowChange) return { ok: false, error: "你已投过票，本次投票不允许修改" };
      ballotId = again.id;
      await db.delete(choices).where(eq(choices.ballotId, ballotId));
      await db.update(ballots).set({ submittedAt: now }).where(eq(ballots.id, ballotId));
    }
  }
  await db.insert(choices).values(ids.map((candidateId) => ({ ballotId, candidateId })));

  if (p.pubTopN > 0) {
    try {
      await snapPubTopN(pollId);
    } catch {
      // 收缩失败不影响投票本身
    }
  }
  return { ok: true };
}

// ---------- 公共查询：投票结果（需在名单中） ----------

export async function getResults(pollId: string, userId: string) {
  const p = await getPoll(pollId);
  if (!p) return null;
  const membership = await getVoterRow(pollId, userId);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "你不在本投票的参与名单中" });
  const db = getDb();
  const mode = pollResultsMode(p);
  const closed = !pollIsOpen(p);
  const emptyTurnout = {
    votedCount: null as number | null,
    voterTotal: null as number | null,
    votedNames: null as string[] | null,
    notVotedNames: null as string[] | null,
  };
  if (mode === "hidden" || mode === "not_published") {
    return {
      mode,
      closed,
      candidates: [] as { id: string; name: string; count: number }[],
      candidateTotal: 0,
      turnoutMode: p.turnoutMode as TurnoutMode,
      turnout: emptyTurnout,
    };
  }

  const counts = await candidateCounts(pollId);
  const total = counts.length;
  const ranks = computeRanks(counts.map((c) => c.count));

  let shown: { id: string; name: string; count: number }[] = [];
  if (p.pubTopN === -1) {
    shown = counts.map(({ id, name, count }) => ({ id, name, count }));
  } else if (p.pubTopN <= 0) {
    shown = [];
  } else {
    const distinct = [...new Set(ranks)];
    let snapped = p.pubTopN;
    if (!distinct.includes(snapped)) {
      const below = distinct.filter((r) => r < snapped);
      snapped = Math.max(1, below.length > 0 ? Math.max(...below) : 1);
    }
    shown = counts
      .filter((_, i) => ranks[i] <= snapped)
      .map(({ id, name, count }) => ({ id, name, count }));
  }

  const [vt] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(voters)
    .where(eq(voters.pollId, pollId));
  const [vc] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(ballots)
    .where(eq(ballots.pollId, pollId));

  let votedNames: string[] | null = null;
  let notVotedNames: string[] | null = null;
  if (closed && p.turnoutMode !== "none") {
    const rows = await db
      .select({
        name: users.name,
        voted: sql<boolean>`${ballots.id} is not null`.mapWith(Boolean),
      })
      .from(voters)
      .innerJoin(users, eq(users.id, voters.userId))
      .leftJoin(ballots, eq(ballots.voterId, voters.id))
      .where(eq(voters.pollId, pollId))
      .orderBy(asc(voters.seq));
    if (p.turnoutMode === "voted" || p.turnoutMode === "both") {
      votedNames = rows.filter((r) => r.voted).map((r) => r.name);
    }
    if (p.turnoutMode === "not_voted" || p.turnoutMode === "both") {
      notVotedNames = rows.filter((r) => !r.voted).map((r) => r.name);
    }
  }

  return {
    mode,
    closed,
    candidates: shown,
    candidateTotal: total,
    turnoutMode: p.turnoutMode as TurnoutMode,
    turnout: {
      votedCount: vc.n,
      voterTotal: vt.n,
      votedNames,
      notVotedNames,
    },
  };
}

// ---------- 管理查询（创建者） ----------

export async function getAdminData(pollId: string, userId: string) {
  const p = await getPoll(pollId);
  if (!p || p.creatorId !== userId) return null;
  const db = getDb();

  const rosterRows = await db
    .select({
      id: voters.id,
      code: users.code,
      name: users.name,
      ballotId: ballots.id,
      submittedAt: ballots.submittedAt,
    })
    .from(voters)
    .innerJoin(users, eq(users.id, voters.userId))
    .leftJoin(ballots, eq(ballots.voterId, voters.id))
    .where(eq(voters.pollId, p.id))
    .orderBy(asc(voters.seq));

  let choiceMap = new Map<string, string[]>();
  if (!p.anonymous) {
    const ballotIds = rosterRows.filter((r) => r.ballotId).map((r) => r.ballotId as string);
    if (ballotIds.length > 0) {
      const rows = await db
        .select({ ballotId: choices.ballotId, name: candidates.name, sortOrder: candidates.sortOrder })
        .from(choices)
        .innerJoin(candidates, eq(candidates.id, choices.candidateId))
        .where(inArray(choices.ballotId, ballotIds))
        .orderBy(asc(candidates.sortOrder));
      choiceMap = new Map();
      for (const r of rows) {
        const list = choiceMap.get(r.ballotId) ?? [];
        list.push(r.name);
        choiceMap.set(r.ballotId, list);
      }
    }
  }

  const counts = await candidateCounts(p.id);
  const [vc] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(ballots)
    .where(eq(ballots.pollId, p.id));

  return {
    poll: {
      id: p.id,
      title: p.title,
      description: p.description,
      minChoices: p.minChoices,
      maxChoices: p.maxChoices,
      shuffleCandidates: p.shuffleCandidates,
      anonymous: p.anonymous,
      deadline: new Date(p.deadline).toISOString(),
      createdAt: new Date(p.createdAt).toISOString(),
      allowChange: p.allowChange,
      autoPublish: p.autoPublish,
      pubTopN: p.pubTopN,
      turnoutMode: p.turnoutMode as TurnoutMode,
      published: p.published,
      status: p.status as "open" | "closed",
      open: pollIsOpen(p),
      resultsMode: pollResultsMode(p),
    },
    candidates: counts.map(({ id, name, count }) => ({ id, name, count })),
    roster: rosterRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      voted: r.ballotId !== null,
      submittedAt: r.submittedAt !== null ? new Date(r.submittedAt).toISOString() : null,
      choiceNames: p.anonymous ? [] : (choiceMap.get(r.ballotId ?? "") ?? []),
    })),
    votedCount: vc.n,
    voterTotal: rosterRows.length,
  };
}

// ---------- 管理操作（创建者） ----------

export async function adminAction(
  pollId: string,
  userId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const p = await getPoll(pollId);
  if (!p || p.creatorId !== userId) return { ok: false, error: "你无权管理该投票" };
  const db = getDb();

  if (action === "close") {
    await db.update(polls).set({ status: "closed" }).where(eq(polls.id, p.id));
    return { ok: true };
  }

  if (action === "addVoter") {
    if (!pollIsOpen(p)) return { ok: false, error: "投票已截止，不能添加参与人" };
    const code = String(params.code ?? "").trim();
    const name = String(params.name ?? "").trim();
    if (!validCode(code)) return { ok: false, error: "请输入恰好 4 位数字" };
    if (!validName(name)) return { ok: false, error: "请输入姓名（1~50 字）" };
    const [count] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(voters)
      .where(eq(voters.pollId, p.id));
    if (count.n >= 500) return { ok: false, error: "参与人最多 500 人" };
    const user = await findOrCreateUser(code, name);
    if (await getVoterRow(p.id, user.id)) {
      return { ok: false, error: "该参与人已在名单中" };
    }
    await db.insert(voters).values({ id: newId(), pollId: p.id, userId: user.id });
    return { ok: true };
  }

  if (action === "removeVoter") {
    if (!pollIsOpen(p)) return { ok: false, error: "投票已截止，不能移除参与人" };
    const voterId = String(params.voterId ?? "");
    const [row] = await db
      .select({ id: voters.id, ballotId: ballots.id })
      .from(voters)
      .leftJoin(ballots, eq(ballots.voterId, voters.id))
      .where(and(eq(voters.id, voterId), eq(voters.pollId, p.id)));
    if (!row) return { ok: false, error: "参与人不存在或已被移除" };
    if (row.ballotId) return { ok: false, error: "该参与人已投票，不可移除" };
    await db.delete(voters).where(eq(voters.id, row.id));
    return { ok: true };
  }

  if (action === "deletePoll") {
    const [count] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(ballots)
      .where(eq(ballots.pollId, p.id));
    if (count.n > 0) return { ok: false, error: "已有投票记录，不可删除" };
    // 删除条件在数据库执行时再次检查 0 票，避免检查后恰好有新投票导致误删。
    const result = await db
      .delete(polls)
      .where(
        and(
          eq(polls.id, p.id),
          sql`not exists (select 1 from ${ballots} where ${ballots.pollId} = ${polls.id})`,
        ),
      );
    if (result[0].affectedRows === 0) return { ok: false, error: "已有投票记录，不可删除" };
    return { ok: true };
  }

  if (action === "publish") {
    if (pollIsOpen(p)) return { ok: false, error: "投票尚未截止，不能公布结果" };
    await db.update(polls).set({ published: true }).where(eq(polls.id, p.id));
    return { ok: true };
  }

  if (action === "unpublish") {
    await db.update(polls).set({ published: false, autoPublish: false }).where(eq(polls.id, p.id));
    return { ok: true };
  }

  if (action === "updateDeadline") {
    const ms = new Date(String(params.deadline ?? "")).getTime();
    if (isNaN(ms)) return { ok: false, error: "请填写正确的截止时间" };
    if (ms <= Date.now()) return { ok: false, error: "无法修改成过去的时间" };
    await db.update(polls).set({ deadline: ms, status: "open" }).where(eq(polls.id, p.id));
    return { ok: true };
  }

  if (action === "updateSettings") {
    const patch: Partial<typeof polls.$inferInsert> = {};
    if (typeof params.autoPublish === "boolean") patch.autoPublish = params.autoPublish;
    if (typeof params.anonymous === "boolean") patch.anonymous = params.anonymous;
    if (params.pubTopN !== undefined) {
      const vTopN = Number(params.pubTopN);
      const [cc] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(candidates)
        .where(eq(candidates.pollId, p.id));
      if (!Number.isInteger(vTopN) || vTopN < -1 || vTopN > cc.n) {
        return { ok: false, error: "公布设置无效（前N名需为0~候选人数量，或全部公布）" };
      }
      patch.pubTopN = vTopN;
    }
    if (
      typeof params.turnoutMode === "string" &&
      ["none", "voted", "not_voted", "both"].includes(params.turnoutMode)
    ) {
      patch.turnoutMode = params.turnoutMode;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(polls).set(patch).where(eq(polls.id, p.id));
    }
    return { ok: true };
  }

  return { ok: false, error: "未知操作" };
}
