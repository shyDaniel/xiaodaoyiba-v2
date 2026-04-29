// @xdyb/client — placeholder shell.
//
// This is the React chrome that future iterations replace with Landing /
// Lobby / Game pages. It is intentionally minimal but visually coherent so
// `pnpm dev` produces a non-blank page during the bring-up phase.

import { ACTION_TOTAL_MS, SHARED_PACKAGE_VERSION } from '@xdyb/shared';

export function App(): JSX.Element {
  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.25rem',
        padding: '2rem',
        textAlign: 'center',
        background:
          'radial-gradient(circle at 50% 35%, #1a1f2c 0%, #0b0d12 70%)',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(2rem, 6vw, 4rem)',
          margin: 0,
          letterSpacing: '0.08em',
          color: '#f7d774',
          textShadow: '0 4px 0 #6a4012, 0 0 24px rgba(247, 215, 116, 0.35)',
        }}
      >
        小刀一把
      </h1>
      <p
        style={{
          fontSize: 'clamp(1rem, 2.4vw, 1.4rem)',
          margin: 0,
          color: '#d8cfb6',
          maxWidth: '36rem',
          lineHeight: 1.5,
        }}
      >
        小刀一把，来到你家，扒你裤衩，直接咔嚓！
      </p>
      <div
        style={{
          fontSize: '0.85rem',
          color: '#7c8597',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        v2 bring-up · shared@{SHARED_PACKAGE_VERSION} · action={ACTION_TOTAL_MS}
        ms
      </div>
    </main>
  );
}
