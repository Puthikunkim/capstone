import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Dashboard } from './Dashboard';

vi.mock('../api/http', () => ({
  fetchEcu: vi.fn(),
  fetchEcuHistory: vi.fn(),
  fetchTeamFrames: vi.fn(),
  fetchViolations: vi.fn(),
  configureEcu: vi.fn(),
  uploadFirmware: vi.fn(),
  fetchFirmwareStatus: vi.fn(),
}));

vi.mock('../hooks/useWebSocket', () => ({
  useTeamWebSocket: vi.fn(),
}));

vi.mock('../components/TelemetryChart', () => ({
  TelemetryChart: () => <div data-testid="telemetry-chart" />,
  HistoryChart: () => <div data-testid="history-chart" />,
}));

import { fetchEcu, fetchEcuHistory, fetchTeamFrames, fetchViolations, fetchFirmwareStatus } from '../api/http';
import { useTeamWebSocket } from '../hooks/useWebSocket';

const ECU = { id: 1, mac_address: 'AA:BB:CC:DD:EE:01', team_number: 1, vehicle_class: 'Standard', vehicle_type: 'kart', is_connected: false };
const HISTORY = [
  { timestamp: '2024-01-01T12:00:00Z', voltage_samples: [41], current_samples: [-3], energy: -3 },
];

beforeEach(() => {
  useTeamWebSocket.mockReturnValue({ isConnected: false, liveData: null });
  fetchEcu.mockResolvedValue(ECU);
  fetchEcuHistory.mockResolvedValue([]);
  fetchTeamFrames.mockResolvedValue([]);
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
    render(<Dashboard selectedEcuId={1} teamId={1} />);
    await waitFor(() => {
      expect(fetchEcu).toHaveBeenCalledWith(1);
      expect(fetchEcuHistory).toHaveBeenCalledWith(1, { limit: 100, teamId: 1 });
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

  test('connection status is active when ECU is connected', async () => {
    fetchEcu.mockResolvedValue({ ...ECU, is_connected: true });
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
      expect(screen.getAllByTestId('chart-empty')).toHaveLength(3)
    );
  });

  test('shows TelemetryChart when history data is available', async () => {
    fetchEcuHistory.mockResolvedValue(HISTORY);
    render(<Dashboard selectedEcuId={1} teamId={1} />);
    await waitFor(() =>
      expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(3)
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

describe('Dashboard — Live/History toggle', () => {
  test('renders Live and History toggle buttons for each chart', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() => expect(screen.getByTestId('connection-status')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Live' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'History' })).toHaveLength(3);
  });

  test('Live buttons are active and History buttons are not by default', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() => expect(screen.getByTestId('connection-status')).toBeInTheDocument());
    screen.getAllByRole('button', { name: 'Live' }).forEach(btn =>
      expect(btn).toHaveClass('active')
    );
    screen.getAllByRole('button', { name: 'History' }).forEach(btn =>
      expect(btn).not.toHaveClass('active')
    );
  });

  test('clicking History on voltage chart shows HistoryChart and removes one TelemetryChart', async () => {
    fetchEcuHistory.mockResolvedValue(HISTORY);
    render(<Dashboard selectedEcuId={1} teamId={1} />);
    await waitFor(() => expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(3));

    fireEvent.click(screen.getAllByRole('button', { name: 'History' })[0]);

    expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(2);
    expect(screen.getByTestId('history-chart')).toBeInTheDocument();
  });

  test('clicking History on current chart shows HistoryChart and removes one TelemetryChart', async () => {
    fetchEcuHistory.mockResolvedValue(HISTORY);
    render(<Dashboard selectedEcuId={1} teamId={1} />);
    await waitFor(() => expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(3));

    fireEvent.click(screen.getAllByRole('button', { name: 'History' })[1]);

    expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(2);
    expect(screen.getByTestId('history-chart')).toBeInTheDocument();
  });

  test('History button gains active class and Live loses it after switching', async () => {
    render(<Dashboard selectedEcuId={1} />);
    await waitFor(() => expect(screen.getByTestId('connection-status')).toBeInTheDocument());

    const [liveBtn, historyBtn] = [
      screen.getAllByRole('button', { name: 'Live' })[0],
      screen.getAllByRole('button', { name: 'History' })[0],
    ];

    fireEvent.click(historyBtn);

    expect(historyBtn).toHaveClass('active');
    expect(liveBtn).not.toHaveClass('active');
  });

  test('clicking Live after History switches back to TelemetryChart', async () => {
    fetchEcuHistory.mockResolvedValue(HISTORY);
    render(<Dashboard selectedEcuId={1} teamId={1} />);
    await waitFor(() => expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(3));

    fireEvent.click(screen.getAllByRole('button', { name: 'History' })[0]);
    expect(screen.getByTestId('history-chart')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Live' })[0]);
    expect(screen.queryByTestId('history-chart')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(3);
  });

  test('toggles reset to Live when a different ECU is selected', async () => {
    fetchEcuHistory.mockResolvedValue(HISTORY);
    const { rerender } = render(<Dashboard selectedEcuId={1} teamId={1} />);
    await waitFor(() => expect(screen.getAllByTestId('telemetry-chart')).toHaveLength(3));

    fireEvent.click(screen.getAllByRole('button', { name: 'History' })[0]);
    expect(screen.getByTestId('history-chart')).toBeInTheDocument();

    rerender(<Dashboard selectedEcuId={2} teamId={1} />);
    await waitFor(() =>
      expect(screen.queryByTestId('history-chart')).not.toBeInTheDocument()
    );
  });
});
