import { useState, useEffect } from "react";
import { Navbar } from "./components/Navbar";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { fetchEcus } from "./api/http";
import "./App.css";

export default function App() {
  const [ecuList, setEcuList] = useState([]);
  const [selectedEcuId, setSelectedEcuId] = useState(null);
  const [backendError, setBackendError] = useState(false);

  useEffect(() => {
    fetchEcus()
      .then((ecus) => {
        setEcuList(ecus);
        if (ecus.length > 0) setSelectedEcuId(ecus[0].id);
      })
      .catch(() => setBackendError(true));
  }, []);

  // Refresh ECU list every 10s to pick up new registrations and status changes
  useEffect(() => {
    if (backendError) return;
    const id = setInterval(() => {
      fetchEcus()
        .then(setEcuList)
        .catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [backendError]);

  const connectedCount = ecuList.filter((e) => e.is_connected).length;

  return (
    <div className="app-shell">
      <Navbar connectedCount={connectedCount} totalCount={ecuList.length} />
      <div className="app-body">
        {!backendError && (
          <Sidebar
            ecuList={ecuList}
            selectedEcuId={selectedEcuId}
            onEcuSelect={setSelectedEcuId}
          />
        )}
        <main className="main-content">
          <Dashboard
            selectedEcuId={selectedEcuId}
            backendError={backendError}
          />
        </main>
      </div>
    </div>
  );
}
