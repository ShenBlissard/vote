"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadCreateDrafts, removeCreateDraft, type CreateDraft } from "@/lib/client";

const STEP_NAMES = ["基本信息", "候选人", "参与人", "公布设置"];

export default function DraftPoll() {
  const [drafts, setDrafts] = useState<CreateDraft[] | null>(null);

  useEffect(() => {
    setDrafts(loadCreateDrafts());
  }, []);

  if (!drafts || drafts.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">投票设置草稿</h2>
      </div>
      <ul className="recent-list">
        {drafts.map((d) => (
          <li key={d.draftId}>
            <div className="recent-info">
              <span className="recent-title">{d.title.trim() || "未命名投票"}</span>
              <span className="muted small">
                填到第 {d.step + 1} 步（{STEP_NAMES[d.step] ?? STEP_NAMES[0]}） ·{" "}
                {new Date(d.savedAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
            </div>
            <div className="recent-links">
              <Link className="btn btn-sm btn-outline" href={`/create?resume=${d.draftId}`}>
                继续填写
              </Link>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  removeCreateDraft(d.draftId);
                  setDrafts(loadCreateDrafts());
                }}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="hint">草稿自动保存在本机浏览器中，点「继续填写」接着上次的进度发起</p>
    </div>
  );
}
