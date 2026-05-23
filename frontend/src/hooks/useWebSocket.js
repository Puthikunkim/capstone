import { useEffect, useRef, useState } from "react";
import WebSocketClient from "../api/websocket";

// useViolationsWebSocket connects to /ws/violations and calls onEvent for each message.
// Uses a ref for the callback so it never reconnects on state changes.
// Implements hook-level infinite reconnect (3 s delay) so violation events are never
// silently lost after a backend restart or network blip. The WebSocketClient's built-in
// 5-attempt cap is disabled; this hook takes full ownership of the reconnect lifecycle.
export function useViolationsWebSocket(onEvent) {
	const onEventRef = useRef(onEvent);
	const wsRef = useRef(null);
	const mountedRef = useRef(true);
	const reconnectTimerRef = useRef(null);

	useEffect(() => {
		onEventRef.current = onEvent;
	});

	useEffect(() => {
		mountedRef.current = true;

		function connect() {
			if (!mountedRef.current) return;
			const client = new WebSocketClient(
				"ws://localhost:8000/ws/violations",
				(data) => onEventRef.current?.(data),
				null,
				() => {
					// Schedule reconnect on every disconnect so events are never lost
					if (mountedRef.current) {
						reconnectTimerRef.current = setTimeout(connect, 3000);
					}
				},
			);
			client.shouldReconnect = false; // hook manages reconnect, not WebSocketClient
			client.connect();
			wsRef.current = client;
		}

		connect();

		return () => {
			mountedRef.current = false;
			clearTimeout(reconnectTimerRef.current);
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, []);
}

// useWebSocket manages connection lifecycle for an ECU websocket channel.
export function useWebSocket(selectedEcuId) {
	const wsRef = useRef(null);
	const [isConnected, setIsConnected] = useState(false);
	const [liveData, setLiveData] = useState(null);

	useEffect(() => {
		// Close previous connection before creating a new one.
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		if (selectedEcuId) {
			const wsUrl = `ws://localhost:8000/ws/${selectedEcuId}`;
			const client = new WebSocketClient(
				wsUrl,
				(data) => { setLiveData(data); },
				() => { setIsConnected(true); },
				() => { setIsConnected(false); }
			);
			client.connect();
			wsRef.current = client;
		}

		return () => {
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
			setIsConnected(false);
			setLiveData(null);
		};
	}, [selectedEcuId]);

	return { isConnected, liveData };
}

// useTeamWebSocket manages a WebSocket connection to the team-level channel,
// which receives frames from all ECUs belonging to the team.
export function useTeamWebSocket(teamId) {
	const wsRef = useRef(null);
	const [isConnected, setIsConnected] = useState(false);
	const [liveData, setLiveData] = useState(null);

	useEffect(() => {
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		if (teamId) {
			const wsUrl = `ws://localhost:8000/ws/team/${teamId}`;
			const client = new WebSocketClient(
				wsUrl,
				(data) => setLiveData(data),
				() => setIsConnected(true),
				() => setIsConnected(false),
			);
			client.connect();
			wsRef.current = client;
		}

		return () => {
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
			setIsConnected(false);
			setLiveData(null);
		};
	}, [teamId]);

	return { isConnected, liveData };
}
