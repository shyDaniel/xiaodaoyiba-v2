// @xdyb/client — top-level app shell.
//
// Iteration 6 (S-084): replaces the placeholder gradient + h1 with the
// real Game page (PixiJS canvas + parallax + characters + houses +
// HandPicker + BattleLog). The Lobby/Landing pages and React Router
// arrive when matchmaking lands; for now /game is the headline product
// surface and is shown by default.

import { GamePage } from './pages/Game.js';

export function App(): JSX.Element {
  return <GamePage />;
}
