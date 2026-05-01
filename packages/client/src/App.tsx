// @xdyb/client — top-level app shell.
//
// State-driven router:
//
//   • No room joined            → <LandingPage> (nickname + create / join)
//   • In room, snapshot.phase=='LOBBY' → <LobbyPage> (player list, addBot, 开战)
//   • snapshot.phase in ('PLAYING','ENDED') → <MultiGamePage> (real Socket.IO)
//   • Solo mode (user clicked 单机练习) → <GamePage> (legacy single-player
//     fallback so the page is still demonstrable when the server is offline)
//
// The "router" is plain conditional rendering keyed off the Zustand store +
// a local `solo` flag — adding react-router for three states is overkill.
//
// §E3 bundle-size gate (S-520): GamePage and MultiGamePage transitively
// pull in the entire PixiJS canvas tree (GameStage + Character + House +
// ... + pixi.js itself, ~250 KB gzipped). LandingPage doesn't need any
// of that, so we hoist the canvas-bearing routes behind React.lazy. The
// landing chunk ships pixi-free; the canvas chunks load only when the
// user actually enters a game (solo or multiplayer). The Suspense
// fallback paints a single dark rectangle that matches the stage
// background so the chunk-load transition is invisible to the eye.

import { lazy, Suspense, useState } from 'react';
import { LandingPage } from './pages/Landing.js';
import { LobbyPage } from './pages/Lobby.js';
import { useGameStore } from './store/gameStore.js';

const GamePage = lazy(() =>
  import('./pages/Game.js').then((m) => ({ default: m.GamePage })),
);
const MultiGamePage = lazy(() =>
  import('./pages/MultiGame.js').then((m) => ({ default: m.MultiGamePage })),
);

// Minimal dark fallback so the canvas chunk transition is invisible —
// the chunk is small enough on a warm cache that this almost never
// paints, but if it does the user sees the same dark stage background
// that's about to land, not a flash of white.
function CanvasLoading(): JSX.Element {
  return <div style={{ width: '100vw', height: '100vh', background: '#0b0d12' }} />;
}

export function App(): JSX.Element {
  const [solo, setSolo] = useState(false);
  const code = useGameStore((s) => s.code);
  const snapshot = useGameStore((s) => s.snapshot);

  if (solo) {
    return (
      <Suspense fallback={<CanvasLoading />}>
        <GamePage onExit={() => setSolo(false)} />
      </Suspense>
    );
  }

  if (!code || !snapshot) {
    return <LandingPage onSolo={() => setSolo(true)} />;
  }

  if (snapshot.phase === 'LOBBY') {
    return <LobbyPage />;
  }

  // PLAYING or ENDED — both render on the canvas surface.
  return (
    <Suspense fallback={<CanvasLoading />}>
      <MultiGamePage />
    </Suspense>
  );
}
