import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import DraftPoll from "@/components/DraftPoll";
import { ApiError, getMyCreated, getMyParticipating } from "@/lib/api";
import { countdownText, formatDateTime } from "@/lib/client";
import type { MyCreatedItem, MyParticipatingItem } from "@/lib/types";

function resultLabel(mode: MyCreatedItem["resultsMode"]): string {
  if (mode === "published") return "结果已公布";
  if (mode === "not_published") return "结果待公布";
  return "结果未公布";
}

export default function Home() {
  const [active, setActive] = useState<MyParticipatingItem[]>([]);
  const [history, setHistory] = useState<MyParticipatingItem[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [created, setCreated] = useState<MyCreatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, c] = await Promise.all([getMyParticipating(), getMyCreated()]);
      setActive(p.active);
      setHistory(p.history);
      setHistoryHasMore(p.historyHasMore);
      setCreated(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "班级投票";
    void load();
  }, [load]);

  async function loadMoreHistory() {
    if (loadingMore || !historyHasMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const p = await getMyParticipating(history.length, 20);
      setActive(p.active);
      setHistory((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...p.history.filter((item) => !seen.has(item.id))];
      });
      setHistoryHasMore(p.historyHasMore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载更多失败，请重试");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <header className="hero home-hero">
        <div className="hero-inner">
          <h1>班级投票</h1>
          <p>一个账号，参与投票与发起投票</p>
        </div>
      </header>
      <main className="container home-container">
        {error && (
          <div className="err-bar">
            {error} <button className="btn btn-ghost btn-sm" onClick={() => void load()}>重试</button>
          </div>
        )}
        <div className="home-columns">
          <section className="home-column">
            <div className="home-column-head">
              <h2>我是投票者</h2>
              <span className="muted small">{active.length + history.length} 个已加载</span>
            </div>
            <div className="card">
              <div className="card-head">
                <h3 className="section-title">参与中</h3>
              </div>
              {loading ? (
                <p className="muted">正在加载…</p>
              ) : active.length === 0 ? (
                <p className="muted empty-text">暂无进行中的投票</p>
              ) : (
                <ul className="recent-list">
                  {active.map((p) => (
                    <li key={p.id}>
                      <div className="recent-info">
                        <Link className="recent-title" to={`/vote?id=${encodeURIComponent(p.id)}`}>{p.title}</Link>
                        <span className="muted small">
                          {p.voted ? (p.allowChange ? "已投票 · 可改票" : "已投票") : "待投票"} · {countdownText(p.deadline)}
                        </span>
                        <span className="muted small">截止：{formatDateTime(p.deadline)}</span>
                      </div>
                      <div className="recent-links">
                        <Link className="btn btn-sm btn-primary" to={`/vote?id=${encodeURIComponent(p.id)}`}>
                          {p.voted ? "查看投票" : "去投票"}
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <div className="card-head">
                <h3 className="section-title">历史投票</h3>
              </div>
              {loading ? (
                <p className="muted">正在加载…</p>
              ) : history.length === 0 ? (
                <p className="muted empty-text">暂无历史投票</p>
              ) : (
                <ul className="recent-list">
                  {history.map((p) => (
                    <li key={p.id}>
                      <div className="recent-info">
                        <Link className="recent-title" to={`/vote?id=${encodeURIComponent(p.id)}`}>{p.title}</Link>
                        <span className="muted small">{p.voted ? "已投票" : "未投票"} · {resultLabel(p.resultsMode)}</span>
                        <span className="muted small">截止：{formatDateTime(p.deadline)}</span>
                      </div>
                      <div className="recent-links">
                        <Link className="btn btn-sm btn-outline" to={`/vote?id=${encodeURIComponent(p.id)}`}>查看</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!loading && historyHasMore && (
                <button
                  className="btn btn-outline btn-block load-more-btn"
                  disabled={loadingMore}
                  onClick={() => void loadMoreHistory()}
                >
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              )}
            </div>
          </section>

          <section className="home-column">
            <div className="home-column-head">
              <h2>我是发起者</h2>
              <Link to="/create" className="btn btn-primary btn-sm">发起新投票</Link>
            </div>
            <DraftPoll />
            <div className="card">
              <div className="card-head">
                <h3 className="section-title">我创建的投票</h3>
                <span className="muted small">{created.length} 个</span>
              </div>
              {loading ? (
                <p className="muted">正在加载…</p>
              ) : created.length === 0 ? (
                <div className="empty-text">
                  <p className="muted">还没有创建过投票</p>
                  <Link to="/create" className="btn btn-outline btn-sm create-first-btn">创建第一个投票</Link>
                </div>
              ) : (
                <ul className="recent-list">
                  {created.map((p) => (
                    <li key={p.id}>
                      <div className="recent-info">
                        <Link className="recent-title" to={`/admin?id=${encodeURIComponent(p.id)}`}>{p.title}</Link>
                        <span className="muted small">{p.open ? "进行中" : "已截止"} · {resultLabel(p.resultsMode)}</span>
                        <span className="muted small">创建：{formatDateTime(p.createdAt)}</span>
                      </div>
                      <div className="recent-links">
                        <Link className="btn btn-sm btn-outline" to={`/admin?id=${encodeURIComponent(p.id)}`}>管理</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">投票列表保存在服务端，更换设备登录后仍可查看</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
