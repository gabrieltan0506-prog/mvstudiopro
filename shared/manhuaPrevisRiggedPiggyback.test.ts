import { describe, expect, it } from 'vitest';
import { previsPiggybackIssues } from './manhuaPrevisPiggyback';

function fixture() {
  return {
    durationSec: 2,
    piggyback: { carrierId: 'carrier', passengerId: 'passenger' },
    actors: ['carrier', 'passenger'].map(id => ({ id, shape: 'human',
      riggedModel: { sourceJobId: `test-${id}` }, start: [1.2, -.7], end: [1.8, -.3],
      facingDeg: 25, moveStartSec: 0, moveEndSec: 2, actions: [] })),
  };
}

describe('真实背负入口组合', () => {
  it('双方真实模型可进入逐帧实际网格验证', () => {
    expect(previsPiggybackIssues(fixture())).toEqual([]);
  });
  it('拒绝真实模型与源人偶混用', () => {
    const spec = fixture();
    Reflect.deleteProperty(spec.actors[1], 'riggedModel');
    expect(previsPiggybackIssues(spec)).toContain('真实背负须双方均绑定本人模型，不能混用源人偶');
  });
  it.each(['slipCatch', 'setDown'])('未实现的 %s 不因开放基础背负而放行', field => {
    const spec = fixture();
    Object.assign(spec.piggyback, field === 'slipCatch'
      ? { slipCatch: { slipStartSec: 0, catchSec: .5, recoverEndSec: 1, dropMeters: .1 } }
      : { setDown: { startSec: 0, groundSec: .75, releaseSec: 1, endSec: 1.5 } });
    expect(previsPiggybackIssues(spec)).toContain('真实人物背负暂不支持放下或滑落接住组合');
  });
});
