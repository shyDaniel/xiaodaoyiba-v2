// FINAL_GOAL §H7 — structured action row format (S-421).
//
// Locks in the contract that BattleLog action rows match the regex
// /R\d+\.action.+(扒裤衩|咔嚓|穿好裤衩).+✓/ and that PULL_OWN_PANTS_UP
// renders as `X → 自己 穿好裤衩 ✓`.
//
// Both the solo Game.tsx and the multi-room MultiGame.tsx funnel their
// onNarration-side row formatting through `formatActionRow`, so a
// passing test here guarantees both surfaces emit identical row text
// for the same engine input. That is the §H7 acceptance gate the
// judge runs against the live app.

import { describe, expect, it } from 'vitest';
import { formatActionRow, formatActionVerb } from './BattleLog.js';

describe('formatActionVerb', () => {
  it('扒 → 扒裤衩 (yellow PULL_PANTS keyword)', () => {
    expect(formatActionVerb('扒')).toBe('扒裤衩');
  });
  it('砍 → 咔嚓 (red CHOP keyword)', () => {
    expect(formatActionVerb('砍')).toBe('咔嚓');
  });
  it('穿 → 穿好裤衩 (cyan PULL_OWN_PANTS_UP keyword)', () => {
    expect(formatActionVerb('穿')).toBe('穿好裤衩');
  });
});

describe('formatActionRow', () => {
  it('R1 PULL_PANTS row matches /R1\\.action.+扒裤衩.+✓/', () => {
    const row = formatActionRow({
      round: 1,
      verb: '扒',
      actorNickname: '小明',
      targetNickname: '你',
      actorId: 'bot-1',
      targetId: 'me',
      colloquial: '小明一个箭步上前，扒下了你的裤衩',
    });
    expect(row).toMatch(/R1\.action.+扒裤衩.+✓/);
    expect(row).toContain('小明');
    expect(row).toContain('你');
    expect(row).toContain('小明一个箭步上前，扒下了你的裤衩');
  });

  it('R2 PULL_OWN_PANTS_UP row uses → 自己 + 穿好裤衩 keyword', () => {
    const row = formatActionRow({
      round: 2,
      verb: '穿',
      actorNickname: '你',
      targetNickname: '你', // engine sets target = actor for self-restore
      actorId: 'me',
      targetId: 'me',
      colloquial: '你蹲下身, 把裤衩捡回来穿好了',
    });
    expect(row).toMatch(/R2\.action.+穿好裤衩.+✓/);
    expect(row).toContain('→ 自己');
    expect(row).not.toContain('→ 你 穿好裤衩'); // would imply targeting another
  });

  it('CHOP row uses 咔嚓 keyword', () => {
    const row = formatActionRow({
      round: 5,
      verb: '砍',
      actorNickname: '小红',
      targetNickname: '小刚',
      actorId: 'bot-a',
      targetId: 'bot-b',
      colloquial: '小红手起刀落，一刀砍向小刚的家门',
    });
    expect(row).toMatch(/R5\.action.+咔嚓.+✓/);
    expect(row).toContain('→ 小刚');
  });

  it('row body is single-line so /.+/ regex traverses headline + colloquial', () => {
    // The acceptance test runs `aside.innerText.match(/R2\.action.+穿好裤衩.+✓/)`.
    // JS `.` does not match `\n`, so the whole row must collapse onto
    // one line. The separator between headline and colloquial is ` · `,
    // not `\n`. This test guards that contract.
    const row = formatActionRow({
      round: 2,
      verb: '穿',
      actorNickname: '你',
      targetNickname: '你',
      actorId: 'me',
      targetId: 'me',
      colloquial: '你抖了抖裤腰，干净利落地穿了回去',
    });
    expect(row).not.toContain('\n');
    expect(row.split('·').length).toBeGreaterThanOrEqual(2);
  });
});
