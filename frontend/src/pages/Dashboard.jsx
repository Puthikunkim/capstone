// Dashboard page is the main view of the application.
// Responsibilities:
//   - Renders the full dashboard layout including chart
//   - Fetches ECU list from backend API
//   - Displays ECU selector dropdown
//   - Connects to WebSocket for selected ECU (via hook)
//   - Displays live data as text

import { useState, useEffect } from "react";
import { ECUSelector } from "../components/ECUSelector";
import { EnergyChart } from "../components/EnergyChart";
import { fetchEcus, fetchEcuHistory } from "../api/http";
import { useWebSocket } from "../hooks/useWebSocket";

export function Dashboard() {
  const [ecuList, setEcuList] = useState([]);
  const [selectedEcuId, setSelectedEcuId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartData, setChartData] = useState([]);
  const { isConnected, liveData } = useWebSocket(selectedEcuId);

  // Fetch ECUs on mount
  useEffect(() => {
    const loadEcus = async () => {
      try {
        const ecus = await fetchEcus();
        setEcuList(ecus);

        if (ecus.length > 0) {
          setSelectedEcuId(ecus[0].id);
        }
      } catch (err) {
        setError(err.message);
        console.error("Error fetching ECUs:", err);
      } finally {
        setLoading(false);
      }
    };

    loadEcus();
  }, []);

  // reset chart on ECU switch
    useEffect(() => {
        setChartData([]);
    }, [selectedEcuId]);

  // Load history AFTER reset
  useEffect(() => {
    if (!selectedEcuId) return;

    fetchEcuHistory(selectedEcuId)
      .then((history) => {
        const sorted = history.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );
        setChartData(sorted);
      })
      .catch((err) => {
        console.error("Error loading history:", err);
      });
  }, [selectedEcuId]);

  // Append live data to graph
useEffect(() => {
    if (liveData) {
      setChartData((prev) => [...prev, liveData]);
    }
  }, [liveData]);

  const handleEcuChange = (ecuId) => {
    setSelectedEcuId(ecuId);
  };

  if (loading) {
    return <div className="dashboard"><p>Loading ECUs...</p></div>;
  }

  if (error) {
    return <div className="dashboard"><p className="error">Error: {error}</p></div>;
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>ECU Dashboard</h1>
        <div className={`status ${isConnected ? "connected" : "disconnected"}`}>
          {isConnected ? "● Connected" : "● Disconnected"}
        </div>
      </div>

      <ECUSelector
        ecuList={ecuList}
        selectedEcuId={selectedEcuId}
        onEcuChange={handleEcuChange}
      />

      {selectedEcuId && (
        <>
          <div className="data-display">
            {liveData ? (
              <div className="live-data">
                <p><strong>ECU ID:</strong> {liveData.ecu_id}</p>
                <p><strong>Timestamp:</strong> {liveData.timestamp}</p>
                <p><strong>Voltage:</strong> {liveData.avg_voltage?.toFixed(2)} V</p>
                <p><strong>Current:</strong> {liveData.avg_current?.toFixed(2)} A</p>
                <p><strong>Energy:</strong> {liveData.energy?.toFixed(4)} kWh</p>
              </div>
            ) : (
              <p className="waiting-text">Waiting for data...</p>
            )}
          </div>

          {chartData.length > 0 && <EnergyChart data={chartData} />}
        </>
      )}

      {ecuList.length === 0 && <p>No ECUs available</p>}
    </div>
  );
}