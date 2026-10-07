import { expect, it } from "vitest";
import { creativeVoiceProductionSchema as schema } from "./creativeVoiceProduction";
import { makeManhuaVfxEffect } from "../client/src/lib/manhuaVfxWorkflow";

it("新增特效动作禁止未读取指纹、混合字段、外部素材和隐含重复提交", () => {
  const action={action:"effects",tool:"vfx",operation:"configure",sourceKey:"current",sourceIds:["clip-1"],vfxRecipe:{version:1,seed:2,effects:[makeManhuaVfxEffect("sword_trail", "fx-1")]}};
  expect(schema.safeParse(action).success).toBe(true);
  expect(schema.safeParse({...action,sourceKey:undefined}).success).toBe(false);
  expect(schema.safeParse({...action,operation:"submit"}).success).toBe(false);
  expect(schema.safeParse({...action,requestId:"11111111-1111-4111-8111-111111111111"}).success).toBe(false);
  expect(schema.safeParse({...action,vfxRecipe:{...action.vfxRecipe,effects:[{...action.vfxRecipe.effects[0],kind:"image_overlay",imageUri:"gs://foreign/private.png"}]}}).success).toBe(false);
  expect(schema.safeParse({action:"effects",tool:"generative",operation:"configure",clipId:"clip-1",sourceKey:"now",generativeSettings:{presetId:"custom",target:"人物",instruction:"改变衣服",startSec:2}}).success).toBe(false);
  expect(schema.safeParse({action:"effects",tool:"scene",operation:"configure",clipId:"clip-1",sourceKey:"now",sceneEffects:[]}).success).toBe(true);
  expect(schema.safeParse({action:"knowledge",operation:"refresh"}).success).toBe(true);
});
