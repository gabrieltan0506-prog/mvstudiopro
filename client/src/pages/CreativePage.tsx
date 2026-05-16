import React, { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import Navbar from "@/components/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Sparkles, Image as ImageIcon, Video, LoaderCircle } from "lucide-react";
import { CREDIT_COSTS } from "../../../server/plans";
import { estimateSeedanceWorkflowCreditsForProduct } from "@shared/seedancePricing";

export default function CreativePage() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [videoModel, setVideoModel] = useState("seedance-2.0");
  const [videoAspect, setVideoAspect] = useState("16:9");
  const [imageModel, setImageModel] = useState("gemini-3.1-flash-image-preview");
  
  const chargeStepMutation = trpc.workflow.chargeStep.useMutation();
  const refundStepMutation = trpc.workflow.refundStep.useMutation();

  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: !!user,
  });
  
  const userPlan = (subQuery.data?.plan || "free") as string;
  const isAdmin = user?.role === "admin" || user?.role === "supervisor";
  const isPaidUser = isAdmin || userPlan !== "free";

  async function generateImage() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    setImageUrl("");
    setVideoUrl("");
    
    let chargedCost = 0;
    try {
      const isGptImage2 = imageModel === "gpt-image-2";
      // GPT-image-2 成本设定为 54，Nano Banana 2 (flash) 设定为 35
      const overrideCost = isGptImage2 ? 54 : 35;
      
      if (isGptImage2 && !isPaidUser) {
         const usageKey = `gpt2_usage_${user?.id}`;
         const usedCount = parseInt(localStorage.getItem(usageKey) || "0", 10);
         if (usedCount >= 1) {
           throw new Error("GPT-image-2 免费/内测额度已用尽（限1张），请升级为付费用户继续使用。");
         }
         localStorage.setItem(usageKey, (usedCount + 1).toString());
      }
      
      const charge = await chargeStepMutation.mutateAsync({ step: "scene_image", quantity: 1, creditsOverride: overrideCost });
      chargedCost = charge.cost;
      
      let res;
      if (isGptImage2) {
        // 调用后台 /api/jobs 进行 GPT-image-2 生图 (复用生成参考图接口，由于其底层是 generateGptImage2FromRawEnglishPrompt)
        res = await fetch(`/api/jobs?op=workflowGenerateSceneImage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenePrompt: prompt,
            imageModel: "gpt-image-1", // Backend mapping
            sceneCount: 1,
            // GPT-image-2 只支持 9:16 或 16:9
            aspectRatio: videoAspect === "16:9" ? "16:9" : "9:16",
          })
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || json.message || "生图失败");
        }
        if (json.storyboardImages && json.storyboardImages[0]?.selectedSceneImageUrl) {
           setImageUrl(json.storyboardImages[0].selectedSceneImageUrl);
        } else {
           throw new Error("返回结果缺失图片 URL");
        }
      } else {
        // Nano Banana 2 (Flash) 生图
        res = await fetch(`/api/google?op=nanoImage&tier=flash&model=gemini-3.1-flash-image-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            tier: "flash",
            model: "gemini-3.1-flash-image-preview",
            imageSize: videoAspect === "16:9" ? "16:9" : "9:16",
            aspectRatio: videoAspect === "16:9" ? "16:9" : "9:16",
            numberOfImages: 1,
            guidanceScale: 4
          })
        });
        const json = await res.json();
        if (!res.ok || !json.imageUrl) {
          throw new Error(json.error || json.message || "生图失败");
        }
        setImageUrl(json.imageUrl || json.imageUrls?.[0]);
      }
    } catch (err: any) {
      if (chargedCost > 0) {
        await refundStepMutation.mutateAsync({ step: "scene_image", quantity: 1, creditsOverride: chargedCost, reason: "Creative生图失败退款" });
      }
      setError(err.message || "生成图片失败");
    } finally {
      setLoading(false);
    }
  }

  async function generateVideo() {
    if (!imageUrl) return;
    if (videoModel === "seedance-2.0" && !isPaidUser) {
      setError("Seedance 2.0 暂不开放给未付费用户，需购买积分包才能使用。");
      return;
    }
    
    setLoading(true);
    setError("");
    setVideoUrl("");
    
    let chargedCost = 0;
    try {
      let overrideCost = 0;
      if (videoModel === "seedance-2.0") {
        overrideCost = Math.ceil(estimateSeedanceWorkflowCreditsForProduct({
          resolution: "720p",
          aspectRatio: videoAspect as any,
          durationSec: 10,
        }).credits * 1.5);
      } else {
        overrideCost = Math.ceil(CREDIT_COSTS.workflowSceneVideo * 1.5);
      }

      const charge = await chargeStepMutation.mutateAsync({ step: "scene_video", quantity: 1, creditsOverride: overrideCost });
      chargedCost = charge.cost;
      
      let finalVideoUrl = "";
      
      if (videoModel === "seedance-2.0") {
        // Use klingCreate (Seedance 2.0)
        const res = await fetch(`/api/jobs?op=klingCreate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "seedance-2.0",
            prompt,
            imageUrl,
            duration: "10",
            resolution: "720p",
            aspectRatio: videoAspect
          })
        });
        const json = await res.json();
        if (!res.ok || !json.taskId) {
          throw new Error(json.error || json.message || "提交视频任务失败");
        }
        
        const taskId = json.taskId;
        
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const pollRes = await fetch(`/api/jobs?op=klingTask&taskId=${encodeURIComponent(taskId)}`);
          if (!pollRes.ok) continue;
          const pollJson = await pollRes.json();
          if (pollJson.failed) {
            throw new Error(pollJson.error || "视频生成失败");
          }
          if (pollJson.done && pollJson.videoUrl) {
            finalVideoUrl = pollJson.videoUrl;
            break;
          }
        }
      } else {
        // Use veoCreate (Veo 3.1)
        const res = await fetch(`/api/jobs?op=veoCreate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            imageUrl,
            aspectRatio: videoAspect
          })
        });
        const json = await res.json();
        if (!res.ok || !json.taskId) {
          throw new Error(json.error || json.message || "提交视频任务失败");
        }
        
        const taskId = json.taskId;
        
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const pollRes = await fetch(`/api/jobs?op=veoTask&taskId=${encodeURIComponent(taskId)}`);
          if (!pollRes.ok) continue;
          const pollJson = await pollRes.json();
          if (pollJson.failed) {
            throw new Error(pollJson.error || "视频生成失败");
          }
          if (pollJson.done && pollJson.videoUrl) {
            finalVideoUrl = pollJson.videoUrl;
            break;
          }
        }
      }
      
      if (!finalVideoUrl) {
        throw new Error("视频生成超时，请稍后重试");
      }
      setVideoUrl(finalVideoUrl);
    } catch (err: any) {
      if (chargedCost > 0) {
        await refundStepMutation.mutateAsync({ step: "scene_video", quantity: 1, creditsOverride: chargedCost, reason: "Creative视频失败退款" });
      }
      setError(err.message || "生成视频失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <Navbar />
      <main className="px-4 pb-8 pt-24 md:px-6 flex justify-center">
        <div className="w-full max-w-3xl">
          <h1 className="mb-6 text-3xl font-black tracking-tight">文字生图 / 图生视频</h1>
          <p className="mb-8 text-white/60 text-sm">直接通过文字生成图片，然后将图片转换为视频。生成图片使用 Nano Banana 2。</p>
          
          <Card className="border-white/10 bg-white/5 p-6">
            <CardContent className="p-0 flex flex-col gap-6">
              
              <div className="space-y-2">
                <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> 提示词
                </label>
                <textarea 
                  value={prompt} 
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="请输入画面描述..."
                  rows={4}
                  className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white outline-none"
                />
              </div>

              {error && <div className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">{error}</div>}

              <div className="flex flex-col gap-4">
                <div className="flex gap-4 items-center mb-2">
                  <label className="text-sm font-semibold text-white/80 flex items-center gap-2">生图模型：</label>
                  <select 
                    value={imageModel}
                    onChange={(e) => setImageModel(e.target.value)}
                    className="rounded-lg border border-white/15 bg-[#0b1020] p-2 text-sm text-white outline-none"
                  >
                    <option value="gemini-3.1-flash-image-preview">Nano Banana 2</option>
                    <option value="gpt-image-2">GPT-image-2</option>
                  </select>
                </div>

                <div className="flex gap-4 items-center mb-2 flex-wrap">
                  <div className="flex gap-2 items-center">
                    <label className="text-sm font-semibold text-white/80">视频模型：</label>
                    <select 
                      value={videoModel}
                      onChange={(e) => setVideoModel(e.target.value)}
                      className="rounded-lg border border-white/15 bg-[#0b1020] p-2 text-sm text-white outline-none"
                    >
                      <option value="veo-3.1">Veo 3.1</option>
                      <option value="seedance-2.0">Seedance 2.0 (限付费用户)</option>
                    </select>
                  </div>
                  
                  <div className="flex gap-2 items-center">
                    <label className="text-sm font-semibold text-white/80">视频比例：</label>
                    <select 
                      value={videoAspect}
                      onChange={(e) => setVideoAspect(e.target.value)}
                      className="rounded-lg border border-white/15 bg-[#0b1020] p-2 text-sm text-white outline-none"
                    >
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                    </select>
                  </div>
                  
                  <div className="flex gap-2 items-center">
                    <label className="text-sm font-semibold text-white/80">画质：</label>
                    <div className="text-sm font-semibold text-white/50 border border-white/10 bg-white/5 px-3 py-1.5 rounded-lg">720P</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <Button 
                    onClick={generateImage} 
                    disabled={loading || !prompt.trim()}
                    className="rounded-xl bg-primary flex-1"
                  >
                    {loading && !imageUrl ? <LoaderCircle className="w-4 h-4 mr-2 animate-spin" /> : <ImageIcon className="w-4 h-4 mr-2" />}
                    生成图片
                  </Button>
                  
                  <Button 
                    onClick={generateVideo}
                    disabled={loading || !imageUrl}
                    className="rounded-xl bg-indigo-500 hover:bg-indigo-600 flex-1"
                  >
                    {loading && imageUrl && !videoUrl ? <LoaderCircle className="w-4 h-4 mr-2 animate-spin" /> : <Video className="w-4 h-4 mr-2" />}
                    转换为视频
                  </Button>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                  {imageUrl && (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-white/80">生成的图片</div>
                      <img src={imageUrl} alt="Generated" className="w-full rounded-xl border border-white/10 shadow-lg" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-4">
                  {videoUrl && (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-white/80">生成的视频</div>
                      <video src={videoUrl} controls className="w-full rounded-xl border border-white/10 shadow-lg" />
                    </div>
                  )}
                </div>
              </div>
              
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
