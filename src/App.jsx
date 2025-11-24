// src/App.jsx
import { useEffect, useState } from "react";
import AuthPage from "./components/AuthPage.jsx";
import Dashboard from "./components/Dashboard.jsx";
import ZonePage from "./components/ZonePage.jsx";
import AdminZones from "./components/AdminZones.jsx";
import AdminRequests from "./components/AdminRequests.jsx";
import AdminUsers from "./components/AdminUsers.jsx";
import AuditLog from "./components/AuditLog.jsx";

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState("dashboard"); // "dashboard" | "zone" | "admin-zones" | "admin-requests" | "admin-users" | "audit-log"
  const [selectedZone, setSelectedZone] = useState(null);
  const [isAdminEdit, setIsAdminEdit] = useState(false);

  // Load saved session
  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === "/" || path === "/dashboard") {
        setView("dashboard");
        setSelectedZone(null);
        setIsAdminEdit(false);
      } else if (path.startsWith("/zone/")) {
        const zoneName = decodeURIComponent(path.replace("/zone/", ""));
        setSelectedZone(zoneName);
        setView("zone");
        setIsAdminEdit(false);
      } else if (path.startsWith("/admin/zone/")) {
        const zoneName = decodeURIComponent(path.replace("/admin/zone/", ""));
        setSelectedZone(zoneName);
        setView("zone");
        setIsAdminEdit(true);
      } else if (path === "/admin/zones") {
        setView("admin-zones");
        setIsAdminEdit(false);
      } else if (path === "/admin/requests") {
        setView("admin-requests");
      } else if (path === "/admin/users") {
        setView("admin-users");
      } else if (path === "/audit-log") {
        setView("audit-log");
      }
    };

    window.addEventListener("popstate", handlePopState);
    handlePopState(); // Handle initial load

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path) => {
    window.history.pushState({}, "", path);
  };

  const handleLogin = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    navigate("/dashboard");
    setView("dashboard");
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setSelectedZone(null);
    setView("dashboard");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };

  if (!token || !user) {
    return <AuthPage onAuthSuccess={handleLogin} />;
  }

  const showZone = (zoneName, adminEdit = false) => {
    setSelectedZone(zoneName);
    setIsAdminEdit(adminEdit);
    setView("zone");
    navigate(adminEdit ? `/admin/zone/${encodeURIComponent(zoneName)}` : `/zone/${encodeURIComponent(zoneName)}`);
  };

  const showDashboard = () => {
    setSelectedZone(null);
    setIsAdminEdit(false);
    setView("dashboard");
    navigate("/dashboard");
  };

  const showAdminZones = () => {
    setIsAdminEdit(false);
    setView("admin-zones");
    navigate("/admin/zones");
  };

  const editZoneAsAdmin = (zoneName) => {
    showZone(zoneName, true);
  };

  const showAdminRequests = () => {
    setView("admin-requests");
    navigate("/admin/requests");
  };

  const showAdminUsers = () => {
    setView("admin-users");
    navigate("/admin/users");
  };

  const showAuditLog = () => {
    setView("audit-log");
    navigate("/audit-log");
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <svg className="app-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          <span>Anglican DNS Manager</span>
        </div>
        <div className="app-user">
          <div className="user-info">
            <span className="user-email">{user.email}</span>
            {user.is_admin && <span className="badge">Admin</span>}
          </div>
          <button className="btn btn-ghost" onClick={handleLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Logout
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <nav className="sidebar-nav">
            <button
              className={`nav-link ${view === "dashboard" ? "active" : ""}`}
              onClick={showDashboard}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
              <span>Dashboard</span>
            </button>
            {user.is_admin && (
              <button
                className={`nav-link ${view === "admin-zones" ? "active" : ""}`}
                onClick={showAdminZones}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span>Admin Panel</span>
              </button>
            )}
            {user.is_admin && (
              <button
                className={`nav-link ${view === "admin-requests" ? "active" : ""}`}
                onClick={showAdminRequests}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                <span>Requests</span>
              </button>
            )}
            {user.is_admin && (
              <button
                className={`nav-link ${view === "admin-users" ? "active" : ""}`}
                onClick={showAdminUsers}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span>Users</span>
              </button>
            )}
            <button
              className={`nav-link ${view === "audit-log" ? "active" : ""}`}
              onClick={showAuditLog}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>Activity Log</span>
            </button>
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-card">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <div className="sidebar-card-content">
                <h4>Need Help?</h4>
                <p>Contact your diocese administrator</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="main">
          {view === "dashboard" && (
            <Dashboard token={token} onSelectZone={showZone} user={user} />
          )}

          {view === "zone" && selectedZone && (
            <ZonePage
              token={token}
              zoneName={selectedZone}
              onBack={isAdminEdit ? showAdminZones : showDashboard}
              isAdminEdit={isAdminEdit}
            />
          )}

          {view === "admin-zones" && user.is_admin && (
            <AdminZones token={token} onEditZone={editZoneAsAdmin} />
          )}

          {view === "admin-requests" && user.is_admin && (
            <AdminRequests token={token} />
          )}

          {view === "admin-users" && user.is_admin && (
            <AdminUsers token={token} currentUser={user} />
          )}

          {view === "audit-log" && (
            <AuditLog token={token} isAdmin={user.is_admin} />
          )}
        </main>
      </div>
    </div>
  );
}
