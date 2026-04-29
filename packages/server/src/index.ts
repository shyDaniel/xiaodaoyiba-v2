// @xdyb/server — Socket.IO entry point.
//
// This stub establishes the package boundary; concrete room / matchmaking /
// effect-choreography logic lands in subsequent iterations. The intent is
// that `pnpm dev` ultimately runs `tsx watch src/index.ts` and serves the
// game on :3000 alongside the Vite client on :5173.

import { SHARED_PACKAGE_VERSION } from '@xdyb/shared';

const PORT = Number(process.env.PORT ?? 3000);

function main(): void {
  // eslint-disable-next-line no-console
  console.log(
    `[xdyb-server] bootstrap stub — shared@${SHARED_PACKAGE_VERSION}, target port ${PORT}`,
  );
}

main();
