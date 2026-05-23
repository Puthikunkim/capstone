import { useEffect, useRef, useState } from "react";
import WebSocketClient from "../api/websocket";

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
				(data) => {
					setLiveData(data);
				},
				() => {
					setIsConnected(true);
				},
				() => {
					setIsConnected(false);
				}
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
