import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { getMe, login as apiLogin, logout as apiLogout, register as apiRegister } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (code: string, name: string) => Promise<AuthUser>;
  register: (code: string, name: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getMe()
      .then((u) => {
        if (active) setUser(u);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(code, name) {
        const u = await apiLogin(code, name);
        setUser(u);
        return u;
      },
      async register(code, name) {
        const u = await apiRegister(code, name);
        setUser(u);
        return u;
      },
      async logout() {
        await apiLogout();
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return value;
}

function PageLoading() {
  return (
    <div className="container narrow">
      <div className="card empty-card">正在加载…</div>
    </div>
  );
}

export function UserBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="user-bar">
      <div className="user-bar-inner">
        <span className="user-identity">
          <b>{user.code}</b>
          <span>{user.name}</span>
        </span>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={handleLogout}>
          {busy ? "退出中…" : "退出登录"}
        </button>
      </div>
    </div>
  );
}

export function ProtectedLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading />;
  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return (
    <>
      <UserBar />
      <Outlet />
    </>
  );
}
