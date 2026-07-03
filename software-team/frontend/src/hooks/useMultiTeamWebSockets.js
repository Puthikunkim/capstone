import { useEffect, useRef, useState } from "react";
import WebSocketClient from "../api/websocket";

// Manages one WebSocket per team without calling hooks in a loop.
// teamIds: number[] — list of team IDs to connect to.
// Returns { frameByTeam, connectedTeams } where frameByTeam is the latest
// raw frame received per teamId and connectedTeams is a Set of connected teamIds.
export function useMultiTeamWebSockets(teamIds) {
  const wsMapRef = useRef({});
  const [frameByTeam, setFrameByTeam] = useState({});
  const [connectedTeams, setConnectedTeams] = useState(new Set());

  // Stable string key so the effect only re-runs when the set of IDs changes.
  const teamIdsKey = JSON.stringify([...teamIds].sort((a, b) => a - b));

  useEffect(() => {
    const desiredIds = new Set(teamIds);

    // Close connections for teams no longer needed.
    for (const id of Object.keys(wsMapRef.current)) {
      const numId = Number(id);
      if (!desiredIds.has(numId)) {
        wsMapRef.current[id].close();
        delete wsMapRef.current[id];
        setConnectedTeams((prev) => {
          const next = new Set(prev);
          next.delete(numId);
          return next;
        });
      }
    }

    // Open connections for new teams.
    for (const teamId of teamIds) {
      if (!wsMapRef.current[teamId]) {
        const client = new WebSocketClient(
          `ws://localhost:8000/ws/team/${teamId}`,
          (data) =>
            setFrameByTeam((prev) => ({ ...prev, [teamId]: data })),
          () =>
            setConnectedTeams((prev) => new Set([...prev, teamId])),
          () =>
            setConnectedTeams((prev) => {
              const next = new Set(prev);
              next.delete(teamId);
              return next;
            }),
        );
        client.connect();
        wsMapRef.current[teamId] = client;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamIdsKey]);

  // Close all connections on unmount.
  useEffect(() => {
    return () => {
      for (const client of Object.values(wsMapRef.current)) {
        client.close();
      }
      wsMapRef.current = {};
    };
  }, []);

  return { frameByTeam, connectedTeams };
}
