// Socket.IO client wrapper.
//
// Hides the socket.io-client API behind a small, typed surface that mirrors
// the server's event vocabulary (room:create / room:join / room:choice / …).
// All inbound events fan into the Zustand gameStore so React components can
// subscribe to room state without touching the raw socket.
//
// Connection is lazy: connect(url) is called once from main.tsx (or on
// demand by the Landing page) and the resulting Socket is cached. The
// store sees `connected`, `roomCode`, `snapshot`, `lastRound`, and
// `error` change as messages arrive.

import { io, type Socket } from 'socket.io-client';
import type { Effect, RpsChoice } from '@xdyb/shared';
import type { RoomSnapshot, RoundBroadcast } from './store/gameStore.js';
import { useGameStore } from './store/gameStore.js';

let socket: Socket | null = null;

interface ServerErrorPayload {
  code: string;
  message: string;
}

/** Default URL: same-origin in production (proxied by hosting), localhost:3000 in dev. */
function defaultUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  // In Vite dev (5173) the server is at 3000; in built client served from
  // the same host as the server, fall back to same-origin.
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:3000`;
  }
  return `${protocol}//${window.location.host}`;
}

/** Open the singleton Socket. Idempotent. */
export function connect(url: string = defaultUrl()): Socket {
  if (socket) return socket;
  const s = io(url, {
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
  });
  socket = s;

  const store = useGameStore.getState;

  s.on('connect', () => {
    store().setConnected(true);
    store().setError(null);
  });
  s.on('disconnect', () => {
    store().setConnected(false);
  });
  s.on('connect_error', (err) => {
    store().setError(`connect_error: ${err.message}`);
  });

  s.on('room:created', (payload: { code: string; snapshot: RoomSnapshot }) => {
    store().setRoom(payload.code, payload.snapshot);
    store().setError(null);
  });
  s.on('room:joined', (payload: { code: string; snapshot: RoomSnapshot }) => {
    store().setRoom(payload.code, payload.snapshot);
    store().setError(null);
  });
  s.on('room:snapshot', (snapshot: RoomSnapshot) => {
    store().applySnapshot(snapshot);
  });
  s.on(
    'room:effects',
    (payload: {
      round: number;
      effects: ReadonlyArray<Effect>;
      narration: string;
      isGameOver: boolean;
      winnerId: string | null;
    }) => {
      store().pushRound({
        round: payload.round,
        effects: payload.effects,
        narration: payload.narration,
        isGameOver: payload.isGameOver,
        winnerId: payload.winnerId,
      } satisfies RoundBroadcast);
    },
  );
  s.on('room:error', (err: ServerErrorPayload) => {
    store().setError(`${err.code}: ${err.message}`);
  });

  return s;
}

function require_(): Socket {
  if (!socket) {
    return connect();
  }
  return socket;
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}

export function selfSocketId(): string | null {
  return socket?.id ?? null;
}

export function createRoom(nickname: string): void {
  require_().emit('room:create', { nickname });
}

export function joinRoom(code: string, nickname: string): void {
  require_().emit('room:join', { code: code.toUpperCase(), nickname });
}

export function leaveRoom(): void {
  require_().emit('room:leave');
  // Local-clear so UI returns to landing immediately; the server will
  // confirm with snapshot eventually but we don't wait.
  useGameStore.getState().clearRoom();
}

export function addBot(): void {
  require_().emit('room:addBot');
}

export function startGame(): void {
  require_().emit('room:start');
}

export function submitChoice(choice: RpsChoice): void {
  require_().emit('room:choice', { choice });
}

export function rematch(): void {
  require_().emit('room:rematch');
}

/** Force-disconnect (used in tests / on hard reset). */
export function disconnect(): void {
  socket?.disconnect();
  socket = null;
}
