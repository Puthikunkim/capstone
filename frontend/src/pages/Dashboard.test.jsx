/* eslint-disable react/prop-types */
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from './Dashboard';

vi.mock('../api/http', () => ({
  fetchEcus: vi.fn(),
  fetchEcuHistory: vi.fn(),
}));

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}));

// Stub EnergyChart to avoid Recharts SVG issues and make assertions simpler.
vi.mock('../components/EnergyChart', () => ({
  EnergyChart: ({ data }) => <div data-testid="energy-chart">{data.length} points</div>,
}));

import { fetchEcus, fetchEcuHistory } from '../api/http';
import { useWebSocket } from '../hooks/useWebSocket';

const ECU_1 = { id: 1, serial_number: 1001 };
const ECU_2 = { id: 2, serial_number: 2002 };
const LIVE_DATA = {
  ecu_id: 1,
  timestamp: '2024-01-01T12:00:00Z',
  avg_voltage: 41.5,
  avg_current: -3.0,
  energy: -3.05,
};

beforeEach(() => {
  useWebSocket.mockReturnValue({ isConnected: false, liveData: null });
  fetchEcus.mockResolvedValue([]);
  fetchEcuHistory.mockResolvedValue([]);
});

describe('Dashboard — loading and error states', () => {
  test('shows a loading indicator before data arrives', () => {
    fetchEcus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Dashboard />);
    expect(screen.getByText('Loading ECUs...')).toBeInTheDocument();
  });

  test('shows an error message when fetchEcus rejects', async () => {
    fetchEcus.mockRejectedValue(new Error('Network error'));
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Error: Network error/)).toBeInTheDocument()
    );
  });

  test('shows "No ECUs available" when the list is empty', async () => {
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('No ECUs available')).toBeInTheDocument()
    );
  });
});

describe('Dashboard — ECU loading', () => {
  test('renders ECUSelector after ECUs load', async () => {
    fetchEcus.mockResolvedValue([ECU_1]);
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
  });

  test('auto-selects the first ECU and fetches its history', async () => {
    fetchEcus.mockResolvedValue([ECU_1, ECU_2]);
    render(<Dashboard />);
    await waitFor(() => expect(fetchEcuHistory).toHaveBeenCalledWith(ECU_1.id));
  });

  test('does not call fetchEcuHistory when no ECUs exist', async () => {
    render(<Dashboard />);
    await waitFor(() => screen.getByText('No ECUs available'));
    expect(fetchEcuHistory).not.toHaveBeenCalled();
  });

  test('fetches new history when the ECU selection changes', async () => {
    fetchEcus.mockResolvedValue([ECU_1, ECU_2]);
    render(<Dashboard />);
    await waitFor(() => screen.getByRole('combobox'));
    await userEvent.selectOptions(screen.getByRole('combobox'), '2');
    await waitFor(() => expect(fetchEcuHistory).toHaveBeenCalledWith(ECU_2.id));
  });
});

describe('Dashboard — connection status', () => {
  test('shows Disconnected when WebSocket is not connected', async () => {
    fetchEcus.mockResolvedValue([ECU_1]);
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('● Disconnected')).toBeInTheDocument()
    );
  });

  test('shows Connected when WebSocket is connected', async () => {
    useWebSocket.mockReturnValue({ isConnected: true, liveData: null });
    fetchEcus.mockResolvedValue([ECU_1]);
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('● Connected')).toBeInTheDocument()
    );
  });
});

describe('Dashboard — live data', () => {
  test('shows "Waiting for data..." when an ECU is selected but no live data', async () => {
    fetchEcus.mockResolvedValue([ECU_1]);
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('Waiting for data...')).toBeInTheDocument()
    );
  });

  test('shows live voltage when liveData is set', async () => {
    useWebSocket.mockReturnValue({ isConnected: true, liveData: LIVE_DATA });
    fetchEcus.mockResolvedValue([ECU_1]);
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/41.50 V/)).toBeInTheDocument()
    );
  });

  test('shows live current when liveData is set', async () => {
    useWebSocket.mockReturnValue({ isConnected: true, liveData: LIVE_DATA });
    fetchEcus.mockResolvedValue([ECU_1]);
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/-3.00 A/)).toBeInTheDocument()
    );
  });

  test('renders EnergyChart when chartData is populated from history', async () => {
    const history = [
      { timestamp: '2024-01-01T12:00:00Z', avg_voltage: 41.0, avg_current: -3.0, energy: -3.0 },
    ];
    fetchEcus.mockResolvedValue([ECU_1]);
    fetchEcuHistory.mockResolvedValue(history);
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId('energy-chart')).toBeInTheDocument()
    );
  });

  test('does not render EnergyChart when chartData is empty', async () => {
    fetchEcus.mockResolvedValue([ECU_1]);
    render(<Dashboard />);
    await waitFor(() => screen.getByText('Waiting for data...'));
    expect(screen.queryByTestId('energy-chart')).not.toBeInTheDocument();
  });
});
