"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TurnoutMode } from "@/lib/types";
import {
  buildShareText,
  formatDateTime,
  loadCreateDrafts,
  newDraftId,
  parseNamesFromLine,
  parseVoterEntries,
  randomPasscode,
  removeCreateDraft,
  saveCreateDraft,
  saveRecentPoll,
  type VoterEntry,
} from "@/lib/client";
import { CopyBtn, LinkBox } from "@/components/Copy";
import NameImport from "@/components/NameImport";
import { ApiError, createPoll } from "@/lib/api";

const STEPS = ["基本信息", "候选人", "参与人", "公布设置"];

interface Created {
  id: string;
  adminToken: string;
}

function parseLines(raw: string): { list: string[]; dup: number } {
  const seen = new Set<string>();
  const list: string[] = [];
  let dup = 0;
  for (const line of raw.split(/\r?\n/)) {
    for (const name of parseNamesFromLine(line)) {
      if (seen.has(name)) {
        dup++;
        continue;
      }
      seen.add(name);
      list.push(name);
    }
  }
  return { list, dup };
}

function parseVoters(raw: string): { list: VoterEntry[]; dup: number } {
  const seen = new Set<string>();
  const list: VoterEntry[] = [];
  let dup = 0;
  for (const line of raw.split(/\r?\n/)) {
    for (const entry of parseVoterEntries(line)) {
      if (seen.has(entry.name)) {
        dup++;
        continue;
      }
      seen.add(entry.name);
      list.push(entry);
    }
  }
  return { list, dup };
}

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(22, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function CreateClient() {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [allowChange, setAllowChange] = useState(false);
  const [candRaw, setCandRaw] = useState("");
  const [shuffleCandidates, setShuffleCandidates] = useState(true);
  const [minChoices, setMinChoices] = useState(1);
  const [maxChoices, setMaxChoices] = useState(1);
  const [voterRaw, setVoterRaw] = useState("");
  const [pubTopN, setPubTopN] = useState(-1);
  const [turnoutMode, setTurnoutMode] = useState<TurnoutMode>("both");
  const [anonymous, setAnonymous] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  const [error, setError] = useState("");
  const [deadlineErr, setDeadlineErr] = useState("");
  const [rangeNotice, setRangeNotice] = useState("");
  const rangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const draftIdRef = useRef("");

  const cands = useMemo(() => parseLines(candRaw), [candRaw]);
  const voters = useMemo(() => parseVoters(voterRaw), [voterRaw]);

  useEffect(() => {
    setDeadline((prev) => prev || defaultDeadline());
  }, []);

  useEffect(() => {
    try {
      const resumeId = new URLSearchParams(window.location.search).get("resume");
      if (resumeId) {
        const d = loadCreateDrafts().find((x) => x.draftId === resumeId);
        if (d) {
          draftIdRef.current = d.draftId;
          setStep(Math.min(3, Math.max(0, d.step)));
          if (typeof d.title === "string") setTitle(d.title);
          if (typeof d.description === "string") setDescription(d.description);
          if (typeof d.deadline === "string") setDeadline(d.deadline);
          if (typeof d.allowChange === "boolean") setAllowChange(d.allowChange);
          if (typeof d.candRaw === "string") setCandRaw(d.candRaw);
          if (typeof d.shuffleCandidates === "boolean") setShuffleCandidates(d.shuffleCandidates);
          if (typeof d.minChoices === "number") setMinChoices(d.minChoices);
          if (typeof d.maxChoices === "number") setMaxChoices(d.maxChoices);
          if (typeof d.voterRaw === "string") setVoterRaw(d.voterRaw);
          if (typeof d.pubTopN === "number") setPubTopN(d.pubTopN);
          if (
            d.turnoutMode === "none" ||
            d.turnoutMode === "voted" ||
            d.turnoutMode === "not_voted" ||
            d.turnoutMode === "both"
          )
            setTurnoutMode(d.turnoutMode);
          if (typeof d.anonymous === "boolean") setAnonymous(d.anonymous);
          if (typeof d.autoPublish === "boolean") setAutoPublish(d.autoPublish);
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || created) return;
    if (!title.trim() && !candRaw.trim() && !voterRaw.trim()) return;
    if (!draftIdRef.current) draftIdRef.current = newDraftId();
    saveCreateDraft({
      draftId: draftIdRef.current,
      savedAt: Date.now(),
      step,
      title,
      description,
      deadline,
      allowChange,
      candRaw,
      shuffleCandidates,
      minChoices,
      maxChoices,
      voterRaw,
      pubTopN,
      turnoutMode,
      anonymous,
      autoPublish,
    });
  }, [
    hydrated,
    created,
    step,
    title,
    description,
    deadline,
    allowChange,
    candRaw,
    shuffleCandidates,
    minChoices,
    maxChoices,
    voterRaw,
    pubTopN,
    turnoutMode,
    anonymous,
    autoPublish,
  ]);

  useEffect(() => {
    setMinChoices((m) => Math.max(1, Math.min(m, cands.list.length || 1)));
    setMaxChoices((m) => Math.max(1, Math.min(m, cands.list.length || 1)));
  }, [cands.list.length]);

  function importCandidates(lines: string[]) {
    const existing = parseLines(candRaw).list;
    let added = 0;
    let parsed = 0;
    for (const l of lines) {
      for (const name of parseNamesFromLine(l)) {
        parsed++;
        if (existing.includes(name)) continue;
        existing.push(name);
        added++;
      }
    }
    if (parsed === 0) {
      setError("没有识别到有效的姓名，请检查文件内容是否清晰");
      return;
    }
    setCandRaw(existing.length > 10 ? existing.join("，") : existing.join("\n"));
    if (added === 0) setError("导入的内容和现有名单全部重复，没有新增");
  }

  function importVoters(lines: string[]) {
    const merged = parseVoters(voterRaw).list;
    const existing = merged.map((v) => v.name);
    let added = 0;
    let parsed = 0;
    for (const l of lines) {
      for (const entry of parseVoterEntries(l)) {
        parsed++;
        if (existing.includes(entry.name)) continue;
        existing.push(entry.name);
        merged.push(entry);
        added++;
      }
    }
    if (parsed === 0) {
      setError("没有识别到有效的姓名，请检查文件内容是否清晰");
      return;
    }
    setVoterRaw(
      merged.length > 10
        ? merged.map((v) => (v.passcode ? `${v.name}${v.passcode}` : v.name)).join("，")
        : merged.map((v) => (v.passcode ? `${v.name},${v.passcode}` : v.name)).join("\n")
    );
    if (added === 0) setError("导入的内容和现有名单全部重复，没有新增");
  }

  function fillPasscodes() {
    const list = voters.list.map((v) =>
      v.passcode ? v : { name: v.name, passcode: randomPasscode() }
    );
    setVoterRaw(list.map((v) => `${v.name},${v.passcode}`).join("\n"));
  }

  function formatCandidates() {
    const list = parseLines(candRaw).list;
    if (list.length === 0) {
      setError("名单为空，无法排版");
      return;
    }
    setCandRaw(list.length > 10 ? list.join("，") : list.join("\n"));
  }

  function formatVoters() {
    const list = parseVoters(voterRaw).list;
    if (list.length === 0) {
      setError("名单为空，无法排版");
      return;
    }
    setVoterRaw(
      list.length > 10
        ? list.map((v) => (v.passcode ? `${v.name}${v.passcode}` : v.name)).join("，")
        : list.map((v) => (v.passcode ? `${v.name},${v.passcode}` : v.name)).join("\n")
    );
  }

  function showRangeNotice(msg: string) {
    setRangeNotice(msg);
    if (rangeTimer.current) clearTimeout(rangeTimer.current);
    rangeTimer.current = setTimeout(() => setRangeNotice(""), 4000);
  }

  function adjustMin(v: number) {
    setMinChoices(v);
    if (v > maxChoices) {
      setMaxChoices(v);
      showRangeNotice(`人数设置不合规：最少人数不能超过最多人数，已自动将最多人数调整为 ${v}`);
    }
  }

  function adjustMax(v: number) {
    setMaxChoices(v);
    if (v < minChoices) {
      setMinChoices(v);
      showRangeNotice(`人数设置不合规：最多人数不能少于最少人数，已自动将最少人数调整为 ${v}`);
    }
  }

  function goNext() {
    setError("");
    setDeadlineErr("");
    if (step === 0) {
      if (!title.trim()) {
        setError("请填写投票主题");
        return;
      }
      if (!deadline) {
        setDeadlineErr("请填写截止时间");
        return;
      }
      const d = new Date(deadline);
      if (isNaN(d.getTime())) {
        setDeadlineErr("请填写正确的截止时间");
        return;
      }
      if (d.getTime() <= Date.now()) {
        setDeadlineErr("截止时间必须晚于当前时间");
        return;
      }
    }
    if (step === 1) {
      if (cands.list.length < 2) {
        setError("至少需要2位候选人");
        return;
      }
      if (minChoices > maxChoices) {
        setError("最少人数不能大于最多人数");
        return;
      }
    }
    if (step === 2) {
      if (voters.list.length < 1) {
        setError("请填写参与人名单（每行一个姓名）");
        return;
      }
    }
    setStep(step + 1);
  }

  async function submit() {
    setError("");
    setSubmitting(true);
    try {
      const data = await createPoll({
        title,
        description,
        minChoices,
        maxChoices,
        shuffleCandidates,
        deadline: new Date(deadline).toISOString(),
        allowChange,
        autoPublish,
        pubTopN,
        turnoutMode,
        anonymous,
        candidates: cands.list,
        voters: voters.list,
      });
      saveRecentPoll({
        id: data.id,
        title: title.trim(),
        adminToken: data.adminToken,
        createdAt: Date.now(),
      });
      if (draftIdRef.current) removeCreateDraft(draftIdRef.current);
      setCreated(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    const voteUrl = `${window.location.origin}/vote?id=${created.id}`;
    const adminUrl = `${window.location.origin}/admin?token=${created.adminToken}`;
    const share = buildShareText(
      title.trim(),
      formatDateTime(new Date(deadline).toISOString()),
      voteUrl
    );
    const withPasscodes = voters.list.some((v) => v.passcode);
    const passcodeText = `${title.trim()} 口令对照表\n${voters.list
      .filter((v) => v.passcode)
      .map((v) => `${v.name} ${v.passcode}`)
      .join("\n")}`;
    return (
      <div className="container narrow">
        <a className="back-home" href="/">
          ← 返回首页（我发起过的投票）
        </a>
        <div className="card success-card">
          <div className="success-icon">✓</div>
          <h1>投票创建成功</h1>
          <div className="warn-box">
            请立即保存<b>管理链接</b>：它是管理这次投票的唯一凭证，丢失后无法找回（已自动记录在本浏览器首页的「我发起过的投票」中）。
          </div>
          <LinkBox label="投票链接（发到微信群）" value={voteUrl} />
          <LinkBox label="管理链接（仅自己保存，勿外传）" value={adminUrl} />
          <div className="share-box">
            <div className="card-head">
              <span className="small muted">分享文案（复制后发到群里）</span>
              <CopyBtn text={share} label="复制文案" />
            </div>
            <pre className="share-text">{share}</pre>
          </div>
          {withPasscodes && (
            <div className="share-box">
              <div className="card-head">
                <span className="small muted">口令对照表（请私下发给每个人）</span>
                <CopyBtn text={passcodeText} label="复制口令表" />
              </div>
              <pre className="share-text">{passcodeText}</pre>
            </div>
          )}
          <div className="actions">
            <a className="btn btn-outline" href={voteUrl}>
              打开投票页
            </a>
            <a className="btn btn-primary" href={adminUrl}>
              打开管理页
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container narrow">
      <a className="back-home" href="/">
        ← 返回首页（我发起过的投票）
      </a>
      <div className="poll-head" style={{ marginBottom: 14 }}>
        <h1>发起投票</h1>
      </div>
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i === step ? "on" : ""} ${i < step ? "done" : ""}`}>
            <span className="step-dot">{i < step ? "✓" : i + 1}</span>
            <span className="step-label">{s}</span>
          </div>
        ))}
      </div>
      {error && <div className="err-bar">{error}</div>}
      <div className="card">
        {step === 0 && (
          <>
            <div className="field">
              <label className="label">投票主题 *</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：评选本学期班级优秀班干部"
                maxLength={100}
              />
            </div>
            <div className="field">
              <label className="label">投票说明（选填）</label>
              <textarea
                className="textarea"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="可以写投票规则、要求等，投票人都会看到"
                maxLength={1000}
              />
            </div>
            {deadlineErr && <div className="err-bar">{deadlineErr}</div>}
            <div className="field">
              <label className="label">截止时间 *</label>
              <input
                className="input"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <p className="hint">到达截止时间后投票自动结束</p>
            </div>
            <div className="field">
              <label className="label">投票选项（由你决定）</label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={allowChange}
                  onChange={(e) => setAllowChange(e.target.checked)}
                />
                <span>允许投票人在截止前修改自己的选票</span>
              </label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="field">
              <div className="card-head" style={{ marginBottom: 8 }}>
                <label className="label" style={{ marginBottom: 0 }}>
                  候选人名单 *
                </label>
                <button type="button" className="btn btn-sm btn-outline" onClick={formatCandidates}>
                  排版
                </button>
              </div>
              <NameImport onImport={importCandidates} />
              <textarea
                className="textarea"
                rows={8}
                style={{ marginTop: 8 }}
                value={candRaw}
                onChange={(e) => setCandRaw(e.target.value)}
                placeholder={"每行一位候选人，例如：\n张三\n李四\n王五"}
              />
              <p className="hint">
                已识别 {cands.list.length} 位候选人
                {cands.dup > 0 ? `（已自动去除 ${cands.dup} 个重复）` : ""}
                {cands.list.length > 10 ? "，已紧凑排列" : ""}
              </p>
              <p className="hint">
                一行可写多人：逗号、顿号、空格等任意分隔（超过10人自动紧凑排列）
              </p>
            </div>
            {cands.list.length > 0 && (
              <div className="chip-row">
                {cands.list.map((c, i) => (
                  <span key={c} className="chip">
                    {i + 1}. {c}
                    <button
                      className="chip-x"
                      onClick={() =>
                        setCandRaw(
                          cands.list
                            .filter((x) => x !== c)
                            .join("\n")
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="field" style={{ marginTop: 16 }}>
              <label className="check-line" style={{ background: "#fff" }}>
                <input
                  type="checkbox"
                  checked={shuffleCandidates}
                  onChange={(e) => setShuffleCandidates(e.target.checked)}
                />
                <span>候选人乱序展示（每位投票人看到的顺序随机，避免位置偏差）</span>
              </label>
            </div>
            {cands.list.length >= 2 && (
              <div className="field">
                <label className="label">每人投票人数 *</label>
                <div className="flex">
                  <select
                    className="select"
                    value={minChoices}
                    onChange={(e) => adjustMin(Number(e.target.value))}
                  >
                    {Array.from({ length: cands.list.length }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        最少 {n} 人
                      </option>
                    ))}
                  </select>
                  <select
                    className="select"
                    value={maxChoices}
                    onChange={(e) => adjustMax(Number(e.target.value))}
                  >
                    {Array.from({ length: cands.list.length }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        最多 {n} 人
                      </option>
                    ))}
                  </select>
                </div>
                {rangeNotice && <div className="notice-bar">{rangeNotice}</div>}
                <p className="hint">
                  {minChoices === maxChoices
                    ? `每人必须投票给 ${minChoices} 位候选人`
                    : `每人可自由选择投 ${minChoices}~${maxChoices} 位候选人`}
                  ；设为「最少1 最多1」即为单选
                </p>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="field">
              <div className="card-head" style={{ marginBottom: 8 }}>
                <label className="label" style={{ marginBottom: 0 }}>
                  参与人名单 *
                </label>
                <button type="button" className="btn btn-sm btn-outline" onClick={formatVoters}>
                  排版
                </button>
              </div>
              <NameImport onImport={importVoters} withPasscode />
              <textarea
                className="textarea"
                rows={10}
                style={{ marginTop: 8 }}
                value={voterRaw}
                onChange={(e) => setVoterRaw(e.target.value)}
                placeholder={
                  "每行一位参与人，例如：\n张三\n李四,0421\n王五\n……\n（姓名后加英文逗号可设置该人口令，留空则无需口令）"
                }
              />
              <p className="hint">
                已识别 {voters.list.length} 位参与人
                {voters.dup > 0 ? `（已自动去除 ${voters.dup} 个重复姓名）` : ""}
                ，其中 {voters.list.filter((v) => v.passcode).length} 人设置了口令
              </p>
              <p className="hint">
                口令用于防止冒名投票（每人凭自己的口令才能投票）；同名同学请加后缀区分
              </p>
              {voters.list.some((v) => !v.passcode) && (
                <button type="button" className="btn btn-outline btn-sm" onClick={fillPasscodes}>
                  为未设置口令的人生成随机口令
                </button>
              )}
            </div>
            {voters.list.length > 0 && (
              <div className="chip-row">
                {voters.list.slice(0, 30).map((v) => (
                  <span key={v.name} className="chip">
                    {v.name}
                    {v.passcode && <i className="chip-code">{v.passcode}</i>}
                  </span>
                ))}
                {voters.list.length > 30 && (
                  <span className="chip">…等 {voters.list.length} 人</span>
                )}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="review-box">
              <div className="kv">
                <span>主题</span>
                <b>{title.trim()}</b>
              </div>
              <div className="kv">
                <span>每人投票人数</span>
                <b>
                  {minChoices === maxChoices
                    ? `固定 ${minChoices} 人`
                    : `${minChoices}~${maxChoices} 人（自由选择）`}
                </b>
              </div>
              <div className="kv">
                <span>截止时间</span>
                <b>{formatDateTime(new Date(deadline).toISOString())}</b>
              </div>
              <div className="kv">
                <span>候选人</span>
                <b>
                  {cands.list.length} 人{shuffleCandidates ? "（乱序展示）" : ""}
                </b>
              </div>
              <div className="kv">
                <span>参与人</span>
                <b>{voters.list.length} 人</b>
              </div>
              {allowChange && (
                <div className="kv">
                  <span>修改选票</span>
                  <b>允许截止前修改</b>
                </div>
              )}
              <div className="kv">
                <span>匿名投票</span>
                <b>{anonymous ? "开启（管理页不显示谁投了谁）" : "关闭（管理页显示投票明细）"}</b>
              </div>
            </div>
            <div className="field">
              <label className="label">票数公布方式 *</label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={pubTopN === -1}
                  onChange={() => setPubTopN(-1)}
                />
                <span>公布全部候选人的得票数</span>
              </label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={pubTopN > 0}
                  onChange={() =>
                    setPubTopN(Math.max(1, Math.min(2, cands.list.length - 1)))
                  }
                />
                <span>
                  只公布票数前
                  <select
                    className="select inline-select"
                    value={pubTopN > 0 ? pubTopN : 1}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setPubTopN(Number(e.target.value))}
                    disabled={pubTopN <= 0}
                  >
                    {Array.from(
                      { length: Math.max(1, cands.list.length - 1) },
                      (_, i) => i + 1
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  名的得票数（按最终排名计，含并列）
                </span>
              </label>
              <label className="radio-line">
                <input type="radio" checked={pubTopN === 0} onChange={() => setPubTopN(0)} />
                <span>不公布任何人的票数</span>
              </label>
              <p className="hint">
                若因票数并列导致所选名次不存在，系统会按「宁可少公布」自动收缩名次，之后你可随时在管理页调整
              </p>
            </div>
            <div className="field">
              <label className="label">参与情况公布 *</label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={turnoutMode === "both"}
                  onChange={() => setTurnoutMode("both")}
                />
                <span>已投票和未投票的人都公布</span>
              </label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={turnoutMode === "voted"}
                  onChange={() => setTurnoutMode("voted")}
                />
                <span>只公布已投票的人</span>
              </label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={turnoutMode === "not_voted"}
                  onChange={() => setTurnoutMode("not_voted")}
                />
                <span>只公布未投票的人</span>
              </label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={turnoutMode === "none"}
                  onChange={() => setTurnoutMode("none")}
                />
                <span>都不公布</span>
              </label>
            </div>
            <div className="field">
              <label className="label">匿名投票（默认开启）</label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <span>
                  匿名投票 — 管理界面不显示谁投了谁，只显示票数与参与情况；取消勾选后，你自己的管理界面会显示每个人的投票对象
                </span>
              </label>
            </div>
            <div className="field">
              <label className="label">截止后如何公布 *</label>
              <label className="radio-line">
                <input type="radio" checked={autoPublish} onChange={() => setAutoPublish(true)} />
                <span>
                  <b>自动公布</b> — 到达截止时间后，以上内容立即对所有人可见
                </span>
              </label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={!autoPublish}
                  onChange={() => setAutoPublish(false)}
                />
                <span>
                  <b>手动公布</b> — 截止后由你在管理页点击「公布结果」
                </span>
              </label>
              <p className="hint">以上设置截止后仍可随时在管理页调整</p>
            </div>
          </>
        )}

        <div className="wizard-nav">
          {step > 0 && (
            <button className="btn btn-outline" onClick={() => setStep(step - 1)}>
              上一步
            </button>
          )}
          {step < 3 && (
            <button className="btn btn-primary" onClick={goNext}>
              下一步
            </button>
          )}
          {step === 3 && (
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? "创建中…" : "创建投票"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
