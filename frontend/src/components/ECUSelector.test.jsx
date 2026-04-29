import { vi, describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ECUSelector } from './ECUSelector';

const ECU_LIST = [
  { id: 1, serial_number: 1001 },
  { id: 2, serial_number: 2002, name: 'Kart A' },
];

describe('ECUSelector', () => {
  test('renders the label', () => {
    render(<ECUSelector ecuList={[]} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-selector-label')).toBeInTheDocument();
  });

  test('renders the placeholder option', () => {
    render(<ECUSelector ecuList={[]} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-selector-placeholder')).toBeInTheDocument();
  });

  test('renders an option for each ECU', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-option-1')).toBeInTheDocument();
    expect(screen.getByTestId('ecu-option-2')).toBeInTheDocument();
  });

  test('uses ecu.name when provided', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-option-2').textContent).toContain('Kart A');
  });

  test('uses ecu.id as fallback name when name is absent', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-option-1').textContent).toContain('ECU 1');
  });

  test('dropdown has empty value when selectedEcuId is null', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-selector-dropdown')).toHaveValue('');
  });

  test('dropdown reflects selectedEcuId', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={1} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-selector-dropdown')).toHaveValue('1');
  });

  test('calls onEcuChange with a parsed integer on selection', () => {
    const onEcuChange = vi.fn();
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={onEcuChange} />);
    fireEvent.change(screen.getByTestId('ecu-selector-dropdown'), { target: { value: '2' } });
    expect(onEcuChange).toHaveBeenCalledWith(2);
  });

  test('calls onEcuChange exactly once per change event', () => {
    const onEcuChange = vi.fn();
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={onEcuChange} />);
    fireEvent.change(screen.getByTestId('ecu-selector-dropdown'), { target: { value: '1' } });
    expect(onEcuChange).toHaveBeenCalledTimes(1);
  });

  test('renders without crashing when ecuList is empty', () => {
    render(<ECUSelector ecuList={[]} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByTestId('ecu-selector')).toBeInTheDocument();
  });
});
