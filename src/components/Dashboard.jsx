// src/components/Dashboard.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";

export default function Dashboard({ token, onSelectZone }) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadZones() {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest("/zones", { token });
        if (!cancelled) {
          setZones(data.zones || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadZones();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="card">
      <h2>Your Zones</h2>
      <p className="muted">
        Select a zone to manage DNS records and delegation.
      </p>

      {loading && <p>Loading zones…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && zones.length === 0 && !error && (
        <p className="muted">
          No zones assigned yet. Please contact the administrator.
        </p>
      )}

      <div className="zone-list">
        {zones.map((z) => (
          <button
            key={z.id}
            className="zone-pill"
            onClick={() => onSelectZone(z.name)}
          >
            {z.name}
          </button>
        ))}
      </div>
    </div>
  );
}
