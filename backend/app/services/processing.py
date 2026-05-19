# ADC conversion and averaging for raw ESP32 sensor samples.
#
# The ESP32 has a 12-bit ADC (0-4095) with a 3.3V reference.
# Calibration constants below must be confirmed with the hardware team.

ADC_RESOLUTION = 4095
ADC_REFERENCE_V = 3.3

# TODO: confirm voltage divider ratio with compsys team
VOLTAGE_DIVIDER_RATIO = 18.18  # scales 3.3V ADC range up to ~60V

# TODO: confirm current sensor constants with compsys team
# Assumes a hall-effect sensor (e.g. ACS712) with 2.5V offset at 0A
CURRENT_OFFSET_V = 1.65       # voltage output at 0A
CURRENT_SENSITIVITY = 0.066   # V/A (e.g. ACS712-30A = 0.066 V/A)


def convert_voltage_samples(voltage_samples: list[int]) -> list[float]:
    return [
        (sample / ADC_RESOLUTION) * ADC_REFERENCE_V * VOLTAGE_DIVIDER_RATIO
        for sample in voltage_samples
    ]


def convert_current_samples(current_samples: list[int]) -> list[float]:
    return [
        ((sample / ADC_RESOLUTION) * ADC_REFERENCE_V - CURRENT_OFFSET_V) / CURRENT_SENSITIVITY
        for sample in current_samples
    ]


def convert_voltage_and_average(voltage_samples: list[int]) -> float:
    converted = convert_voltage_samples(voltage_samples)
    return sum(converted) / len(converted)


def convert_current_and_average(current_samples: list[int]) -> float:
    converted = convert_current_samples(current_samples)
    return sum(converted) / len(converted)
