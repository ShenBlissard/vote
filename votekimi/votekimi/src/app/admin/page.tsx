import { Suspense } from "react";
import AdminClient from "./AdminClient";

export const metadata = { title: "投票管理" };

export default function AdminPage() {
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
      <AdminClient />
    </Suspense>
  );
}
