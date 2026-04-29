// Game-logic barrel. Re-exports every concrete module under shared/game/*
// so consumers can write `import { ACTION_TOTAL_MS } from '@xdyb/shared'`
// without reaching into deep paths.
export * from './timing.js';
