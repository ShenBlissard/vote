import { Routes, Route } from "react-router";
import { AuthProvider, ProtectedLayout } from "./auth";
import Home from "./pages/Home";
import LoginPage from "./pages/LoginPage";
import CreatePage from "./pages/CreatePage";
import VotePage from "./pages/VotePage";
import AdminPage from "./pages/AdminPage";

function NotFound() {
  return (
    <div className="container narrow">
      <div className="card empty-card">
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>页面不存在</h1>
        <p className="muted">链接可能不完整，请核对后重试</p>
        <div className="mt" />
        <a className="btn btn-outline btn-sm" href="/">
          返回首页
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/vote" element={<VotePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
