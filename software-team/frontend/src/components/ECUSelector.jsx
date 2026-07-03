// ECUSelector component is for dropdown to switch between connected ESP32 boards.

import PropTypes from 'prop-types';

export function ECUSelector({ ecuList, selectedEcuId, onEcuChange }) {
  return (
    <div className="ecu-selector" data-testid="ecu-selector">
      <label htmlFor="ecu-select" data-testid="ecu-selector-label">Select ECU:</label>
      <select
        id="ecu-select"
        data-testid="ecu-selector-dropdown"
        value={selectedEcuId || ""}
        onChange={(e) => onEcuChange(parseInt(e.target.value))}
      >
        <option value="" data-testid="ecu-selector-placeholder">-- Choose an ECU --</option>
        {ecuList.map((ecu) => (
          <option key={ecu.id} value={ecu.id} data-testid={`ecu-option-${ecu.id}`}>
            {ecu.name || `ECU ${ecu.id}`} (Serial Number: {ecu.serial_number})
          </option>
        ))}
      </select>
    </div>
  );
}

ECUSelector.propTypes = {
  ecuList: PropTypes.array.isRequired,
  selectedEcuId: PropTypes.number,
  onEcuChange: PropTypes.func.isRequired,
};