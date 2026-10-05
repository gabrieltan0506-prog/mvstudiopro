import {it,expect} from "vitest";
import {buildFilmReviewNativeRequest} from "./manhuaFilmReviewNativeContract";
import {buildGeminiNativeDeepReadSegmentPrompt,buildGeminiNativeDeepReadSegmentRequest} from "./manhuaNativeDeepReadRunner";
it("只增加审片任务和字段，学习请求所有既定参数及原schema保持一致",()=>{
 const context={startSec:0,endSec:106.176,segmentIndex:0,hasAudio:true};
 const prompt=buildGeminiNativeDeepReadSegmentPrompt({...context,episodeDurationSec:106.176,segmentCount:1,videoFps:12,hintZh:"审片"});
 const base=buildGeminiNativeDeepReadSegmentRequest({fileUri:"gs://test/original.mp4",fps:12,prompt,segmentContext:context}) as any;
 const review=buildFilmReviewNativeRequest({uri:"gs://test/original.mp4",durationSec:106.176,hasAudio:true,question:"审片"}) as any;
 const {responseSchema:bs,...bc}=base.generationConfig,{responseSchema:rs,...rc}=review.generationConfig;
 expect(rc).toEqual(bc);expect(rc).toMatchObject({maxOutputTokens:65536,audioTimestamp:true,thinkingConfig:{thinkingLevel:"MEDIUM"}});
 expect(review.contents[0].parts[0]).toEqual(base.contents[0].parts[0]);
 expect(review.contents[0].parts[1].text.startsWith(prompt)).toBe(true);
 const {filmReview,...originalProperties}=rs.properties;expect(originalProperties).toEqual(bs.properties);
 expect(rs.required.filter((x:string)=>x!=="filmReview")).toEqual(bs.required);
 expect(rs.propertyOrdering?.filter((x:string)=>x!=="filmReview")).toEqual(bs.propertyOrdering);
 expect(filmReview.properties.findings.items.properties.kind.enum).toEqual(["亮点","不足"]);
 expect(bs.properties.filmReview).toBeUndefined();
});
