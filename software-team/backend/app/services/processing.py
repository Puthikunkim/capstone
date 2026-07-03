def compute_power_samples(voltage_samples: list[float], current_samples: list[float]) -> list[float]:
    return [v * i for v, i in zip(voltage_samples, current_samples)]
