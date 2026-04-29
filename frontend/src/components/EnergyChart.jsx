// EnergyChart component displays real-time line charts for voltage, current, and energy.
// Uses Recharts to visualize data with separate Y-axes for each metric.

import PropTypes from 'prop-types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import "./EnergyChart.css";

export function EnergyChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="energy-chart" data-testid="energy-chart"><p data-testid="energy-chart-empty">No data to display</p></div>;
  }

  // Format timestamp for X-axis display (HH:MM:SS)
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  // Prepare data with formatted timestamps
  const chartData = data.map((point) => ({
    ...point,
    time: formatTime(point.timestamp),
  }));

  const chartWidth = Math.max(chartData.length * 20, 600);

  return (
    <div className="energy-chart" data-testid="energy-chart">
        <div className="chart-scroll">
      {/* Voltage Chart */}
      <div className="chart-container" data-testid="voltage-chart">
        <h3>Voltage (V)</h3>
        <ResponsiveContainer width={chartWidth} height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12 }}
              interval={Math.max(0, Math.floor(chartData.length / 6))}
            />
            <YAxis
              label={{ value: "Voltage (V)", angle: -90, position: "insideLeft" }}
              domain={[40, 42]}
              tickFormatter={(value) => value.toFixed(2)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #ccc",
                borderRadius: "4px",
                padding: "8px",
              }}
              formatter={(value) => [value?.toFixed(2) + " V", "Voltage"]}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="avg_voltage"
              stroke="#1976d2"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              name="Avg Voltage"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Current Chart */}
      <div className="chart-container" data-testid="current-chart">
        <h3>Current (A)</h3>
        <ResponsiveContainer width={chartWidth} height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12 }}
              interval={Math.max(0, Math.floor(chartData.length / 6))}
            />
            <YAxis
              label={{ value: "Current (A)", angle: -90, position: "insideLeft" }}
              domain={[-3.5, -2.5]}
              tickFormatter={(value) => value.toFixed(2)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #ccc",
                borderRadius: "4px",
                padding: "8px",
              }}
              formatter={(value) => [value?.toFixed(2) + " A", "Current"]}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="avg_current"
              stroke="#ff9800"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              name="Avg Current"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Energy Chart */}
      <div className="chart-container" data-testid="energy-chart-panel">
        <h3>Energy (kWh)</h3>
        <ResponsiveContainer width={chartWidth} height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12 }}
              interval={Math.max(0, Math.floor(chartData.length / 6))}
            />
            <YAxis
              label={{ value: "Energy (kWh)", angle: -90, position: "insideLeft" }}
              domain={[-3.15, -2.95]}
              tickFormatter={(value) => value.toFixed(2)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #ccc",
                borderRadius: "4px",
                padding: "8px",
              }}
              formatter={(value) => [value?.toFixed(4) + " kWh", "Energy"]}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="energy"
              stroke="#4caf50"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              name="Energy"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      </div>
    </div>
  );
}

EnergyChart.propTypes = {
  data: PropTypes.array.isRequired,
};