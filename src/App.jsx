// src/App.jsx
import { useEffect, useState } from "react";
import AuthPage from "./components/AuthPage.jsx";
import Dashboard from "./components/Dashboard.jsx";
import ZonePage from "./components/ZonePage.jsx";
import AdminZones from "./components/AdminZones.jsx";

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState("dashboard"); // "dashboard" | "zone" | "admin-zones"
  const [selectedZone, setSelectedZone] = useState(null);

  // Load saved session
  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const handleLogin = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    setView("dashboard");
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setSelectedZone(null);
    setView("dashboard");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  if (!token || !user) {
    return <AuthPage onAuthSuccess={handleLogin} />;
  }

  const showZone = (zoneName) => {
    setSelectedZone(zoneName);
    setView("zone");
  };

  const showDashboard = () => {
    setSelectedZone(null);
    setView("dashboard");
  };

  const showAdminZones = () => {
    setView("admin-zones");
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">Anglican DNS Manager</div>
        <div className="app-user">
          <span>{user.email}</span>
          {user.is_admin && <span className="badge">Admin</span>}
          <button className="btn btn-ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <button
            className={`nav-link ${view === "dashboard" ? "active" : ""}`}
            onClick={showDashboard}
          >
            Dashboard
          </button>
          {user.is_admin && (
            <button
              className={`nav-link ${view === "admin-zones" ? "active" : ""}`}
              onClick={showAdminZones}
            >
              Admin Zones
            </button>
          )}
        </aside>

        <main className="main">
          {view === "dashboard" && (
            <Dashboard token={token} onSelectZone={showZone} />
          )}

          {view === "zone" && selectedZone && (
            <ZonePage
              token={token}
              zoneName={selectedZone}
              onBack={showDashboard}
            />
          )}

          {view === "admin-zones" && user.is_admin && (
            <AdminZones token={token} />
          )}
        </main>
      </div>
    </div>
  );
}
