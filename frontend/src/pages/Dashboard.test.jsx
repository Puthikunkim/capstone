import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Dashboard } from './Dashboard';

vi.mock('../api/http', () => ({
  fetchEcu: vi.fn(),
  fetchEcuHistory: vi.fn(),
  fetchViolations: vi.fn(),
  configureEcu: vi.fn(),
  uploadFirmware: vi.fn(),
  fetchFirmwareStatus: vi.fn(),
}));

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}));

vi.mock('../components/TelemetryChart', () => ({
  TelemetryChart: () => <div data-testid="telemetry-chart" />,
}));

import { fetchEcu, fetchEcuHistory, fetchViolations, fetchFirmwareStatus } from '../api/http';
import { useWebSocket } from '../hooks/useWebSocket';

const ECU = { id: 1, serial_number: 1001, team_number: 1, vehicle_class: 'Standard', vehicle_type: 'kart' };

beforeEach(() => {
  useWebSocket.mockReturnValue({ isConnected: false, liveData: null });
  fetchEcu.mockResolvedValue(ECU);
  fetchEcuHistory.mockResolvedValue([]);
  fetchViolations.mockResolvedValue([]);
  fetchFirmwareStatus.mockResolvedValue(null);
});

describe('Dashboard — error state', () => {
  test('shows backend error UI when backendError is true', () => {
    render(<Dashboard backendError={true} />);
    expect(screen.getByTestId('backend-error')).toBeInTheDocument();
  });

  test('does not show dashboard content when backendError is true', () => {
    render(<Dashboard backendError={true} />);
    expect(screen.queryByTestId('connection-status')).not.toBeInTheDocument();
  });
});

describe('Dashboard — empty state', () => {
  test('shows empty state when no ECU is selected', () => {
    render(<Dashboard selectedEcuId={null} />);
    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
  });

  test('does not fetch ECU data when no ECU is selected', () => {
    render(<Dashboard selectedEcuId={null} />);
    expect(fetchEcu).not.toHaveBeenCalled();
  });
});

describe('Dashboard — ECU selected', () => {
  test('fetches ECU, history, and violations when an ECU is selected', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() => {
      expect(fetchEcu).toHaveBeenCalledWith(1);
      expect(fetchEcuHistory).toHaveBeenCalledWith(1);
      expect(fetchViolations).toHaveBeenCalledWith(1);
    });
  });

  test('shows connection status indicator', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() =>
      expect(screen.getByTestId('connection-status')).toBeInTheDocument()
    );
  });
});

describe('Dashboard — connection status', () => {
  test('connection status is inactive when disconnected', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() =>
      expect(screen.getByTestId('connection-status')).not.toHaveClass('active')
    );
  });

  test('connection status is active when WebSocket is connected', async () => {
    useWebSocket.mockReturnValue({ isConnected: true, liveData: null });
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() =>
      expect(screen.getByTestId('connection-status')).toHaveClass('active')
    );
  });
});

describe('Dashboard — chart', () => {
  test('shows empty chart placeholder when disconnected and no data', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() =>
      expect(screen.getByTestId('chart-empty')).toBeInTheDocument()
    );
  });

  test('shows TelemetryChart when history data is available', async () => {
    const history = [
      { timestamp: '2024-01-01T12:00:00Z', avg_voltage: 41.0, avg_current: -3.0, energy: -3.0 },
    ];
    fetchEcuHistory.mockResolvedValue(history);
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() =>
      expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(2)
    );
  });
});

describe('Dashboard — alerts', () => {
  test('shows no-alerts placeholder when no violations exist', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() =>
      expect(screen.getByTestId('alerts-empty')).toBeInTheDocument()
    );
  });
});
