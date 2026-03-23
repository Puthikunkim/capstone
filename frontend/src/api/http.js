const API_URL = "http://localhost:8000/api";

/**
 * Generic fetch wrapper with error handling
 * @param {string} endpoint - The API endpoint (e.g., '/ecu')
 * @param {object} options - Fetch options (method, headers, body, etc.)
 * @returns {Promise<any>} The parsed JSON response
 */
async function fetchApi(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch all ECUs from the backend
 * @returns {Promise<Array>} List of ECUs
 */
export async function fetchEcus() {
  return fetchApi("/ecu");
}

/**
 * Fetch a specific ECU by ID
 * @param {number} ecuId - The ECU ID
 * @returns {Promise<object>} ECU details
 */
export async function fetchEcu(ecuId) {
  return fetchApi(`/ecu/${ecuId}`);
}// HTTP utility is a wrapper around the browser Fetch API for REST calls.

/**
 * Fetch a specific ECU's historical data
 * @param {number} ecuId - The ECU ID
 * @returns {Promise<object>} ECU's historical data
 */
export async function fetchEcuHistory(ecuId) {
    // MOCK DATA for now
//   return generateMockHistory(ecuId);
   return fetchApi(`/ecu/${ecuId}/history`);
}

// function generateMockHistory() {
//   const now = Date.now();

//   return Array.from({ length: 50 }).map((_, i) => ({
//     timestamp: new Date(now - (50 - i) * 1000).toISOString(),
//     avg_voltage: 41 + Math.random() * 0.5,
//     avg_current: -3 + (Math.random() - 0.5) * 0.2,
//     energy: -3 + (Math.random() - 0.5) * 0.05,
//   }));
// }
