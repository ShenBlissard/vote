"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RecentPoll } from "@/lib/types";
import { clearRecentPolls, loadRecentPolls, removeRecentPoll } from "@/lib/client";
import { getPollPublic } from "@/lib/api";

export default function RecentPolls() {
  const [items, setItems] = useState<RecentPoll[] | null>(null);

  useEffect(() => {
    const stored = loadRecentPolls();
    setItems(stored);
    if (stored.length === 0) return;
    let cancelled = false;
    Promise.all(
      stored.map(async (p) => {
        try {
          const info = await getPollPublic(p.id);
          if (info === null) removeRecentPoll(p.id);
        } catch {}
      })
    ).then(() => {
      if (!cancelled) setItems(loadRecentPolls());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items === null || items.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">我发起过的投票</h2>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            clearRecentPolls();
            setItems([]);
          }}
        >
          清空记录
        </button>
      </div>
      <ul className="recent-list">
        {items.map((p) => (
          <li key={p.id}>
            <div className="recent-info">
              <span className="recent-title">{p.title}</span>
              <span className="muted small">
                {new Date(p.createdAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
            </div>
            <div className="recent-links">
              <Link className="btn btn-sm btn-outline" href={`/admin?token=${p.adminToken}`}>
                管理
              </Link>
              <Link
                className="btn btn-sm btn-outline"
                href={`/vote?id=${p.id}`}
                onClick={() => {
                  try {
                    sessionStorage.setItem("vote_initiator_entry", "1");
                  } catch {}
                }}
              >
                投票页
              </Link>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  removeRecentPoll(p.id);
                  setItems(loadRecentPolls());
                }}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="hint">记录保存在本机浏览器中，换电脑无法恢复，请保存好管理链接</p>
    </div>
  );
}
