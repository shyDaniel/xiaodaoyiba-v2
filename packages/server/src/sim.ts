// @xdyb/server — headless sim CLI entry stub.
//
// Final shape (per FINAL_GOAL §A1):
//   pnpm sim --players 4 --bots counter,random,iron,mirror --rounds 50 --seed 42
//
// Subsequent iterations wire this to the shared engine. For now the script
// exists so `pnpm sim --help` resolves and the package boundary is real.

import { SHARED_PACKAGE_VERSION } from '@xdyb/shared';

function main(): void {
  // eslint-disable-next-line no-console
  console.log(
    `[xdyb-sim] bootstrap stub — shared@${SHARED_PACKAGE_VERSION}; engine wiring pending`,
  );
}

main();
