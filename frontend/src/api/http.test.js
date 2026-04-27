import { vi, describe, test, expect, afterEach } from 'vitest';
import { fetchEcus, fetchEcu, fetchEcuHistory } from './http';

function mockOkResponse(data) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  }));
}

function mockErrorResponse(status, statusText) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchEcus', () => {
  test('calls the /ecu endpoint with correct URL and headers', async () => {
    mockOkResponse([]);
    await fetchEcus();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/ecu',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  test('returns the parsed JSON array on success', async () => {
    const ecus = [{ id: 1, serial_number: 1001 }];
    mockOkResponse(ecus);
    await expect(fetchEcus()).resolves.toEqual(ecus);
  });

  test('throws an error containing the status code on failure', async () => {
    mockErrorResponse(500, 'Internal Server Error');
    await expect(fetchEcus()).rejects.toThrow('500');
  });
});

describe('fetchEcu', () => {
  test('calls the /ecu/{id} endpoint with the correct ID', async () => {
    mockOkResponse({});
    await fetchEcu(42);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/ecu/42',
      expect.anything()
    );
  });

  test('returns the ECU object on success', async () => {
    const ecu = { id: 42, serial_number: 9999 };
    mockOkResponse(ecu);
    await expect(fetchEcu(42)).resolves.toEqual(ecu);
  });

  test('throws on 404', async () => {
    mockErrorResponse(404, 'Not Found');
    await expect(fetchEcu(99)).rejects.toThrow('404');
  });
});

describe('fetchEcuHistory', () => {
  test('calls the /ecu/{id}/history endpoint', async () => {
    mockOkResponse([]);
    await fetchEcuHistory(7);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/ecu/7/history',
      expect.anything()
    );
  });

  test('returns the history array on success', async () => {
    const history = [{ id: 1, avg_voltage: 41.0 }];
    mockOkResponse(history);
    await expect(fetchEcuHistory(7)).resolves.toEqual(history);
  });

  test('throws on error response', async () => {
    mockErrorResponse(503, 'Service Unavailable');
    await expect(fetchEcuHistory(1)).rejects.toThrow('503');
  });
});
