import {expect,it} from 'vitest';
import {validateAdvisorRewriteBody} from './manhuaAdvisorRewrite';
it('原话实测回归：明晚赴约不能因带第二人在明早浮尸；不静默改正文',()=>{
 const original='场次 E1-S1：沈昀夜返文书库，裴昭从案后现身，要求独自前来。';
 const wrong='场次 E1-S1：沈昀夜返文书库，裴昭从案后现身。裴昭：明晚酉时，城东曲巷。就你一个人来——敢带第二个人，明早浮尸曲江。';
 expect(()=>validateAdvisorRewriteBody(original,wrong)).toThrow('时序矛盾');
 expect(()=>validateAdvisorRewriteBody(original,wrong.replace('明早浮尸','后天一早浮尸'))).not.toThrow();
 expect(()=>validateAdvisorRewriteBody(original,wrong.replace('明晚酉时','今晚酉时'))).not.toThrow();
});

it('片尾钩子独立保留旧错误也不得采用',()=>{
 const original='场次 E1-S1：沈昀夜返文书库，裴昭从案后现身，要求独自前来。';
 const body='场次 E1-S1：沈昀夜返文书库，裴昭从案后现身，持刀拦住他。她要求明晚独自赴约，沈昀沉默地把副本收进怀里。';
 expect(()=>validateAdvisorRewriteBody(original,body,'明晚酉时，城东曲巷。敢带第二个人，明早浮尸曲江。')).toThrow('时序矛盾');
});
