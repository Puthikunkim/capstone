import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

const noop = () => {};

const TEAMS = [
  { id: 1, name: 'Team Alpha', vehicle_class: 'Standard', vehicle_type: 'bike' },
  { id: 2, name: 'Team Beta', vehicle_class: 'Open', vehicle_type: 'kart' },
];

const ECUS = [
  { id: 10, serial_number: '1001', team_id: 1, team_number: 1, is_connected: true, last_seen: '2024-01-01T12:00:00Z', flash_usage: null, vehicle_class: 'Standard' },
  { id: 11, serial_number: '1002', team_id: null, team_number: 2, is_connected: false, last_seen: null, flash_usage: null, vehicle_class: 'Standard' },
];

describe('Sidebar — team mode', () => {
  test('renders a card for each team', () => {
    render(<Sidebar teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('Team Beta')).toBeInTheDocument();
  });

  test('shows "No ECU assigned" for team without ECU', () => {
    render(<Sidebar teams={TEAMS} ecuList={[]} onSelectTeam={noop} />);
    expect(screen.getAllByText('No ECU assigned')).toHaveLength(2);
  });

  test('shows ECU serial number for team with ECU', () => {
    render(<Sidebar teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    expect(screen.getByText('ECU #1001')).toBeInTheDocument();
  });

  test('shows empty state when no teams exist', () => {
    render(<Sidebar teams={[]} ecuList={[]} onSelectTeam={noop} />);
    expect(screen.getByText('No teams in this competition')).toBeInTheDocument();
  });

  test('calls onSelectTeam when a team card is clicked', () => {
    const onSelectTeam = vi.fn();
    render(<Sidebar teams={TEAMS} ecuList={ECUS} onSelectTeam={onSelectTeam} />);
    fireEvent.click(screen.getByText('Team Alpha'));
    expect(onSelectTeam).toHaveBeenCalledWith(TEAMS[0]);
  });

  test('filters teams by name query', () => {
    render(<Sidebar teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    fireEvent.change(screen.getByPlaceholderText('Find team or ECU…'), {
      target: { value: 'Alpha' },
    });
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Team Beta')).not.toBeInTheDocument();
  });

  test('shows no-results message when search matches nothing', () => {
    render(<Sidebar teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    fireEvent.change(screen.getByPlaceholderText('Find team or ECU…'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });

  test('shows add-team button when onCreateTeam is provided', () => {
    render(<Sidebar teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} onCreateTeam={noop} />);
    expect(screen.getByTitle('Add team')).toBeInTheDocument();
  });

  test('calls onCreateTeam when add button is clicked', () => {
    const onCreateTeam = vi.fn();
    render(<Sidebar teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} onCreateTeam={onCreateTeam} />);
    fireEvent.click(screen.getByTitle('Add team'));
    expect(onCreateTeam).toHaveBeenCalledOnce();
  });
});

describe('Sidebar — ECU-only mode (no teams prop)', () => {
  test('renders ECU items when teams is not provided', () => {
    render(<Sidebar ecuList={ECUS} onSelectTeam={noop} />);
    expect(screen.getByText('Team 1')).toBeInTheDocument();
  });

  test('shows empty state when no ECUs registered', () => {
    render(<Sidebar ecuList={[]} onSelectTeam={noop} />);
    expect(screen.getByText('No ECUs registered')).toBeInTheDocument();
  });

  test('filters ECUs by team number query', () => {
    render(<Sidebar ecuList={ECUS} onSelectTeam={noop} />);
    fireEvent.change(screen.getByPlaceholderText('Find ECU or Team…'), {
      target: { value: 'team 1' },
    });
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(screen.queryByText('Team 2')).not.toBeInTheDocument();
  });
});
