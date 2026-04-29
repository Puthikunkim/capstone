import PropTypes from "prop-types";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

function formatRelativeTime(timestamp, oldestTimestamp) {
  const diffMs = new Date(timestamp) - new Date(oldestTimestamp);
  const diffMin = Math.floor(diffMs / 60000);
  const diffSec = Math.floor((diffMs % 60000) / 1000);
  if (diffMin === 0) return `${diffSec}s`;
  return diffSec === 0 ? `${diffMin}m` : `${diffMin}m${diffSec}s`;
}

const CHART_STYLE = {
  tooltip: {
    backgroundColor: "#111827",
    border: "1px solid #1e2a3a",
    borderRadius: "6px",
    fontSize: "12px",
    color: "#e8edf5",
  },
  cartesian: { stroke: "#1e2a3a" },
  tick: { fill: "#6b7a99", fontSize: 11 },
};

export function TelemetryChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No telemetry data yet</p>
        <span>Chart will populate as frames arrive</span>
      </div>
    );
  }

  const oldest = data[0].timestamp;
  const chartData = data.map((point) => ({
    ...point,
    time:
      point === data[data.length - 1]
        ? "Now"
        : formatRelativeTime(point.timestamp, oldest),
  }));

  const tickInterval = Math.max(0, Math.floor(chartData.length / 8));

  return (
    <div className="telemetry-chart">
      <div className="telemetry-legend">
        <span className="legend-item voltage">
          <span className="legend-dot" /> Voltage (V)
        </span>
        <span className="legend-item current">
          <span className="legend-dot" /> Current (A)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_STYLE.cartesian.stroke}
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={CHART_STYLE.tick}
            interval={tickInterval}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="v"
            orientation="left"
            tick={CHART_STYLE.tick}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}V`}
            width={40}
          />
          <YAxis
            yAxisId="a"
            orientation="right"
            tick={CHART_STYLE.tick}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}A`}
            width={36}
          />
          <Tooltip
            contentStyle={CHART_STYLE.tooltip}
            labelStyle={{ color: "#6b7a99", marginBottom: 4 }}
            formatter={(value, name) => {
              if (name === "avg_voltage") return [`${value?.toFixed(2)} V`, "Voltage"];
              if (name === "avg_current") return [`${value?.toFixed(2)} A`, "Current"];
              return [value, name];
            }}
          />
          <Line
            yAxisId="v"
            type="monotone"
            dataKey="avg_voltage"
            stroke="#00c6ff"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            name="avg_voltage"
          />
          <Line
            yAxisId="a"
            type="monotone"
            dataKey="avg_current"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            name="avg_current"
          />
          <Legend wrapperStyle={{ display: "none" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

TelemetryChart.propTypes = {
  data: PropTypes.array.isRequired,
};
