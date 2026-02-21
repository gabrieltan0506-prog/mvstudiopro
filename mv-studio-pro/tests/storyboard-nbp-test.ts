/**
 * 測試：Gemini 3.1 Pro 分鏡文案 + NBP (Nano Banana Pro) 分鏡圖
 * 對比 Forge 版本的效果
 */

// ─── Step 1: Gemini 3.1 Pro 生成分鏡文案 ───
async function generateStoryboardWithGeminiPro() {
  const { GoogleGenAI } = await import("@google/genai");
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const lyrics = `故事的小黄花 从出生那年就飘着
童年的荡秋千 随记忆一直晃到现在
Re So So Si Do Si La
So La Si Si Si Si La Si La So
吹着前奏 望着天空
我想起花瓣试着掉落

为你翘课的那一天 花落的那一天
教室的那一间 我怎么看不见
消失的下雨天 我好想再淋一遍
没想到 失去的勇气我还留着

刮风这天 我试过握着你手
但偏偏 雨渐渐 大到我看你不见`;

  const prompt = `你是一位专业的MV导演和分镜师。请根据以下歌词，生成专业的MV分镜脚本。

歌词：
${lyrics}

请生成 JSON 格式的分镜脚本，包含以下字段：
{
  "title": "分镜标题",
  "bpm": 数字,
  "mood": "情感基调",
  "musicStyle": "音乐风格",
  "key": "调性",
  "scenes": [
    {
      "sceneNumber": 数字,
      "lyrics": "对应歌词片段",
      "description": "场景描述（详细，用于生成图片）",
      "cameraMovement": "镜头运动",
      "mood": "情绪氛围",
      "visualElements": ["视觉元素1", "视觉元素2"],
      "transition": "转场方式",
      "imagePrompt": "用于AI生成分镜图的英文提示词（详细、电影感、包含构图和光影描述）"
    }
  ]
}

请生成 5 个场景，每个场景的 imagePrompt 必须是详细的英文描述，适合用于高质量AI图片生成。`;

  console.log("=== Step 1: Gemini 3.1 Pro 生成分鏡文案 ===");
  console.log("模型: gemini-3-pro-preview");
  const startTime = Date.now();
  
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`生成耗时: ${elapsed}s`);
  
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  // 提取 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log("原始回覆:", text.substring(0, 500));
    throw new Error("未能解析 JSON");
  }
  
  const storyboard = JSON.parse(jsonMatch[0]);
  console.log(`\n標題: ${storyboard.title}`);
  console.log(`BPM: ${storyboard.bpm}`);
  console.log(`情感: ${storyboard.mood}`);
  console.log(`風格: ${storyboard.musicStyle}`);
  console.log(`場景數: ${storyboard.scenes?.length}`);
  
  for (const scene of storyboard.scenes || []) {
    console.log(`\n--- Scene ${scene.sceneNumber} ---`);
    console.log(`歌詞: ${scene.lyrics}`);
    console.log(`描述: ${scene.description}`);
    console.log(`鏡頭: ${scene.cameraMovement}`);
    console.log(`imagePrompt: ${scene.imagePrompt?.substring(0, 100)}...`);
  }
  
  return storyboard;
}

// ─── Step 2: NBP (Nano Banana Pro) 生成分鏡圖 ───
async function generateNBPImage(prompt: string, sceneIndex: number) {
  const { GoogleGenAI } = await import("@google/genai");
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  
  const ai = new GoogleGenAI({ apiKey });
  
  // 增強 prompt，加入電影分鏡風格
  const enhancedPrompt = `Cinematic storyboard frame, professional film production quality, 16:9 aspect ratio, dramatic lighting, shallow depth of field. ${prompt}`;
  
  console.log(`\n=== NBP 生成 Scene ${sceneIndex + 1} ===`);
  
  // 嘗試 NBP 模型列表（跟 gemini-image.ts 一致）
  const modelNames = [
    "gemini-3-pro-image-preview",
    "nano-banana-pro-preview",
    "gemini-3-flash-preview",
  ];
  
  let response: any = null;
  let usedModel = "";
  
  for (const modelName of modelNames) {
    try {
      console.log(`嘗試模型: ${modelName}`);
      const startTime = Date.now();
      
      response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts: [{ text: enhancedPrompt }] }],
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`成功! 模型: ${modelName}, 耗時: ${elapsed}s`);
      usedModel = modelName;
      break;
    } catch (err: any) {
      console.log(`模型 ${modelName} 失敗: ${err.message?.substring(0, 80)}`);
      continue;
    }
  }
  
  if (!response) throw new Error("所有 NBP 模型都失敗了");
  
  // 提取圖片
  const parts = response.candidates?.[0]?.content?.parts;
  const imagePart = parts?.find((p: any) => p.inlineData?.data);
  
  if (!imagePart?.inlineData) {
    const textPart = parts?.find((p: any) => p.text);
    console.log("無圖片返回，文字:", textPart?.text?.substring(0, 100));
    throw new Error("NBP 未返回圖片");
  }
  
  // 保存到本地
  const fs = await import("fs");
  const buffer = Buffer.from(imagePart.inlineData.data!, "base64");
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const filename = `/home/ubuntu/nbp-scene-${sceneIndex + 1}.${ext}`;
  fs.writeFileSync(filename, buffer);
  console.log(`圖片已保存: ${filename} (${(buffer.length / 1024).toFixed(0)} KB, 模型: ${usedModel})`);
  
  return { filename, model: usedModel };
}

// ─── Main ───
async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Gemini 3.1 Pro + NBP 分鏡測試          ║");
  console.log("║  對比 Forge 版本效果                     ║");
  console.log("╚══════════════════════════════════════════╝\n");
  
  // Step 1: Gemini Pro 生成文案
  const storyboard = await generateStoryboardWithGeminiPro();
  
  // Step 2: NBP 生成前 3 個場景的分鏡圖
  const scenes = storyboard.scenes?.slice(0, 3) || [];
  const results: any[] = [];
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    try {
      const result = await generateNBPImage(scene.imagePrompt || scene.description, i);
      results.push(result);
    } catch (err: any) {
      console.error(`Scene ${i + 1} 生成失敗:`, err.message);
    }
  }
  
  // 總結
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  測試結果總結                             ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`文案引擎: Gemini 3.1 Pro (gemini-3-pro-preview)`);
  console.log(`圖片引擎: NBP (Nano Banana Pro)`);
  console.log(`場景總數: ${storyboard.scenes?.length}`);
  console.log(`生成圖片: ${results.length} 張`);
  for (const r of results) {
    console.log(`  - ${r.filename} (模型: ${r.model})`);
  }
}

main().catch(console.error);
