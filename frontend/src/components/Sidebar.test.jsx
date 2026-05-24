import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

const noop = () => {};

const TEAMS = [
  { id: 1, name: 'Team Alpha', vehicle_class: 'Standard', vehicle_type: 'bike' },
  { id: 2, name: 'Team Beta', vehicle_class: 'Open', vehicle_type: 'kart' },
];

const ECUS = [
  { id: 10, mac_address: 'AA:BB:CC:DD:EE:01', team_id: 1, team_number: 1, is_connected: true, last_seen: '2024-01-01T12:00:00Z', flash_usage: null, vehicle_class: 'Standard' },
  { id: 11, mac_address: 'AA:BB:CC:DD:EE:02', team_id: null, team_number: 2, is_connected: false, last_seen: null, flash_usage: null, vehicle_class: 'Standard' },
];

const SELECTED_EVENT = { id: 1, event_type: 'drag_race' };

describe('Sidebar — team mode', () => {
  test('renders a card for each team', () => {
    render(<Sidebar events={[]} selectedEvent={SELECTED_EVENT} onSelectEvent={noop} teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('Team Beta')).toBeInTheDocument();
  });

  test('shows "No ECU assigned" for team without ECU', () => {
    render(<Sidebar events={[]} selectedEvent={SELECTED_EVENT} onSelectEvent={noop} teams={TEAMS} ecuList={[]} onSelectTeam={noop} />);
    expect(screen.getAllByText('No ECU assigned')).toHaveLength(2);
  });

  test('shows ECU serial number for team with ECU', () => {
    render(<Sidebar events={[]} selectedEvent={SELECTED_EVENT} onSelectEvent={noop} teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeInTheDocument();
  });

  test('shows empty state when no teams exist', () => {
    render(<Sidebar events={[]} selectedEvent={SELECTED_EVENT} onSelectEvent={noop} teams={[]} ecuList={[]} onSelectTeam={noop} />);
    expect(screen.getByText('No teams in this competition')).toBeInTheDocument();
  });

  test('calls onSelectTeam when a team card is clicked', () => {
    const onSelectTeam = vi.fn();
    render(<Sidebar events={[]} selectedEvent={SELECTED_EVENT} onSelectEvent={noop} teams={TEAMS} ecuList={ECUS} onSelectTeam={onSelectTeam} />);
    fireEvent.click(screen.getByText('Team Alpha'));
    expect(onSelectTeam).toHaveBeenCalledWith(TEAMS[0]);
  });

  test('filters teams by name query', () => {
    render(<Sidebar events={[]} selectedEvent={SELECTED_EVENT} onSelectEvent={noop} teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    fireEvent.change(screen.getByPlaceholderText('Find team or ECU…'), {
      target: { value: 'Alpha' },
    });
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Team Beta')).not.toBeInTheDocument();
  });

  test('shows no-results message when search matches nothing', () => {
    render(<Sidebar events={[]} selectedEvent={SELECTED_EVENT} onSelectEvent={noop} teams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    fireEvent.change(screen.getByPlaceholderText('Find team or ECU…'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });
});

describe('Sidebar — no event selected', () => {
  test('renders competition teams when no event is selected', () => {
    render(<Sidebar selectedEvent={null} onSelectEvent={noop} teams={TEAMS} competitionTeams={TEAMS} ecuList={ECUS} onSelectTeam={noop} />);
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('Team Beta')).toBeInTheDocument();
  });

  test('shows empty state when no competition teams exist', () => {
    render(<Sidebar selectedEvent={null} onSelectEvent={noop} teams={[]} competitionTeams={[]} ecuList={[]} onSelectTeam={noop} />);
    expect(screen.getByText('No teams yet')).toBeInTheDocument();
  });

  test('shows add button when onAddTeam is provided', () => {
    const onAddTeam = vi.fn();
    render(<Sidebar selectedEvent={null} onSelectEvent={noop} teams={TEAMS} competitionTeams={TEAMS} ecuList={ECUS} onSelectTeam={noop} onAddTeam={onAddTeam} />);
    expect(screen.getByTitle('Add team')).toBeInTheDocument();
  });
});
