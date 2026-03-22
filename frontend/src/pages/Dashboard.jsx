// Dashboard page is the main view of the application.
// Responsibilities:
//   - Renders the full dashboard layout including chart
//   - Fetches ECU list from backend API
//   - Displays ECU selector dropdown

import { useState, useEffect } from "react";
import { ECUSelector } from "../components/ECUSelector";

const API_URL = "http://localhost:8000/api";

export function Dashboard() {
  const [ecuList, setEcuList] = useState([]);
  const [selectedEcuId, setSelectedEcuId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch ECUs from backend on component mount
  useEffect(() => {
    const fetchEcus = async () => {
      try {
        const response = await fetch(`${API_URL}/ecu`);
        if (!response.ok) {
          throw new Error(`Failed to fetch ECUs: ${response.statusText}`);
        }
        const ecus = await response.json();
        setEcuList(ecus);

        // Auto-select first ECU if available
        if (ecus.length > 0 && !selectedEcuId) {
          setSelectedEcuId(ecus[0].id);
        }
      } catch (err) {
        setError(err.message);
        console.error("Error fetching ECUs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchEcus();
  }, []);

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
      <h1>Dashboard</h1>
      <ECUSelector
        ecuList={ecuList}
        selectedEcuId={selectedEcuId}
        onEcuChange={handleEcuChange}
      />
      {selectedEcuId && <p>Selected ECU ID: {selectedEcuId}</p>}
      {ecuList.length === 0 && <p>No ECUs available</p>}
    </div>
  );
}
