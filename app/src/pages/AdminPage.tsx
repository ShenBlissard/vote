import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { AdminData, TurnoutMode } from "@/lib/types";
import {
  buildShareText,
  computeRanks,
  countdownText,
  downloadCsv,
  formatDateTime,
  isoToLocalInput,
  peopleWithRankAtMost,
  rankCuts,
} from "@/lib/client";
import { ApiError, adminAction, getAdminData } from "@/lib/api";
import { CopyBtn } from "@/components/Copy";

export default function AdminClient() {
  useEffect(() => { document.title = "投票管理"; }, []);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pollId = searchParams.get("id") ?? "";
  const [data, setData] = useState<AdminData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [pubTopN, setPubTopN] = useState(-1);
  const [turnoutMode, setTurnoutMode] = useState<TurnoutMode>("both");
  const [anonymous, setAnonymous] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  const [newDeadline, setNewDeadline] = useState("");
  const [showResume, setShowResume] = useState(false);
  const [deadlineErr, setDeadlineErr] = useState("");
  const [addCode, setAddCode] = useState("");
  const [addName, setAddName] = useState("");

  const apply = useCallback((d: AdminData) => {
    setData(d);
    setPubTopN(d.poll.pubTopN);
    setTurnoutMode(d.poll.turnoutMode);
    setAnonymous(d.poll.anonymous);
    setAutoPublish(d.poll.autoPublish);
  }, []);

  const load = useCallback(async () => {
    if (!pollId) {
      setNotFound(true);
      return;
    }
    try {
      const d = await getAdminData(pollId);
      if (d === null) {
        setNotFound(true);
        return;
      }
      apply(d);
    } catch {
      setErr("网络错误，请刷新重试");
    }
  }, [pollId, apply]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (notFound) return;
    const t = setInterval(async () => {
      try {
        const d = await getAdminData(pollId);
        if (d !== null) setData(d);
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [pollId, notFound]);

  useEffect(() => {
    setNewDeadline((prev) => prev || (data ? isoToLocalInput(data.poll.deadline) : ""));
  }, [data]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function act(
    body: Record<string, unknown>,
    confirmMsg?: string,
    tip?: string,
    errFn: (msg: string) => void = setErr
  ): Promise<boolean> {
    if (confirmMsg && !window.confirm(confirmMsg)) return false;
    setBusy(true);
    errFn("");
    try {
      await adminAction(pollId, body.action as string, body);
      const d = await getAdminData(pollId);
      if (d === null) {
        setNotFound(true);
        return false;
      }
      apply(d);
      setNewDeadline(isoToLocalInput(d.poll.deadline));
      setShowResume(false);
      showToast(tip || "操作成功 ✓");
      return true;
    } catch (e) {
      errFn(e instanceof ApiError ? e.message : "网络错误，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleAnonymous(v: boolean) {
    if (!data) return;
    const prev = data.poll.anonymous;
    setAnonymous(v);
    const ok = await act(
      { action: "updateSettings", anonymous: v },
      undefined,
      v ? "已开启匿名投票，名单不再显示投票对象 ✓" : "已关闭匿名投票，名单将显示投票对象 ✓"
    );
    if (!ok) setAnonymous(prev);
  }

  function saveSettings() {
    act(
      {
        action: "updateSettings",
        pubTopN,
        turnoutMode,
        autoPublish,
        anonymous,
      },
      undefined,
      "公布设置已保存，立即生效 ✓"
    );
  }

  function saveDeadline() {
    if (!data || !newDeadline) return;
    const d = new Date(newDeadline);
    if (isNaN(d.getTime())) {
      setDeadlineErr("请填写正确的截止时间");
      return;
    }
    if (d.getTime() <= Date.now()) {
      setDeadlineErr("无法修改成过去的时间");
      return;
    }
    act(
      { action: "updateDeadline", deadline: d.toISOString() },
      undefined,
      data.poll.open ? "截止时间已更新 ✓" : "投票已重新开启 ✓",
      setDeadlineErr
    );
  }

  function startVote() {
    if (!data) return;
    if (new Date(data.poll.deadline).getTime() > Date.now()) {
      act(
        { action: "updateDeadline", deadline: data.poll.deadline },
        `将按原截止时间（${formatDateTime(data.poll.deadline)}）重新开始投票，确定？`,
        "投票已重新开启 ✓",
        setDeadlineErr
      );
    } else {
      setNewDeadline(isoToLocalInput(new Date(Date.now() + 24 * 3600 * 1000).toISOString()));
      setShowResume(true);
    }
  }

  function exportDetail() {
    if (!data) return;
    const ranks = computeRanks(data.candidates);
    const rows: string[][] = [["排名", "候选人", "得票数", "得票率(占参与者)"]];
    data.candidates.forEach((c, i) => {
      const pct =
        data.votedCount > 0 ? `${Math.round((c.count / data.votedCount) * 100)}%` : "-";
      rows.push([String(ranks[i]), c.name, String(c.count), pct]);
    });
    rows.push([]);
    rows.push(["已投票人数", String(data.votedCount)]);
    rows.push(["总人数", String(data.voterTotal)]);
    downloadCsv(`${data.poll.title}-投票明细.csv`, rows);
  }

  function exportRoster() {
    if (!data) return;
    const withDetail = !data.poll.anonymous;
    const rows: string[][] = withDetail
      ? [["四位数字", "姓名", "是否已投", "投票时间", "投票对象"]]
      : [["四位数字", "姓名", "是否已投", "投票时间"]];
    for (const r of data.roster) {
      const base = [
        r.code,
        r.name,
        r.voted ? "已投" : "未投",
        r.submittedAt ? formatDateTime(r.submittedAt) : "",
      ];
      if (withDetail) base.push(r.choiceNames.join("、"));
      rows.push(base);
    }
    downloadCsv(`${data.poll.title}-参与情况.csv`, rows);
  }

  function detailText(): string {
    if (!data) return "";
    const ranks = computeRanks(data.candidates);
    const lines = [`【投票结果】${data.poll.title}`];
    data.candidates.forEach((c, i) => {
      const pct =
        data.votedCount > 0 ? `（${Math.round((c.count / data.votedCount) * 100)}%的参与者投了TA）` : "";
      lines.push(`第${ranks[i]}名 ${c.name}：${c.count}票${pct}`);
    });
    lines.push(`——`);
    lines.push(`已投票 ${data.votedCount}/${data.voterTotal} 人`);
    return lines.join("\n");
  }

  async function addVoter() {
    if (!/^\d{4}$/.test(addCode)) {
      setErr("请输入恰好 4 位数字");
      return;
    }
    if (!addName.trim() || addName.trim().length > 50) {
      setErr("请输入姓名（1~50 字）");
      return;
    }
    const ok = await act(
      { action: "addVoter", code: addCode, name: addName.trim() },
      undefined,
      "参与人已添加 ✓"
    );
    if (ok) {
      setAddCode("");
      setAddName("");
    }
  }

  async function deletePoll() {
    if (!data || data.votedCount > 0) return;
    if (!window.confirm(`确定删除投票「${data.poll.title}」？此操作不可恢复。`)) return;
    setBusy(true);
    setErr("");
    try {
      await adminAction(pollId, "deletePoll");
      navigate("/", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "删除失败，请重试");
      setBusy(false);
    }
  }

  function participantText(): string {
    if (!data) return "";
    return data.roster.map((r) => `${r.code} ${r.name}`).join("\n");
  }

  function rosterText(): string {
    if (!data) return "";
    const voted = data.roster.filter((r) => r.voted);
    const notVoted = data.roster.filter((r) => !r.voted);
    const lines = [`【参与情况】${data.poll.title}`];
    lines.push(`已投票（${voted.length}人）：${voted.map((r) => r.name).join("、") || "无"}`);
    lines.push(`未投票（${notVoted.length}人）：${notVoted.map((r) => r.name).join("、") || "无"}`);
    return lines.join("\n");
  }

  if (notFound) {
    return (
      <div className="container narrow">
        <div className="card empty-card">
          <div className="empty-icon">🔒</div>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>你无权管理该投票</h1>
          <p className="muted">投票不存在，或当前账号不是发起人。请从首页「我创建的投票」进入。</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container narrow">
        <div className="card empty-card">
          <p className="muted">{err || "加载中…"}</p>
          {err && (
            <button className="btn btn-outline btn-sm mt" onClick={load}>
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  const p = data.poll;
  const share = buildShareText(p.title, formatDateTime(p.deadline));
  const rate = data.voterTotal > 0 ? Math.round((data.votedCount / data.voterTotal) * 100) : 0;
  const fixedCount = p.minChoices === p.maxChoices;
  const ranks = computeRanks(data.candidates);
  const counts = data.candidates.map((c) => c.count);
  const cutOptions = rankCuts(counts);
  const topNOptions =
    pubTopN > 0 && !cutOptions.find((o) => o.rank === pubTopN)
      ? [{ rank: pubTopN, people: peopleWithRankAtMost(counts, pubTopN) }, ...cutOptions].sort(
          (a, b) => a.rank - b.rank
        )
      : cutOptions;
  const votedList = data.roster.filter((r) => r.voted);
  const notVotedList = data.roster.filter((r) => !r.voted);

  return (
    <div className="container narrow">
      {toast && <div className="toast">{toast}</div>}
      <a className="back-home" href="/">
        ← 返回首页
      </a>
      <div className="card poll-head">
        <h1>{p.title}</h1>
        {p.description && <p className="desc">{p.description}</p>}
        <div className="badge-row">
          {p.open ? (
            <span className="badge badge-open">进行中 · {countdownText(p.deadline)}</span>
          ) : (
            <span className="badge badge-closed">已截止</span>
          )}
          {p.resultsMode === "published" ? (
            <span className="badge badge-pub">结果已公布</span>
          ) : (
            <span className="badge">结果未公布</span>
          )}
          <span className="badge">
            {fixedCount ? `每人投${p.minChoices}人` : `每人投${p.minChoices}~${p.maxChoices}人`}
          </span>
          {p.allowChange && <span className="badge">允许截止前修改</span>}
          {p.anonymous ? (
            <span className="badge">匿名投票</span>
          ) : (
            <span className="badge">显示投票明细</span>
          )}
          {p.shuffleCandidates && <span className="badge">候选人乱序展示</span>}
        </div>
        <div className="deadline-line">
          <span>截止时间：{formatDateTime(p.deadline)}</span>
          <button className="btn btn-sm btn-ghost" onClick={load}>
            刷新
          </button>
        </div>
      </div>

      {err && <div className="err-bar">{err}</div>}

      <div className="stat-row">
        <div className="stat">
          <b>{data.votedCount}</b>
          <span>已投票</span>
        </div>
        <div className="stat">
          <b>{data.voterTotal}</b>
          <span>总人数</span>
        </div>
        <div className="stat">
          <b>{rate}%</b>
          <span>参与率</span>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">匿名投票</h2>
        <label className="check-line">
          <input
            type="checkbox"
            checked={anonymous}
            disabled={busy}
            onChange={(e) => toggleAnonymous(e.target.checked)}
          />
          <span>
            开启后：下方参与名单只显示是否已投，不显示投给了谁；关闭后：显示每个人的投票对象
          </span>
        </label>
        <p className="hint">切换后立即保存生效，无需点击「保存公布设置」</p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="section-title">
            参与名单（已投 {data.votedCount} / {data.voterTotal}）
          </h2>
          <div className="card-head-btns">
            <CopyBtn text={participantText()} label="复制参与名单" />
            <CopyBtn text={rosterText()} label="复制参与情况" />
            <button className="btn btn-sm btn-outline" onClick={exportRoster}>
              导出Excel
            </button>
          </div>
        </div>
        {p.open && (
          <form
            className="add-voter-box"
            onSubmit={(e) => {
              e.preventDefault();
              void addVoter();
            }}
          >
            <label className="label">添加参与人</label>
            <div className="add-voter-fields">
              <input
                className="input"
                aria-label="参与人四位数字"
                inputMode="numeric"
                maxLength={4}
                placeholder="四位数字"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              <input
                className="input"
                aria-label="参与人姓名"
                maxLength={50}
                placeholder="姓名"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={busy}>
                添加
              </button>
            </div>
            <p className="hint">仅截止前可添加；新组合会自动注册账号</p>
          </form>
        )}
        <h3 className="roster-group-title ok">
          已投票（{votedList.length}人）
        </h3>
        <ul className="roster-list">
          {votedList.map((r) => (
            <li key={r.id}>
              <span className="who">
                <i className="code-tag">{r.code}</i>
                {r.name}
              </span>
              <span className="what">
                {r.choiceNames.length > 0 && `已投 · ${r.choiceNames.join("、")}`}
                {r.choiceNames.length === 0 && "已投"}
                {r.submittedAt ? ` · ${formatDateTime(r.submittedAt)}` : ""}
              </span>
            </li>
          ))}
          {votedList.length === 0 && <li className="muted small">暂无人投票</li>}
        </ul>
        <h3 className="roster-group-title muted-title">
          未投票（{notVotedList.length}人）
        </h3>
        <ul className="roster-list">
          {notVotedList.map((r) => (
            <li key={r.id}>
              <span className="who">
                <i className="code-tag">{r.code}</i>
                {r.name}
              </span>
              <span className="roster-unvoted-actions">
                <span className="what muted">未投票</span>
                {p.open && (
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() =>
                      act(
                        { action: "removeVoter", voterId: r.id },
                        `确定移除参与人「${r.code} ${r.name}」？仅解除其与本投票的关联。`,
                        "参与人已移除 ✓"
                      )
                    }
                  >
                    移除
                  </button>
                )}
              </span>
            </li>
          ))}
          {notVotedList.length === 0 && <li className="muted small">所有人都已投票 🎉</li>}
        </ul>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="section-title">完整结果（仅发起人可见）</h2>
          <div className="card-head-btns">
            <CopyBtn text={detailText()} label="复制文字" />
            <button className="btn btn-sm btn-outline" onClick={exportDetail}>
              导出Excel
            </button>
          </div>
        </div>
        {data.candidates.map((c, i) => {
          const w =
            data.votedCount > 0 ? Math.min(100, Math.round((c.count / data.votedCount) * 100)) : 0;
          return (
            <div className="res-row" key={c.id}>
              <div className="res-head">
                <span className="res-name">
                  <span className="rank-no">{ranks[i]}</span>
                  {c.name}
                </span>
                <span className="res-count">
                  {c.count} 票<span className="pct">{w}% 的参与者投了TA</span>
                </span>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${w}%` }} />
              </div>
            </div>
          );
        })}
        {data.candidates.length === 0 && <p className="muted small">暂无候选人</p>}
      </div>

      <div className="card">
        <h2 className="section-title">公布设置（可随时调整）</h2>
        <p className="hint">投票人只能看到你允许公布的内容，调整保存后立即生效</p>
        <div className="field">
          <label className="label">票数公布方式</label>
          <label className="radio-line">
            <input type="radio" checked={pubTopN === -1} onChange={() => setPubTopN(-1)} />
            <span>公布全部候选人的得票数（共 {data.candidates.length} 人）</span>
          </label>
          <label className="radio-line">
            <input type="radio" checked={pubTopN > 0} onChange={() => setPubTopN(topNOptions[0]?.rank ?? 1)} />
            <span>
              只公布票数前
              <select
                className="select inline-select"
                value={pubTopN > 0 ? pubTopN : topNOptions[0]?.rank ?? 1}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setPubTopN(Number(e.target.value))}
                disabled={pubTopN <= 0}
              >
                {topNOptions.map((o) => (
                  <option key={o.rank} value={o.rank}>
                    {o.rank}名（共{o.people}人）
                  </option>
                ))}
              </select>
              的得票数
            </span>
          </label>
          {pubTopN > 0 && topNOptions.length === 0 && (
            <p className="hint">当前所有候选人票数并列，前N名即全部，建议直接选「公布全部」</p>
          )}
          <label className="radio-line">
            <input type="radio" checked={pubTopN === 0} onChange={() => setPubTopN(0)} />
            <span>不公布任何人的票数</span>
          </label>
          <p className="hint">
            「前N名」按最终排名计（含并列）；若因票数并列导致所选名次不存在，系统会按「宁可少公布」自动收缩
          </p>
        </div>
        <div className="field">
          <label className="label">参与情况公布</label>
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
        {p.open && (
          <div className="field">
            <label className="label">截止后如何公布</label>
            <label className="radio-line">
              <input type="radio" checked={autoPublish} onChange={() => setAutoPublish(true)} />
              <span>自动公布 — 截止后结果立即对所有人可见</span>
            </label>
            <label className="radio-line">
              <input type="radio" checked={!autoPublish} onChange={() => setAutoPublish(false)} />
              <span>手动公布 — 截止后由我点击「公布结果」</span>
            </label>
          </div>
        )}
        <button className="btn btn-primary btn-block" onClick={saveSettings} disabled={busy}>
          {p.resultsMode === "published" ? "修改公布设置" : "保存公布设置"}
        </button>
      </div>

      <div className="card">
        <h2 className="section-title">管理操作</h2>
        {deadlineErr && <div className="err-bar">{deadlineErr}</div>}
        {p.open && (
          <div className="field mt">
            <label className="label">修改截止时间（仅可设定为未来时刻）</label>
            <div className="flex">
              <input
                className="input"
                type="datetime-local"
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
              />
              <button className="btn btn-primary" onClick={saveDeadline} disabled={busy}>
                保存
              </button>
            </div>
            <p className="hint">如需马上结束投票，请使用下方「立即截止投票」</p>
          </div>
        )}
        {!p.open && showResume && (
          <div className="field mt">
            <label className="label">选择新的截止时间</label>
            <div className="flex">
              <input
                className="input"
                type="datetime-local"
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
              />
              <button className="btn btn-primary" onClick={saveDeadline} disabled={busy}>
                确认开始
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setShowResume(false)}
                disabled={busy}
              >
                取消
              </button>
            </div>
            <p className="hint">确认后投票将立即重新开启</p>
          </div>
        )}
        <div className="flex">
          {p.open && (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                act(
                  { action: "close" },
                  "确定立即截止投票？截止后大家将无法继续投票",
                  "投票已截止 ✓"
                )
              }
            >
              立即截止投票
            </button>
          )}
          {!p.open && !showResume && (
            <button className="btn btn-primary" disabled={busy} onClick={startVote}>
              开始投票
            </button>
          )}
          {!p.open && p.resultsMode !== "published" && (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => act({ action: "publish" }, undefined, "结果已公布 ✓")}
            >
              公布结果
            </button>
          )}
          {!p.open && p.resultsMode === "published" && (
            <button
              className="btn btn-outline"
              disabled={busy}
              onClick={() =>
                act(
                  { action: "unpublish" },
                  "确定撤回公布？大家将看不到结果",
                  "已撤回公布（转为手动公布，可再次点击「公布结果」恢复）✓"
                )
              }
            >
              撤回公布
            </button>
          )}
        </div>
        <div className="delete-poll-box">
          <button
            className="btn btn-danger"
            disabled={busy || data.votedCount > 0}
            title={data.votedCount > 0 ? "已有投票记录，不可删除" : "删除后将无法恢复"}
            onClick={() => void deletePoll()}
          >
            删除投票
          </button>
          <p className="hint">
            {data.votedCount > 0
              ? "已有投票记录，不可删除"
              : "当前为 0 张选票，可删除；删除后投票、候选人及名单将一并清除"}
          </p>
        </div>
        {p.open && (
          <p className="hint">
            {p.autoPublish
              ? "当前为自动公布：到达截止时间后，结果立即对所有人可见"
              : "当前为手动公布：截止后需要你点击「公布结果」"}
          </p>
        )}
      </div>

      {p.open && (
        <div className="card">
          <h2 className="section-title">分享投票</h2>
          <div className="mt" />
          <p className="hint">参与者登录后，在首页「我是投票者」中即可看到本投票</p>
          <div className="share-box">
            <div className="card-head">
              <span className="small muted">分享文案（复制后发到群里）</span>
              <CopyBtn text={share} label="复制文案" />
            </div>
            <pre className="share-text">{share}</pre>
          </div>
        </div>
      )}

      {!p.open && (
        <div className="warn-box">
          投票已截止，分享入口已收起；如需重新开放投票，请在「管理操作」中把截止时间修改到未来
        </div>
      )}

      <div className="warn-box">只有当前投票的创建者可以管理。更换设备后，使用同一「四位数字 + 姓名」登录即可继续管理。</div>
    </div>
  );
}
