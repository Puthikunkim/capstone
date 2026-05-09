import PropTypes from "prop-types";
import { useRef, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

export function TelemetryChart({ data, dataKey, color, unit, label }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No telemetry data yet</p>
        <span>Chart will populate as frames arrive</span>
      </div>
    );
  }

  const oldest = data[0].timestamp;
  const chartData = data.map((point, i) => ({
    ...point,
    time: i === data.length - 1 ? "Now" : formatRelativeTime(point.timestamp, oldest),
  }));

  const tickInterval = Math.max(0, Math.floor(chartData.length / 8));

  const values = chartData.map((d) => d[dataKey]).filter((v) => v != null);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = (maxVal - minVal) * 0.2 || 0.5;
  const domain = [
    parseFloat((minVal - pad).toFixed(2)),
    parseFloat((maxVal + pad).toFixed(2)),
  ];

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
          domain={domain}
          tick={CHART_STYLE.tick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v.toFixed(1)}${unit}`}
          width={52}
        />
        <Tooltip
          contentStyle={CHART_STYLE.tooltip}
          labelStyle={{ color: "#6b7a99", marginBottom: 4 }}
          formatter={(value) => [`${value?.toFixed(2)} ${unit}`, label]}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

TelemetryChart.propTypes = {
  data: PropTypes.array.isRequired,
  dataKey: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
  unit: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
};

const PX_PER_POINT = 8;
const MIN_CHART_WIDTH = 600;

export function HistoryChart({ data, dataKey, color, unit, label }) {
  const scrollRef = useRef(null);
  const isAtEnd = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtEnd.current) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [data]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtEnd.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 20;
  };

  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No history available</p>
        <span>Data will appear here once recorded</span>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
  }));

  const chartWidth = Math.max(MIN_CHART_WIDTH, chartData.length * PX_PER_POINT);

  const values = chartData.map((d) => d[dataKey]).filter((v) => v != null);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = (maxVal - minVal) * 0.2 || 0.5;
  const domain = [
    parseFloat((minVal - pad).toFixed(2)),
    parseFloat((maxVal + pad).toFixed(2)),
  ];

  return (
    <div className="history-chart-scroll" data-testid="history-chart-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div style={{ width: chartWidth, minWidth: "100%" }}>
        <LineChart
          width={chartWidth}
          height={200}
          data={chartData}
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_STYLE.cartesian.stroke}
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={CHART_STYLE.tick}
            interval="preserveStartEnd"
            minTickGap={60}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={domain}
            tick={CHART_STYLE.tick}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v.toFixed(1)}${unit}`}
            width={52}
          />
          <Tooltip
            contentStyle={CHART_STYLE.tooltip}
            labelStyle={{ color: "#6b7a99", marginBottom: 4 }}
            formatter={(value) => [`${value?.toFixed(2)} ${unit}`, label]}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </div>
    </div>
  );
}

HistoryChart.propTypes = {
  data: PropTypes.array.isRequired,
  dataKey: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
  unit: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
};
