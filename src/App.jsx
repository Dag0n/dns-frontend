// src/App.jsx
import { useEffect, useState } from "react";
import { apiRequest, onUnauthorized } from "./api";
import AuthPage from "./components/AuthPage.jsx";
import Dashboard from "./components/Dashboard.jsx";
import ZonePage from "./components/ZonePage.jsx";
import AdminZones from "./components/AdminZones.jsx";
import AdminRequests from "./components/AdminRequests.jsx";
import AdminUsers from "./components/AdminUsers.jsx";
import AuditLog from "./components/AuditLog.jsx";
import Security from "./components/Security.jsx";
import Support from "./components/Support.jsx";
import { Icon, BrandMark } from "./components/ui.jsx";

const ADMIN_VIEWS = ["admin-zones", "admin-requests", "admin-users"];

export default function App() {
  // Restore saved session synchronously on first render
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    try {
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [view, setView] = useState("dashboard");
  const [selectedZone, setSelectedZone] = useState(null);
  const [isAdminEdit, setIsAdminEdit] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");

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
      } else if (path === "/security") {
        setView("security");
      } else if (path === "/support") {
        setView("support");
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
    setSessionNotice("");
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

  // Expired/revoked token on any API call: drop the stale session and
  // return to the login page instead of erroring on every request.
  useEffect(() => {
    onUnauthorized(() => {
      setSessionNotice("Your session has expired — please sign in again.");
      handleLogout();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revalidate the cached user on startup (fresh is_admin/verified flags;
  // an expired token lands in the onUnauthorized handler above).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest("/auth/me", { token });
        if (cancelled) return;
        setUser(data.user);
        localStorage.setItem("user", JSON.stringify(data.user));
      } catch {
        /* 401 handled above; on network errors keep the cached user */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token || !user) {
    return <AuthPage onAuthSuccess={handleLogin} notice={sessionNotice} />;
  }

  const showZone = (zoneName, adminEdit = false) => {
    setSelectedZone(zoneName);
    setIsAdminEdit(adminEdit);
    setView("zone");
    navigate(adminEdit ? `/admin/zone/${encodeURIComponent(zoneName)}` : `/zone/${encodeURIComponent(zoneName)}`);
  };

  const goto = (nextView, path) => {
    setSelectedZone(null);
    setIsAdminEdit(false);
    setView(nextView);
    navigate(path);
  };

  const showDashboard = () => goto("dashboard", "/dashboard");
  const showAdminZones = () => goto("admin-zones", "/admin/zones");
  const showAdminRequests = () => goto("admin-requests", "/admin/requests");
  const showAdminUsers = () => goto("admin-users", "/admin/users");
  const showAuditLog = () => goto("audit-log", "/audit-log");
  const showSecurity = () => goto("security", "/security");
  const showSupport = () => goto("support", "/support");

  const editZoneAsAdmin = (zoneName) => showZone(zoneName, true);

  const inAdmin = ADMIN_VIEWS.includes(view) || (view === "zone" && isAdminEdit);

  const navItems = [
    { key: "dashboard", label: "Home", icon: "home", onClick: showDashboard, active: view === "dashboard" || (view === "zone" && !isAdminEdit) },
    ...(user.is_admin
      ? [{ key: "admin", label: "Admin", icon: "settings", onClick: showAdminZones, active: inAdmin }]
      : []),
    { key: "audit-log", label: "Activity", icon: "history", onClick: showAuditLog, active: view === "audit-log" },
    { key: "support", label: "Support", icon: "chat", onClick: showSupport, active: view === "support" },
    { key: "security", label: "Security", icon: "shield", onClick: showSecurity, active: view === "security" },
  ];

  const adminTabs = user.is_admin && ADMIN_VIEWS.includes(view) && (
    <div className="tabs" role="tablist">
      <button role="tab" className={`tab ${view === "admin-zones" ? "active" : ""}`} onClick={showAdminZones}>
        Zones
      </button>
      <button role="tab" className={`tab ${view === "admin-requests" ? "active" : ""}`} onClick={showAdminRequests}>
        Requests
      </button>
      <button role="tab" className={`tab ${view === "admin-users" ? "active" : ""}`} onClick={showAdminUsers}>
        Users
      </button>
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <button className="brand" onClick={showDashboard}>
          <BrandMark />
          <span>Anglican DNS</span>
        </button>
        <div className="header-user">
          <div className="user-meta">
            <div className="user-email">{user.email}</div>
            {user.is_admin && <span className="chip chip-teal">Admin</span>}
          </div>
          <button className="icon-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
            <Icon name="logout" size={19} />
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${item.active ? "active" : ""}`}
              onClick={item.onClick}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </aside>

        <main className="main">
          {adminTabs}

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

          {view === "security" && <Security token={token} />}

          {view === "support" && <Support token={token} user={user} />}
        </main>
      </div>

      <nav className="bottom-nav">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${item.active ? "active" : ""}`}
            onClick={item.onClick}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
