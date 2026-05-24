import PropTypes from "prop-types";
import { useRef, useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function formatAgo(diffMs) {
  if (diffMs < 1000) return `-${(diffMs / 1000).toFixed(1)}s`;
  const totalSec = Math.round(diffMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `-${sec}s`;
  return sec === 0 ? `-${min}m` : `-${min}m${sec}s`;
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

  const newestMs = new Date(data[data.length - 1].timestamp).getTime();
  const chartData = data.map((point, i) => ({
    ...point,
    time: i === data.length - 1 ? "Now" : formatAgo(newestMs - new Date(point.timestamp).getTime()),
  }));

  // Show a tick every ~1 second worth of samples, capped to ~8 ticks total.
  const spanMs = newestMs - new Date(data[0].timestamp).getTime();
  const msPerPoint = spanMs / Math.max(1, data.length - 1);
  const pointsPerSec = msPerPoint > 0 ? Math.round(1000 / msPerPoint) : data.length;
  const rawInterval = Math.max(1, pointsPerSec);
  const tickInterval = Math.max(rawInterval, Math.floor(data.length / 8));

  const values = chartData.map((d) => d[dataKey]).filter((v) => v != null);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = (maxVal - minVal) * 0.2 || 0.5;
  const domain = [
    Number.parseFloat((minVal - pad).toFixed(2)),
    Number.parseFloat((maxVal + pad).toFixed(2)),
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
const OVERSCAN = 150; // extra points rendered on each side of the viewport

export function HistoryChart({ data, dataKey, color, unit, label, onLoadMore }) {
  const scrollRef = useRef(null);
  const isAtEnd = useRef(true);
  const rafRef = useRef(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const prevDataLengthRef = useRef(0);
  const prevFirstTsRef = useRef(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !data.length) return;

    const firstTs = data[0]?.timestamp;
    if (prevFirstTsRef.current && firstTs !== prevFirstTsRef.current) {
      // Data was prepended — shift scroll right so the visible window stays the same.
      const addedCount = data.length - prevDataLengthRef.current;
      el.scrollLeft += addedCount * PX_PER_POINT;
      setScrollLeft(el.scrollLeft);
      loadingMoreRef.current = false;
    } else if (isAtEnd.current) {
      el.scrollLeft = el.scrollWidth;
      setScrollLeft(el.scrollLeft);
    }

    prevFirstTsRef.current = firstTs;
    prevDataLengthRef.current = data.length;
  }, [data]);

  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtEnd.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 20;

    if (el.scrollLeft < 300 && onLoadMore && !loadingMoreRef.current) {
      loadingMoreRef.current = true;
      onLoadMore();
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setScrollLeft(el.scrollLeft));
  };

  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No history available</p>
        <span>Data will appear here once recorded</span>
      </div>
    );
  }

  const totalWidth = Math.max(MIN_CHART_WIDTH, data.length * PX_PER_POINT);
  const containerWidth = scrollRef.current?.clientWidth ?? 800;
  const visibleCount = Math.ceil(containerWidth / PX_PER_POINT);

  const startIdx = Math.max(0, Math.floor(scrollLeft / PX_PER_POINT) - OVERSCAN);
  const endIdx = Math.min(data.length, startIdx + visibleCount + OVERSCAN * 2);
  const windowedData = data.slice(startIdx, endIdx);

  const windowOffset = startIdx * PX_PER_POINT;
  const windowWidth = Math.max(MIN_CHART_WIDTH, windowedData.length * PX_PER_POINT);

  const chartData = windowedData.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
  }));

  // Compute domain from all data so the Y-axis stays stable while scrolling.
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const point of data) {
    const v = point[dataKey];
    if (v != null) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  const pad = (maxVal - minVal) * 0.2 || 0.5;
  const domain = [
    Number.parseFloat((minVal - pad).toFixed(2)),
    Number.parseFloat((maxVal + pad).toFixed(2)),
  ];

  return (
    <div
      className="history-chart-scroll"
      data-testid="history-chart-scroll"
      ref={scrollRef}
      onScroll={handleScroll}
      style={{ position: "relative" }}
    >
      {/* Full-width spacer keeps the scrollbar representing the entire dataset */}
      <div style={{ width: totalWidth, height: 200, position: "relative" }}>
        <div style={{ position: "absolute", left: windowOffset }}>
          <LineChart
            width={windowWidth}
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
    </div>
  );
}

HistoryChart.propTypes = {
  data: PropTypes.array.isRequired,
  dataKey: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
  unit: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onLoadMore: PropTypes.func,
};
