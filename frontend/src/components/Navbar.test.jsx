import { vi, describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Navbar } from './Navbar';

vi.mock('../assets/evolocity_logo.png', () => ({ default: 'logo.png' }));

describe('Navbar — health display', () => {
  test('shows 100% health when no ECUs are registered', () => {
    render(<Navbar connectedCount={0} totalCount={0} />);
    expect(screen.getByText(/System Health: 100%/)).toBeInTheDocument();
  });

  test('calculates health percentage from connected vs total', () => {
    render(<Navbar connectedCount={3} totalCount={4} />);
    expect(screen.getByText(/System Health: 75%/)).toBeInTheDocument();
  });

  test('shows 0% when none are connected', () => {
    render(<Navbar connectedCount={0} totalCount={5} />);
    expect(screen.getByText(/System Health: 0%/)).toBeInTheDocument();
  });
});

describe('Navbar — competition display', () => {
  test('shows competition name when provided', () => {
    render(<Navbar competition={{ name: 'Round 1', events: [] }} />);
    expect(screen.getByText('Round 1')).toBeInTheDocument();
  });

  test('does not show competition name when not provided', () => {
    render(<Navbar />);
    expect(screen.queryByText('Round 1')).not.toBeInTheDocument();
  });

  test('shows event badge for each competition event', () => {
    const competition = {
      name: 'Round 1',
      events: [
        { id: 1, event_type: 'drag_race' },
        { id: 2, event_type: 'gymkhana' },
      ],
    };
    render(<Navbar competition={competition} />);
    expect(screen.getByText('Drag Race')).toBeInTheDocument();
    expect(screen.getByText('Gymkhana')).toBeInTheDocument();
  });
});

describe('Navbar — back button', () => {
  test('renders back button when onBack is provided', () => {
    render(<Navbar onBack={() => {}} />);
    expect(screen.getByTitle('Back to Competitions')).toBeInTheDocument();
  });

  test('does not render back button when onBack is omitted', () => {
    render(<Navbar />);
    expect(screen.queryByTitle('Back to Competitions')).not.toBeInTheDocument();
  });

  test('calls onBack when back button is clicked', () => {
    const onBack = vi.fn();
    render(<Navbar onBack={onBack} />);
    fireEvent.click(screen.getByTitle('Back to Competitions'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
