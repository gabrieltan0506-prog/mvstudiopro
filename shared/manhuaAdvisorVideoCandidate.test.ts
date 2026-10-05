import {expect,it} from "vitest";
import {selectAdvisorVideoCandidate} from "./manhuaAdvisorMediaEdit";
it("重复采用不能把原片当候选，签名变化仍识别同一原片",()=>{
 const original="https://storage.googleapis.com/mv-studio-pro-vertex-video-temp/uploads/u1/old.mp4?sig=old";
 const old={url:"/api/canvas-media/uploads/u1/old.mp4",current:true};
 const fresh={url:"https://test/new.mp4",current:false};
 expect(selectAdvisorVideoCandidate(original,[old,fresh])).toBe(fresh);
 expect(()=>selectAdvisorVideoCandidate(original,[{...old,current:false},{...fresh,current:true}])).toThrow("没有唯一");
 expect(()=>selectAdvisorVideoCandidate(original,[old,fresh,{url:"https://test/another.mp4",current:false}])).toThrow("没有唯一");
});
