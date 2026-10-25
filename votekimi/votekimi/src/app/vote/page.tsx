import { Suspense } from "react";
import VoteClient from "./VoteClient";

export const metadata = { title: "参与投票" };

export default function VotePage() {
  return (
    <Suspense
      fallback={
        <div className="container narrow">
          <div className="card empty-card">
            <p className="muted">加载中…</p>
          </div>
        </div>
      }
    >
      <VoteClient />
    </Suspense>
  );
}
