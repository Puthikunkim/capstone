# Unit tests for ADC conversion utilities (services/processing.py).

from app.services.processing import (
    ADC_REFERENCE_V,
    ADC_RESOLUTION,
    CURRENT_OFFSET_V,
    CURRENT_SENSITIVITY,
    VOLTAGE_DIVIDER_RATIO,
    convert_current_and_average,
    convert_voltage_and_average,
)


class TestConvertVoltageAndAverage:
    def test_zero_sample_gives_zero_voltage(self):
        assert convert_voltage_and_average([0]) == 0.0

    def test_full_scale_gives_max_voltage(self):
        expected = ADC_REFERENCE_V * VOLTAGE_DIVIDER_RATIO
        assert abs(convert_voltage_and_average([ADC_RESOLUTION]) - expected) < 1e-6

    def test_averages_multiple_samples(self):
        expected = (ADC_REFERENCE_V * VOLTAGE_DIVIDER_RATIO) / 2
        assert abs(convert_voltage_and_average([0, ADC_RESOLUTION]) - expected) < 1e-6

    def test_identical_samples_return_same_value(self):
        single = convert_voltage_and_average([2048])
        multi = convert_voltage_and_average([2048, 2048, 2048])
        assert abs(single - multi) < 1e-9

    def test_nonzero_sample_gives_positive_result(self):
        assert convert_voltage_and_average([1000]) > 0


class TestConvertCurrentAndAverage:
    def test_zero_adc_gives_large_negative_current(self):
        expected = (0.0 - CURRENT_OFFSET_V) / CURRENT_SENSITIVITY
        assert abs(convert_current_and_average([0]) - expected) < 1e-6

    def test_full_scale_gives_positive_current(self):
        expected = (ADC_REFERENCE_V - CURRENT_OFFSET_V) / CURRENT_SENSITIVITY
        assert abs(convert_current_and_average([ADC_RESOLUTION]) - expected) < 1e-6

    def test_midpoint_gives_near_zero_current(self):
        midpoint = round(CURRENT_OFFSET_V / ADC_REFERENCE_V * ADC_RESOLUTION)
        assert abs(convert_current_and_average([midpoint])) < 0.1

    def test_averages_multiple_samples(self):
        a = convert_current_and_average([1000])
        b = convert_current_and_average([2000])
        avg = convert_current_and_average([1000, 2000])
        assert abs(avg - (a + b) / 2) < 1e-9

    def test_identical_samples_return_same_value(self):
        single = convert_current_and_average([3000])
        multi = convert_current_and_average([3000, 3000])
        assert abs(single - multi) < 1e-9
