import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AssignEcuModal } from './AssignEcuModal';

vi.mock('../api/http', () => ({
  fetchAvailableEcus: vi.fn(),
  assignEcuToTeam: vi.fn(),
}));

import { fetchAvailableEcus, assignEcuToTeam } from '../api/http';

const TEAM = { id: 1, name: 'Team Alpha' };
const ECU = { id: 10, serial_number: '1001', is_connected: true };

beforeEach(() => {
  fetchAvailableEcus.mockResolvedValue([]);
  assignEcuToTeam.mockResolvedValue({});
});

describe('AssignEcuModal — loading', () => {
  test('shows loading indicator initially', () => {
    fetchAvailableEcus.mockReturnValue(new Promise(() => {}));
    render(<AssignEcuModal team={TEAM} onAssigned={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Loading available ECUs/)).toBeInTheDocument();
  });
});

describe('AssignEcuModal — empty state', () => {
  test('shows empty state when no ECUs are available', async () => {
    fetchAvailableEcus.mockResolvedValue([]);
    render(<AssignEcuModal team={TEAM} onAssigned={() => {}} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('No unassigned ECUs')).toBeInTheDocument()
    );
  });
});

describe('AssignEcuModal — ECU list', () => {
  test('renders an assign button for each available ECU', async () => {
    fetchAvailableEcus.mockResolvedValue([ECU]);
    render(<AssignEcuModal team={TEAM} onAssigned={() => {}} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('ECU #10')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });

  test('calls assignEcuToTeam and onAssigned when assign is clicked', async () => {
    fetchAvailableEcus.mockResolvedValue([ECU]);
    const onAssigned = vi.fn();
    const onClose = vi.fn();
    render(<AssignEcuModal team={TEAM} onAssigned={onAssigned} onClose={onClose} />);
    await waitFor(() => screen.getByRole('button', { name: 'Assign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => {
      expect(assignEcuToTeam).toHaveBeenCalledWith(TEAM.id, ECU.id);
      expect(onAssigned).toHaveBeenCalledWith(ECU.id);
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('shows error message when assignment fails', async () => {
    fetchAvailableEcus.mockResolvedValue([ECU]);
    assignEcuToTeam.mockRejectedValue(new Error('Server error'));
    render(<AssignEcuModal team={TEAM} onAssigned={() => {}} onClose={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: 'Assign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(screen.getByText('Server error')).toBeInTheDocument()
    );
  });
});

describe('AssignEcuModal — close', () => {
  test('calls onClose when Cancel is clicked', async () => {
    fetchAvailableEcus.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<AssignEcuModal team={TEAM} onAssigned={() => {}} onClose={onClose} />);
    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  test('team name appears in modal subtitle', () => {
    fetchAvailableEcus.mockReturnValue(new Promise(() => {}));
    render(<AssignEcuModal team={TEAM} onAssigned={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
  });
});
