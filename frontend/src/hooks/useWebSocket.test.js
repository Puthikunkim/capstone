import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';

vi.mock('../api/websocket', () => ({ default: vi.fn() }));
import WebSocketClient from '../api/websocket';

let mockConnect, mockClose, capturedCallbacks;

beforeEach(() => {
  mockConnect = vi.fn();
  mockClose = vi.fn();
  capturedCallbacks = {};

  WebSocketClient.mockImplementation((url, onMessage, onConnect, onDisconnect) => {
    capturedCallbacks = { url, onMessage, onConnect, onDisconnect };
    return { connect: mockConnect, close: mockClose };
  });
});

describe('useWebSocket', () => {
  test('returns isConnected=false and liveData=null when ecuId is null', () => {
    const { result } = renderHook(() => useWebSocket(null));
    expect(result.current.isConnected).toBe(false);
    expect(result.current.liveData).toBeNull();
  });

  test('does not create a WebSocket when ecuId is null', () => {
    renderHook(() => useWebSocket(null));
    expect(WebSocketClient).not.toHaveBeenCalled();
  });

  test('creates a WebSocket for the correct ECU URL', () => {
    renderHook(() => useWebSocket(5));
    expect(WebSocketClient).toHaveBeenCalledWith(
      'ws://localhost:8000/ws/5',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  test('uses the ecuId in the WebSocket URL', () => {
    renderHook(() => useWebSocket(99));
    expect(capturedCallbacks.url).toBe('ws://localhost:8000/ws/99');
  });

  test('sets isConnected to true when onConnect fires', () => {
    const { result } = renderHook(() => useWebSocket(1));
    act(() => capturedCallbacks.onConnect());
    expect(result.current.isConnected).toBe(true);
  });

  test('sets isConnected to false when onDisconnect fires', () => {
    const { result } = renderHook(() => useWebSocket(1));
    act(() => capturedCallbacks.onConnect());
    act(() => capturedCallbacks.onDisconnect());
    expect(result.current.isConnected).toBe(false);
  });

  test('updates liveData when a message arrives', () => {
    const { result } = renderHook(() => useWebSocket(1));
    const frame = { ecu_id: 1, avg_voltage: 41.5 };
    act(() => capturedCallbacks.onMessage(frame));
    expect(result.current.liveData).toEqual(frame);
  });

  test('closes the previous connection when ecuId changes', () => {
    const { rerender } = renderHook(({ id }) => useWebSocket(id), {
      initialProps: { id: 1 },
    });
    rerender({ id: 2 });
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(WebSocketClient).toHaveBeenCalledTimes(2);
  });

  test('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket(1));
    unmount();
    expect(mockClose).toHaveBeenCalled();
  });
});
