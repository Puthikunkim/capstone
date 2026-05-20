import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CompetitionsPage } from './CompetitionsPage';

vi.mock('../api/http', () => ({
  fetchCompetitions: vi.fn(),
  fetchTeams: vi.fn(),
  createCompetition: vi.fn(),
  fetchCompetitionTeams: vi.fn(),
}));

vi.mock('../assets/evolocity_logo.png', () => ({ default: 'logo.png' }));

import { fetchCompetitions, fetchTeams, createCompetition, fetchCompetitionTeams } from '../api/http';

const COMP = {
  id: 1,
  name: 'Round 1',
  events: [{ id: 10, event_type: 'drag_race' }],
};

beforeEach(() => {
  fetchCompetitions.mockResolvedValue([]);
  fetchTeams.mockResolvedValue([]);
  createCompetition.mockResolvedValue({ ...COMP, id: 2, name: 'New Comp' });
  fetchCompetitionTeams.mockResolvedValue([]);
});

describe('CompetitionsPage — loading & empty', () => {
  test('shows loading indicator initially', () => {
    fetchCompetitions.mockReturnValue(new Promise(() => {}));
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  test('shows empty state when no competitions exist', async () => {
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('No competitions yet')).toBeInTheDocument()
    );
  });

  test('shows backend error when fetch fails', async () => {
    fetchCompetitions.mockRejectedValue(new Error('Network error'));
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('Cannot reach backend')).toBeInTheDocument()
    );
  });
});

describe('CompetitionsPage — competition list', () => {
  test('renders a card for each competition', async () => {
    fetchCompetitions.mockResolvedValue([COMP]);
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('Round 1')).toBeInTheDocument()
    );
  });

  test('shows event badge on competition card', async () => {
    fetchCompetitions.mockResolvedValue([COMP]);
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('Drag Race')).toBeInTheDocument()
    );
  });

  test('calls onSelectCompetition when Open Dashboard is clicked', async () => {
    fetchCompetitions.mockResolvedValue([COMP]);
    const onSelect = vi.fn();
    render(<CompetitionsPage onSelectCompetition={onSelect} />);
    await waitFor(() => screen.getByText('Open Dashboard →'));
    fireEvent.click(screen.getByText('Open Dashboard →'));
    expect(onSelect).toHaveBeenCalledWith(COMP);
  });
});

describe('CompetitionsPage — create modal', () => {
  test('opens modal when + New Competition is clicked', async () => {
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() => screen.getAllByText('+ New Competition'));
    fireEvent.click(screen.getAllByText('+ New Competition')[0]);
    expect(screen.getByText('New Competition')).toBeInTheDocument();
  });

  test('closes modal when Cancel is clicked', async () => {
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() => screen.getAllByText('+ New Competition'));
    fireEvent.click(screen.getAllByText('+ New Competition')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('New Competition')).not.toBeInTheDocument();
  });

  test('Create Competition button is disabled when name is empty', async () => {
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() => screen.getAllByText('+ New Competition'));
    fireEvent.click(screen.getAllByText('+ New Competition')[0]);
    expect(screen.getByRole('button', { name: 'Create Competition' })).toBeDisabled();
  });

  test('calls createCompetition and adds card to list on submit', async () => {
    render(<CompetitionsPage onSelectCompetition={() => {}} />);
    await waitFor(() => screen.getAllByText('+ New Competition'));
    fireEvent.click(screen.getAllByText('+ New Competition')[0]);
    fireEvent.change(screen.getByPlaceholderText(/Round 1/), { target: { value: 'New Comp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Competition' }));
    await waitFor(() => {
      expect(createCompetition).toHaveBeenCalled();
      expect(screen.getByText('New Comp')).toBeInTheDocument();
    });
  });
});
