from app.services.processing import compute_power_samples


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
