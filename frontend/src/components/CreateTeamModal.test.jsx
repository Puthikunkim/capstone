import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CreateTeamModal } from './CreateTeamModal';

vi.mock('../api/http', () => ({
  createTeam: vi.fn(),
  fetchAvailableEcus: vi.fn(),
  assignEcuToTeam: vi.fn(),
}));

import { createTeam, fetchAvailableEcus } from '../api/http';

const CREATED_TEAM = { id: 99, name: 'Team Gamma', vehicle_class: 'Standard', vehicle_type: 'bike' };

beforeEach(() => {
  createTeam.mockResolvedValue(CREATED_TEAM);
  fetchAvailableEcus.mockResolvedValue([]);
});

describe('CreateTeamModal — step 1 rendering', () => {
  test('renders team name input', () => {
    render(<CreateTeamModal competitionId={1} onCreated={() => {}} onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/Team Alpha/)).toBeInTheDocument();
  });

  test('renders vehicle class and type selects', () => {
    render(<CreateTeamModal competitionId={1} onCreated={() => {}} onClose={() => {}} />);
    expect(screen.getByDisplayValue('Standard Class')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bike')).toBeInTheDocument();
  });

  test('Create Team button is disabled when name is empty', () => {
    render(<CreateTeamModal competitionId={1} onCreated={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Create Team/ })).toBeDisabled();
  });

  test('Create Team button enables when name is typed', () => {
    render(<CreateTeamModal competitionId={1} onCreated={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Team Alpha/), { target: { value: 'Team Gamma' } });
    expect(screen.getByRole('button', { name: /Create Team/ })).not.toBeDisabled();
  });

  test('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<CreateTeamModal competitionId={1} onCreated={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CreateTeamModal — submission', () => {
  test('calls createTeam with correct payload on submit', async () => {
    render(<CreateTeamModal competitionId={5} onCreated={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Team Alpha/), { target: { value: 'Team Gamma' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Team/ }));
    await waitFor(() =>
      expect(createTeam).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Team Gamma',
        competition_id: 5,
      }))
    );
  });

  test('calls onCreated with the new team after creation', async () => {
    const onCreated = vi.fn();
    render(<CreateTeamModal competitionId={1} onCreated={onCreated} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Team Alpha/), { target: { value: 'Team Gamma' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Team/ }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(CREATED_TEAM, null)
    );
  });

  test('shows error message when creation fails', async () => {
    createTeam.mockRejectedValue(new Error('Name already taken'));
    render(<CreateTeamModal competitionId={1} onCreated={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Team Alpha/), { target: { value: 'Team Gamma' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Team/ }));
    await waitFor(() =>
      expect(screen.getByText('Name already taken')).toBeInTheDocument()
    );
  });

  test('trims whitespace from team name before submitting', async () => {
    render(<CreateTeamModal competitionId={1} onCreated={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Team Alpha/), { target: { value: '  Team Gamma  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Team/ }));
    await waitFor(() =>
      expect(createTeam).toHaveBeenCalledWith(expect.objectContaining({ name: 'Team Gamma' }))
    );
  });
});
