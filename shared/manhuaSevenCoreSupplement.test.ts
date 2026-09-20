import { describe, it, expect } from 'vitest';
import { emptyManhuaSevenCoreValues, extractManhuaShotSevenCore, upsertManhuaShotSevenCore, clearManhuaShotSevenCore, MANHUA_SEVEN_CORE_FIELDS } from './manhuaSevenCoreSupplement';
import { mergeManhuaDerivedClipPrompt } from './manhuaClipUserSupplement';
import { upsertManhuaShotVfx, extractManhuaShotVfx } from './manhuaVfxSupplement';

describe('七核心当前镜头补充', () => {
  it('七字段原文经保存恢复和系统重编译保留，同镜替换不影响别镜或特效', () => {
    const values = { ...emptyManhuaSevenCoreValues(), shotSizeZh: '  中近景  ', motionZh: '视线先转向门口\n随后握拳，呼气放松' };
    expect(MANHUA_SEVEN_CORE_FIELDS).toHaveLength(7);
    const first = upsertManhuaShotSevenCore('系统稿\n【用户补充】\n保留人物衣色', 1, values);
    const second = upsertManhuaShotSevenCore(first, 2, { ...values, angleZh: '平视' });
    const vfx = upsertManhuaShotVfx(second, 1, '门后微光照亮侧脸');
    const restored = mergeManhuaDerivedClipPrompt('新系统稿', JSON.parse(JSON.stringify({ prompt: vfx })).prompt);
    expect(extractManhuaShotSevenCore(restored, 1)).toEqual(values);
    const replaced = upsertManhuaShotSevenCore(restored, 1, { ...values, shotSizeZh: '特写' });
    expect(extractManhuaShotSevenCore(replaced, 1)?.shotSizeZh).toBe('特写');
    expect(extractManhuaShotSevenCore(replaced, 2)?.angleZh).toBe('平视');
    expect(extractManhuaShotVfx(replaced, 1)).toBe('门后微光照亮侧脸');
    expect(replaced).toContain('保留人物衣色');
    expect(replaced).toContain('新系统稿');
    expect(replaced.match(/【镜头七核心：1】/g)).toHaveLength(1);
    const cleared = clearManhuaShotSevenCore(replaced, 1);
    expect(extractManhuaShotSevenCore(cleared, 1)).toBeNull();
    expect(extractManhuaShotSevenCore(cleared, 2)?.angleZh).toBe('平视');
    expect(extractManhuaShotVfx(cleared, 1)).toBe('门后微光照亮侧脸');
    expect(cleared).toContain('保留人物衣色');
    expect(clearManhuaShotSevenCore(cleared, 1)).toBe(cleared);
  });
  it('拒绝注入、空要求、超长字段、非法镜号及不完整跨镜区块', () => {
    const values = { ...emptyManhuaSevenCoreValues(), angleZh: '俯视' };
    for (const attack of ['【用户补充】', '【镜头特效：2】', '【特效结束】', '【镜头七核心：2】', '【七核心结束：1】', '【景别】']) {
      expect(() => upsertManhuaShotSevenCore('原稿', 1, { ...values, motionZh: attack })).toThrow('区块标记');
    }
    expect(() => upsertManhuaShotSevenCore('原稿', 0, values)).toThrow('有效镜头');
    expect(() => upsertManhuaShotSevenCore('原稿', 1, emptyManhuaSevenCoreValues())).toThrow('至少');
    expect(() => upsertManhuaShotSevenCore('原稿', 1, { ...values, angleZh: '长'.repeat(501) })).toThrow('500');
    const malformed = '【用户补充】\n【镜头七核心：1】旧内容\n【镜头七核心：2】他镜\n【七核心结束：1】';
    expect(() => upsertManhuaShotSevenCore(malformed, 1, values)).toThrow('不完整');
    expect(() => clearManhuaShotSevenCore(malformed, 1)).toThrow('不完整');
    expect(() => extractManhuaShotSevenCore(malformed, 1)).toThrow('不完整');
  });
});
