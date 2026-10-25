"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CandidateInfo, PollPublicInfo, ResultsResponse } from "@/lib/types";
import { computeRanks, countdownText, formatDateTime } from "@/lib/client";
import { ApiError, castVote, getPollPublic, getResults, getVoterStatus } from "@/lib/api";

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function VoteClient() {
  const searchParams = useSearchParams();
  const pollId = searchParams.get("id") ?? "";
  const [info, setInfo] = useState<PollPublicInfo | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [entered, setEntered] = useState(false);
  const [entering, setEntering] = useState(false);
  const [voted, setVoted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);
  const [wasModify, setWasModify] = useState(false);
  const [, tick] = useState(0);
  const reloadRef = useRef(false);
  const orderRef = useRef<string[] | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!pollId) {
      setNotFound(true);
      return;
    }
    if (!silent) setLoadErr("");
    try {
      const [infoData, resultsData] = await Promise.all([
        getPollPublic(pollId),
        getResults(pollId),
      ]);
      if (infoData === null) {
        setNotFound(true);
        return;
      }
      if (!orderRef.current) {
        const list = infoData.shuffleCandidates
          ? shuffleArr(infoData.candidates)
          : infoData.candidates;
        orderRef.current = list.map((c) => c.id);
      }
      setInfo(infoData);
      if (resultsData !== null) setResults(resultsData);
    } catch {
      if (!silent) setLoadErr("网络错误，请刷新重试");
    }
  }, [pollId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    try {
      setShowBack(sessionStorage.getItem("vote_initiator_entry") === "1");
    } catch {
      setShowBack(false);
    }
  }, []);

  useEffect(() => {
    if (notFound) return;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [load, notFound]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (
      info &&
      info.open &&
      !reloadRef.current &&
      Date.now() > new Date(info.deadline).getTime()
    ) {
      reloadRef.current = true;
      load();
    }
  }, [info, load]);

  const candidates = useMemo(() => {
    if (!info) return [];
    if (!orderRef.current) return info.candidates;
    const byId = new Map(info.candidates.map((c) => [c.id, c] as const));
    const ordered: CandidateInfo[] = [];
    for (const id of orderRef.current) {
      const c = byId.get(id);
      if (c) ordered.push(c);
    }
    for (const c of info.candidates) {
      if (!orderRef.current.includes(c.id)) ordered.push(c);
    }
    return ordered;
  }, [info]);

  async function enterVote() {
    if (!name) {
      setErr("请选择你的姓名");
      return;
    }
    setErr("");
    setEntering(true);
    try {
      const data = await getVoterStatus(pollId, name, passcode);
      if (!data.exists) {
        setErr("该姓名不在投票名单中，请重选");
        return;
      }
      if (!data.passcodeOk) {
        setShowPasscode(true);
        setErr("该姓名设置了口令，请输入正确口令");
        return;
      }
      setVoted(data.voted);
      setBlocked(data.voted && !info?.allowChange);
      setPicked(data.choices ?? []);
      setSubmitDone(false);
      setEntered(true);
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setEntering(false);
    }
  }

  function toggle(id: string) {
    if (!info) return;
    setErr("");
    setNotice("");
    if (info.minChoices === 1 && info.maxChoices === 1) {
      setPicked([id]);
      return;
    }
    if (picked.includes(id)) {
      setPicked(picked.filter((x) => x !== id));
    } else if (picked.length < info.maxChoices) {
      setPicked([...picked, id]);
    } else {
      setNotice(`最多只能选 ${info.maxChoices} 人，可先取消已选的选项`);
    }
  }

  async function submit() {
    if (!info) return;
    if (picked.length < info.minChoices) {
      setErr(
        info.minChoices === info.maxChoices
          ? `请选择${info.minChoices}位候选人`
          : `至少需要选择${info.minChoices}位候选人`
      );
      return;
    }
    setSubmitting(true);
    setErr("");
    setWasModify(voted);
    try {
      await castVote(pollId, name, passcode, picked);
      setVoted(true);
      setBlocked(!info?.allowChange);
      setSubmitDone(true);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "网络错误，请重试";
      setErr(msg);
      if (msg.includes("截止")) load();
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return (
      <div className="container narrow">
        <div className="card empty-card">
          <div className="empty-icon">🔍</div>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>投票不存在</h1>
          <p className="muted">链接可能不完整，请核对发起人分享的链接</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="container narrow">
        <div className="card empty-card">
          <p className="muted">{loadErr || "加载中…"}</p>
          {loadErr && (
            <button className="btn btn-outline btn-sm mt" onClick={() => load()}>
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  const open = info.open;
  const isSingle = info.minChoices === 1 && info.maxChoices === 1;
  const countText =
    info.minChoices === info.maxChoices
      ? `需选 ${info.minChoices} 人`
      : `需选 ${info.minChoices}~${info.maxChoices} 人`;
  const canSubmit = picked.length >= info.minChoices && picked.length <= info.maxChoices;
  const pickedNames = picked
    .map((id) => info.candidates.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="container narrow">
      {showBack && (
        <a className="back-home" href="/">
          ← 返回首页（我发起过的投票）
        </a>
      )}
      <div className="card poll-head">
        <h1>{info.title}</h1>
        {info.description && <p className="desc">{info.description}</p>}
        <div className="badge-row">
          {open ? (
            <span className="badge badge-open">进行中 · {countdownText(info.deadline)}</span>
          ) : (
            <span className="badge badge-closed">已截止</span>
          )}
          <span className="badge">{info.minChoices === info.maxChoices ? `投${info.minChoices}人` : `投${info.minChoices}~${info.maxChoices}人`}</span>
          {info.voterCount > 0 && <span className="badge">{info.voterCount} 人参与名单</span>}
          {info.allowChange && <span className="badge">截止前可修改</span>}
        </div>
        <div className="deadline-line">
          <span>截止时间：{formatDateTime(info.deadline)}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => load()}>
            刷新
          </button>
        </div>
      </div>

      {loadErr && <div className="err-bar">{loadErr}</div>}

      {open && (
        <div className="card">
          <h2 className="section-title">投票</h2>
          <div className="mt" />
          {!entered ? (
            <>
              <div className="field">
                <label className="label">请选择你的姓名 *</label>
                <select className="select" value={name} onChange={(e) => setName(e.target.value)}>
                  <option value="">— 请选择 —</option>
                  {info.voterNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <p className="hint">名单由发起人设置，每人只能投一票</p>
              </div>
              {showPasscode && (
                <div className="field">
                  <label className="label">口令 *</label>
                  <input
                    className="input"
                    type="password"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="请输入你的口令（向发起人获取）"
                    maxLength={20}
                  />
                </div>
              )}
              {err && <div className="err-bar">{err}</div>}
              <button className="btn btn-primary btn-block" onClick={enterVote} disabled={entering}>
                {entering ? "查询中…" : "进入投票"}
              </button>
            </>
          ) : blocked ? (
            <>
              <div className="ok-bar">你已完成投票 ✓</div>
              <p className="muted small center">
                投票结果将在截止并公布后展示，请届时回来查看
              </p>
            </>
          ) : submitDone ? (
            <>
              <div className="ok-bar">
                {wasModify ? "修改成功 ✓" : "投票成功 ✓"}
                ，你选择了：{pickedNames.join("、")}
              </div>
              {info.allowChange ? (
                <>
                  <p className="muted small center">截止前你可以随时回来修改选票</p>
                  <div className="mt" />
                  <button
                    className="btn btn-outline btn-block"
                    onClick={() => setSubmitDone(false)}
                  >
                    修改我的选票
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <>
              {voted && info.allowChange && (
                <div className="ok-bar">
                  你已投过票，正在修改选票（提交后将整体替换之前的选择）
                </div>
              )}
              {candidates.map((c) => (
                <div
                  key={c.id}
                  className={`cand-pick ${isSingle ? "radio" : "check"} ${
                    picked.includes(c.id) ? "on" : ""
                  }`}
                  onClick={() => toggle(c.id)}
                >
                  <span className="dot" />
                  <span className="cand-name">{c.name}</span>
                </div>
              ))}
              <p className="picked-count">
                已选 {picked.length} 人（{countText}）
              </p>
              {notice && <div className="err-bar">{notice}</div>}
              {err && <div className="err-bar">{err}</div>}
              <button
                className="btn btn-primary btn-block"
                onClick={submit}
                disabled={submitting || !canSubmit}
              >
                {submitting ? "提交中…" : voted ? "提交修改" : "提交投票"}
              </button>
            </>
          )}
        </div>
      )}

      {(!open || (entered && (blocked || submitDone))) && (
        <ResultsBlock results={results} open={open} />
      )}
    </div>
  );
}

function ResultsBlock({ results, open }: { results: ResultsResponse | null; open: boolean }) {
  if (!results) return null;
  if (results.mode === "hidden") {
    return (
      <div className="card">
        <h2 className="section-title">投票结果</h2>
        <p className="muted small mt">
          {open ? "投票进行中，截止后在此查看结果" : "投票已结束，结果待发起人公布"}
        </p>
      </div>
    );
  }
  if (results.mode === "not_published") {
    return (
      <div className="card">
        <h2 className="section-title">投票结果</h2>
        <p className="muted small mt">投票已截止，结果待发起人公布，请稍后回来查看</p>
      </div>
    );
  }
  const partial =
    results.candidateTotal > 0 && results.candidates.length < results.candidateTotal;
  const maxCount = Math.max(1, ...results.candidates.map((c) => c.count));
  const base = results.turnout.votedCount ?? maxCount;
  const ranks = computeRanks(results.candidates);
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">投票结果</h2>
        <span className="badge badge-pub">已公布</span>
      </div>
      {partial && (
        <p className="hint" style={{ marginBottom: 12 }}>
          发起人只公布了票数前 {ranks[ranks.length - 1] ?? results.candidates.length} 名的结果
          {results.candidates.length > 1 &&
          results.candidates[results.candidates.length - 2].count ===
            results.candidates[results.candidates.length - 1].count
            ? "（末位并列，一并公布）"
            : ""}
        </p>
      )}
      {results.candidates.length === 0 && <p className="muted small mt">发起人选择不公布具体票数</p>}
      {results.candidates.map((c, i) => {
        const w = Math.min(100, Math.round((c.count / base) * 100));
        return (
          <div className="res-row" key={c.id}>
            <div className="res-head">
              <span className="res-name">
                <span className="rank-no">{ranks[i]}</span>
                {c.name}
              </span>
              <span className="res-count">
                {c.count} 票
                {results.turnout.votedCount !== null && results.turnout.votedCount > 0 && (
                  <span className="pct">{w}% 参与者投了TA</span>
                )}
              </span>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${w}%` }} />
            </div>
          </div>
        );
      })}
      {results.turnoutMode !== "none" && results.turnout.votedCount !== null && results.turnout.voterTotal !== null && (
        <div className="turnout-box">
          <b>
            参与情况：{results.turnout.votedCount} / {results.turnout.voterTotal} 人已投票
          </b>
          {results.turnout.votedNames && results.turnout.votedNames.length > 0 && (
            <div className="turnout-names">已投票：{results.turnout.votedNames.join("、")}</div>
          )}
          {results.turnout.notVotedNames && results.turnout.notVotedNames.length > 0 && (
            <div className="turnout-names">
              未投票：{results.turnout.notVotedNames.join("、")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
