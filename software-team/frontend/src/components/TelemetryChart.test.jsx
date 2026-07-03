import { vi, describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TelemetryChart, HistoryChart } from './TelemetryChart';

const MockResponsiveContainer = vi.hoisted(() => {
  const Comp = ({ children }) => <div>{children}</div>;
  Comp.propTypes = { children: () => null };
  return Comp;
});

// Recharts relies on ResizeObserver and SVG layout APIs not available in jsdom.
vi.mock('recharts', () => ({
  LineChart: () => <div data-testid="line-chart" />,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: MockResponsiveContainer,
}));

const SAMPLE_DATA = [
  { timestamp: '2024-01-01T12:00:00Z', avg_voltage: 41.2, avg_current: -3.1, energy: -3.05 },
  { timestamp: '2024-01-01T12:00:01Z', avg_voltage: 41.5, avg_current: -3.0, energy: -3.04 },
];

const CHART_PROPS = { dataKey: 'avg_voltage', color: '#00c6ff', unit: 'V', label: 'Voltage' };

describe('TelemetryChart', () => {
  test('shows empty state when data is empty', () => {
    render(<TelemetryChart data={[]} {...CHART_PROPS} />);
    expect(screen.getByText('No telemetry data yet')).toBeInTheDocument();
  });

  test('does not render a chart when data is empty', () => {
    render(<TelemetryChart data={[]} {...CHART_PROPS} />);
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });

  test('renders a line chart when data is provided', () => {
    render(<TelemetryChart data={SAMPLE_DATA} {...CHART_PROPS} />);
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  test('does not show empty state when data is provided', () => {
    render(<TelemetryChart data={SAMPLE_DATA} {...CHART_PROPS} />);
    expect(screen.queryByText('No telemetry data yet')).not.toBeInTheDocument();
  });

  test('renders with a single data point', () => {
    render(<TelemetryChart data={[SAMPLE_DATA[0]]} {...CHART_PROPS} />);
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });
});

describe('HistoryChart', () => {
  test('shows empty state when data is empty', () => {
    render(<HistoryChart data={[]} {...CHART_PROPS} />);
    expect(screen.getByText('No history available')).toBeInTheDocument();
  });

  test('does not render a scroll container when data is empty', () => {
    render(<HistoryChart data={[]} {...CHART_PROPS} />);
    expect(screen.queryByTestId('history-chart-scroll')).not.toBeInTheDocument();
  });

  test('renders a scrollable container when data is provided', () => {
    render(<HistoryChart data={SAMPLE_DATA} {...CHART_PROPS} />);
    expect(screen.getByTestId('history-chart-scroll')).toBeInTheDocument();
  });

  test('renders a line chart when data is provided', () => {
    render(<HistoryChart data={SAMPLE_DATA} {...CHART_PROPS} />);
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  test('does not show empty state when data is provided', () => {
    render(<HistoryChart data={SAMPLE_DATA} {...CHART_PROPS} />);
    expect(screen.queryByText('No history available')).not.toBeInTheDocument();
  });

  test('renders with a single data point', () => {
    render(<HistoryChart data={[SAMPLE_DATA[0]]} {...CHART_PROPS} />);
    expect(screen.getByTestId('history-chart-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  test('renders for current metric', () => {
    render(
      <HistoryChart
        data={SAMPLE_DATA}
        dataKey="avg_current"
        color="#f59e0b"
        unit="A"
        label="Current"
      />
    );
    expect(screen.getByTestId('history-chart-scroll')).toBeInTheDocument();
  });
});
