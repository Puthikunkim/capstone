// HTTP utility is a wrapper around the browser Fetch API for REST calls.

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
}
