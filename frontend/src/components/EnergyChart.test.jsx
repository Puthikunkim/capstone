import { vi, describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnergyChart } from './EnergyChart';

const MockResponsiveContainer = vi.hoisted(() => {
  const Comp = ({ children }) => <div>{children}</div>;
  Comp.propTypes = { children: () => null };
  return Comp;
});

// Recharts relies on ResizeObserver and SVG layout APIs not available in jsdom.
// Replace all chart primitives with lightweight stubs.
vi.mock('recharts', () => ({
  LineChart: () => <div data-testid="line-chart" />,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: MockResponsiveContainer,
}));

const SAMPLE_DATA = [
  { timestamp: '2024-01-01T12:00:00Z', avg_voltage: 41.2, avg_current: -3.1, energy: -3.05 },
  { timestamp: '2024-01-01T12:00:01Z', avg_voltage: 41.5, avg_current: -3.0, energy: -3.04 },
];

describe('EnergyChart', () => {
  test('shows empty state when data array is empty', () => {
    render(<EnergyChart data={[]} />);
    expect(screen.getByTestId('energy-chart-empty')).toBeInTheDocument();
  });

  test('does not render chart panels when data is empty', () => {
    render(<EnergyChart data={[]} />);
    expect(screen.queryByTestId('voltage-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('current-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('energy-chart-panel')).not.toBeInTheDocument();
  });

  test('renders voltage chart panel when data is provided', () => {
    render(<EnergyChart data={SAMPLE_DATA} />);
    expect(screen.getByTestId('voltage-chart')).toBeInTheDocument();
  });

  test('renders current chart panel when data is provided', () => {
    render(<EnergyChart data={SAMPLE_DATA} />);
    expect(screen.getByTestId('current-chart')).toBeInTheDocument();
  });

  test('renders energy chart panel when data is provided', () => {
    render(<EnergyChart data={SAMPLE_DATA} />);
    expect(screen.getByTestId('energy-chart-panel')).toBeInTheDocument();
  });

  test('renders three line charts when data is provided', () => {
    render(<EnergyChart data={SAMPLE_DATA} />);
    expect(screen.getAllByTestId('line-chart')).toHaveLength(3);
  });

  test('does not show empty state when data is provided', () => {
    render(<EnergyChart data={SAMPLE_DATA} />);
    expect(screen.queryByTestId('energy-chart-empty')).not.toBeInTheDocument();
  });

  test('renders all three panels with a single data point', () => {
    render(<EnergyChart data={[SAMPLE_DATA[0]]} />);
    expect(screen.getByTestId('voltage-chart')).toBeInTheDocument();
    expect(screen.getByTestId('current-chart')).toBeInTheDocument();
    expect(screen.getByTestId('energy-chart-panel')).toBeInTheDocument();
  });
});
