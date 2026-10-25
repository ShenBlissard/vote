import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/auth";

type Mode = "login" | "register";

export default function LoginPage() {
  const { user, loading, login, register } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  useEffect(() => {
    document.title = "登录 · 班级投票";
  }, []);

  if (loading) {
    return (
      <div className="container narrow">
        <div className="card empty-card">正在加载…</div>
      </div>
    );
  }
  if (user) return <Navigate to={next} replace />;

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(code)) {
      setError("请输入恰好 4 位数字");
      return;
    }
    if (!name.trim() || name.trim().length > 50) {
      setError("请输入姓名（1~50 字）");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await login(code, name.trim());
      else await register(code, name.trim());
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand">
        <h1>班级投票</h1>
        <p>四位数字 + 姓名，简单登录</p>
      </div>
      <div className="card login-card">
        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "active" : ""}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "active" : ""}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>
        <p className="muted small auth-intro">
          {mode === "login"
            ? "输入你注册时使用的四位数字和姓名"
            : "注册后即可发起投票；数字和姓名可以分别重复，组合不能重复"}
        </p>
        {error && <div className="err-bar">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="login-code">四位数字</label>
            <input
              id="login-code"
              className="input code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="例如 0401"
              maxLength={4}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="login-name">姓名</label>
            <input
              id="login-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入姓名"
              maxLength={50}
              autoComplete="name"
            />
          </div>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
            {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>
        <p className="hint login-note">连续登录失败 5 次将锁定 10 分钟。请牢记四位数字，本期暂不支持找回。</p>
      </div>
    </main>
  );
}
