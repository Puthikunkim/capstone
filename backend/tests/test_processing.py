# Unit tests for ADC conversion utilities (services/processing.py).

from app.services.processing import (
    ADC_REFERENCE_V,
    ADC_RESOLUTION,
    CURRENT_OFFSET_V,
    CURRENT_SENSITIVITY,
    VOLTAGE_DIVIDER_RATIO,
    compute_power_samples,
    convert_current_samples,
    convert_voltage_samples,
)


class TestConvertVoltageSamples:
    def test_zero_sample_gives_zero_voltage(self):
        assert convert_voltage_samples([0]) == [0.0]

    def test_full_scale_gives_max_voltage(self):
        expected = ADC_REFERENCE_V * VOLTAGE_DIVIDER_RATIO
        assert abs(convert_voltage_samples([ADC_RESOLUTION])[0] - expected) < 1e-6

    def test_returns_one_value_per_sample(self):
        result = convert_voltage_samples([0, ADC_RESOLUTION, 2048])
        assert len(result) == 3

    def test_nonzero_sample_gives_positive_result(self):
        assert convert_voltage_samples([1000])[0] > 0

    def test_identical_samples_give_identical_values(self):
        result = convert_voltage_samples([2048, 2048, 2048])
        assert result[0] == result[1] == result[2]


class TestConvertCurrentSamples:
    def test_zero_adc_gives_large_negative_current(self):
        expected = (0.0 - CURRENT_OFFSET_V) / CURRENT_SENSITIVITY
        assert abs(convert_current_samples([0])[0] - expected) < 1e-6

    def test_full_scale_gives_positive_current(self):
        expected = (ADC_REFERENCE_V - CURRENT_OFFSET_V) / CURRENT_SENSITIVITY
        assert abs(convert_current_samples([ADC_RESOLUTION])[0] - expected) < 1e-6

    def test_midpoint_gives_near_zero_current(self):
        midpoint = round(CURRENT_OFFSET_V / ADC_REFERENCE_V * ADC_RESOLUTION)
        assert abs(convert_current_samples([midpoint])[0]) < 0.1

    def test_returns_one_value_per_sample(self):
        result = convert_current_samples([1000, 2000, 3000])
        assert len(result) == 3

    def test_identical_samples_give_identical_values(self):
        result = convert_current_samples([3000, 3000])
        assert result[0] == result[1]


class TestComputePowerSamples:
    def test_zero_voltage_gives_zero_power(self):
        assert compute_power_samples([0.0], [5.0]) == [0.0]

    def test_zero_current_gives_zero_power(self):
        assert compute_power_samples([12.0], [0.0]) == [0.0]

    def test_positive_v_and_i_gives_positive_power(self):
        result = compute_power_samples([12.0], [2.5])
        assert abs(result[0] - 30.0) < 1e-9

    def test_returns_one_value_per_sample_pair(self):
        result = compute_power_samples([10.0, 20.0, 30.0], [1.0, 2.0, 3.0])
        assert len(result) == 3

    def test_pointwise_multiplication(self):
        v = [10.0, 20.0]
        i = [2.0, 3.0]
        result = compute_power_samples(v, i)
        assert abs(result[0] - 20.0) < 1e-9
        assert abs(result[1] - 60.0) < 1e-9
