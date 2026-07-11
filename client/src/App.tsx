import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/useAuth";
import ProfilePicker from "./pages/ProfilePicker";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import ChildPortal from "./pages/ChildPortal";
import VersionBadge from "./components/VersionBadge";

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // The Child Portal is token-authenticated, not session-authenticated —
  // don't block it on the (unrelated) session check.
  if (loading && !location.pathname.startsWith("/portal/")) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/portal/:token" element={<ChildPortal />} />
        <Route path="/login" element={user ? <Navigate to="/app" replace /> : <ProfilePicker />} />
        <Route path="/app" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
        <Route path="/app/users" element={user ? <Users /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to={user ? "/app" : "/login"} replace />} />
      </Routes>
      <VersionBadge />
    </>
  );
}
