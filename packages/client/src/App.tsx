// @xdyb/client — top-level app shell.
//
// Iteration S-324: replaces the bare `<GamePage />` mount with a real
// state-driven router:
//
//   • No room joined            → <LandingPage> (nickname + create / join)
//   • In room, snapshot.phase=='LOBBY' → <LobbyPage> (player list, addBot, 开战)
//   • snapshot.phase in ('PLAYING','ENDED') → <MultiGamePage> (real Socket.IO)
//   • Solo mode (user clicked 单机练习) → <GamePage> (legacy single-player
//     fallback so the page is still demonstrable when the server is offline)
//
// The "router" is plain conditional rendering keyed off the Zustand store +
// a local `solo` flag — adding react-router for three states is overkill
// and the cold-load path is zero-config.

import { useState } from 'react';
import { GamePage } from './pages/Game.js';
import { LandingPage } from './pages/Landing.js';
import { LobbyPage } from './pages/Lobby.js';
import { MultiGamePage } from './pages/MultiGame.js';
import { useGameStore } from './store/gameStore.js';

export function App(): JSX.Element {
  const [solo, setSolo] = useState(false);
  const code = useGameStore((s) => s.code);
  const snapshot = useGameStore((s) => s.snapshot);

  if (solo) {
    return <GamePage onExit={() => setSolo(false)} />;
  }

  if (!code || !snapshot) {
    return <LandingPage onSolo={() => setSolo(true)} />;
  }

  if (snapshot.phase === 'LOBBY') {
    return <LobbyPage />;
  }

  // PLAYING or ENDED — both render on the canvas surface.
  return <MultiGamePage />;
}
