// ECUSelector component is for dropdown to switch between connected ESP32 boards.

export function ECUSelector({ ecuList, selectedEcuId, onEcuChange }) {
  return (
    <div className="ecu-selector">
      <label htmlFor="ecu-select">Select ECU:</label>
      <select
        id="ecu-select"
        value={selectedEcuId || ""}
        onChange={(e) => onEcuChange(parseInt(e.target.value))}
      >
        <option value="">-- Choose an ECU --</option>
        {ecuList.map((ecu) => (
          <option key={ecu.id} value={ecu.id}>
            {ecu.name || `ECU ${ecu.id}`} (Serial: {ecu.serial})
          </option>
        ))}
      </select>
    </div>
  );
}
