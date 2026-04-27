import WebSocketClient from './websocket';

let mockWs;

beforeEach(() => {
  const MockWebSocket = vi.fn(() => mockWs);
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSED = 3;
  vi.stubGlobal('WebSocket', MockWebSocket);

  mockWs = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    readyState: WebSocket.OPEN,
    close: vi.fn(),
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WebSocketClient constructor', () => {
  test('stores constructor arguments and initialises defaults', () => {
    const onMessage = vi.fn();
    const client = new WebSocketClient('ws://test', onMessage);
    expect(client.url).toBe('ws://test');
    expect(client.onMessage).toBe(onMessage);
    expect(client.reconnectAttempts).toBe(0);
    expect(client.shouldReconnect).toBe(true);
    expect(client.ws).toBeNull();
  });
});

describe('connect', () => {
  test('creates a WebSocket with the configured URL', () => {
    const client = new WebSocketClient('ws://localhost:8000/ws/1');
    client.connect();
    expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8000/ws/1');
  });

  test('calls onConnect and resets reconnectAttempts when socket opens', () => {
    const onConnect = vi.fn();
    const client = new WebSocketClient('ws://test', null, onConnect);
    client.reconnectAttempts = 3;
    client.connect();
    mockWs.onopen();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(client.reconnectAttempts).toBe(0);
  });

  test('parses JSON and calls onMessage when a message arrives', () => {
    const onMessage = vi.fn();
    const client = new WebSocketClient('ws://test', onMessage);
    client.connect();
    const payload = { ecu_id: 1, avg_voltage: 41.5 };
    mockWs.onmessage({ data: JSON.stringify(payload) });
    expect(onMessage).toHaveBeenCalledWith(payload);
  });

  test('does not throw when onMessage receives invalid JSON', () => {
    const client = new WebSocketClient('ws://test', vi.fn());
    client.connect();
    expect(() => mockWs.onmessage({ data: 'not-json' })).not.toThrow();
  });

  test('calls onDisconnect when the socket closes', () => {
    const onDisconnect = vi.fn();
    const client = new WebSocketClient('ws://test', null, null, onDisconnect);
    client.connect();
    client.shouldReconnect = false;
    mockWs.onclose();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  test('schedules a reconnect when the socket closes and shouldReconnect is true', () => {
    const client = new WebSocketClient('ws://test');
    client.connect();
    mockWs.onclose();
    expect(client.reconnectAttempts).toBe(1);
    expect(client.reconnectTimeoutId).not.toBeNull();
  });

  test('does not reconnect when shouldReconnect is false', () => {
    const client = new WebSocketClient('ws://test');
    client.connect();
    client.shouldReconnect = false;
    mockWs.onclose();
    expect(client.reconnectAttempts).toBe(0);
  });
});

describe('attemptReconnect', () => {
  test('increments reconnectAttempts and calls connect after the delay', () => {
    const client = new WebSocketClient('ws://test');
    const connectSpy = vi.spyOn(client, 'connect');
    client.attemptReconnect();
    expect(client.reconnectAttempts).toBe(1);
    vi.advanceTimersByTime(client.reconnectDelay);
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  test('stops reconnecting after maxReconnectAttempts', () => {
    const client = new WebSocketClient('ws://test');
    const connectSpy = vi.spyOn(client, 'connect');
    client.reconnectAttempts = client.maxReconnectAttempts;
    client.attemptReconnect();
    vi.advanceTimersByTime(client.reconnectDelay);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(client.reconnectAttempts).toBe(client.maxReconnectAttempts);
  });

  test('does nothing when shouldReconnect is false', () => {
    const client = new WebSocketClient('ws://test');
    client.shouldReconnect = false;
    client.attemptReconnect();
    expect(client.reconnectAttempts).toBe(0);
  });
});

describe('close', () => {
  test('sets shouldReconnect to false and closes the socket', () => {
    const client = new WebSocketClient('ws://test');
    client.connect();
    client.close();
    expect(client.shouldReconnect).toBe(false);
    expect(mockWs.close).toHaveBeenCalledTimes(1);
    expect(client.ws).toBeNull();
  });

  test('cancels a pending reconnect timeout', () => {
    const client = new WebSocketClient('ws://test');
    client.connect();
    mockWs.onclose();
    expect(client.reconnectTimeoutId).not.toBeNull();
    client.close();
    expect(client.reconnectTimeoutId).toBeNull();
  });
});

describe('isConnected', () => {
  test('returns true when the socket is open', () => {
    const client = new WebSocketClient('ws://test');
    client.connect();
    mockWs.readyState = WebSocket.OPEN;
    expect(client.isConnected()).toBe(true);
  });

  test('returns false when the socket is closed', () => {
    const client = new WebSocketClient('ws://test');
    client.connect();
    mockWs.readyState = WebSocket.CLOSED;
    expect(client.isConnected()).toBe(false);
  });

  test('returns falsy before connect is called', () => {
    const client = new WebSocketClient('ws://test');
    expect(client.isConnected()).toBeFalsy();
  });
});
