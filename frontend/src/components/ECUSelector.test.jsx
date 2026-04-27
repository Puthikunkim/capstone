import { render, screen, fireEvent } from '@testing-library/react';
import { ECUSelector } from './ECUSelector';

const ECU_LIST = [
  { id: 1, serial_number: 1001 },
  { id: 2, serial_number: 2002, name: 'Kart A' },
];

describe('ECUSelector', () => {
  test('renders the label', () => {
    render(<ECUSelector ecuList={[]} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByText('Select ECU:')).toBeInTheDocument();
  });

  test('renders placeholder option', () => {
    render(<ECUSelector ecuList={[]} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByText('-- Choose an ECU --')).toBeInTheDocument();
  });

  test('renders an option for each ECU using id as fallback name', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByText('ECU 1 (Serial Number: 1001)')).toBeInTheDocument();
  });

  test('uses ecu.name when provided', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByText('Kart A (Serial Number: 2002)')).toBeInTheDocument();
  });

  test('dropdown has empty value when selectedEcuId is null', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  test('dropdown reflects selectedEcuId', () => {
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={1} onEcuChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveValue('1');
  });

  test('calls onEcuChange with a parsed integer on selection', () => {
    const onEcuChange = vi.fn();
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={onEcuChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(onEcuChange).toHaveBeenCalledWith(2);
  });

  test('calls onEcuChange exactly once per change event', () => {
    const onEcuChange = vi.fn();
    render(<ECUSelector ecuList={ECU_LIST} selectedEcuId={null} onEcuChange={onEcuChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(onEcuChange).toHaveBeenCalledTimes(1);
  });

  test('renders without crashing when ecuList is empty', () => {
    render(<ECUSelector ecuList={[]} selectedEcuId={null} onEcuChange={() => {}} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
