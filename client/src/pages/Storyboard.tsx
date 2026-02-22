import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";
import {
  ChevronRight,
  Sparkles,
  X,
  Minus,
  Plus,
  Download,
  FileText,
  FileUp,
  Info,
  Loader2,
} from "lucide-react";

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import {
  NbpEngineSelector,
  type EngineOption,
} from "@/components/NbpEngineSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface StoryboardScene {
  sceneNumber: number;
  timestamp: string;
  duration: string;
  description: string;
  cameraMovement: string;
  mood: string;
  visualElements: string[];
  transition?: string;
  previewImageUrl?: string | null;
}

interface StoryboardResult {
  title: string;
  musicInfo: {
    bpm: number;
    emotion: string;
    style: string;
    key: string;
  };
  scenes: StoryboardScene[];
  summary: string;
}

// Character limit constants
const AI_GENERATE_MAX_CHARS = 1000;
const OWN_SCRIPT_MAX_CHARS = 2000;
const MAX_SCENES = 10;

export default function StoryboardPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading, user } = useAuth();

  const [lyricsText, setLyricsText] = useState("");
  const [sceneCount, setSceneCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [storyboard, setStoryboard] = useState<StoryboardResult | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<number | null>(null);
  const [editedScene, setEditedScene] = useState<StoryboardScene | null>(null);
  const [imageEngine, setImageEngine] = useState<EngineOption>("forge");
  const [showInspirationModal, setShowInspirationModal] = useState(false);
  const [inspirationInput, setInspirationInput] = useState("");
  const [isGeneratingInspiration, setIsGeneratingInspiration] = useState(false);
  const [upgradePromptDismissed, setUpgradePromptDismissed] = useState(false);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});
  const [scriptSource, setScriptSource] = useState<"own" | "ai">("own");
  const [exportMenuVisible, setExportMenuVisible] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const generateStoryboard = trpc.storyboard.generate.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const exportPDFMutation = trpc.storyboard.exportPDF.useMutation();
  const inspirationMutation = trpc.storyboard.generateInspiration.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });
  const userPlan = (subQuery.data?.plan || "free") as string;
  const userCredits = subQuery.data?.credits?.balance ?? 0;

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
  }, [loading, isAuthenticated, navigate]);

  const charCount = lyricsText.length;
  const currentMaxChars = scriptSource === "ai" ? AI_GENERATE_MAX_CHARS : OWN_SCRIPT_MAX_CHARS;
  const isOverCharLimit = charCount > currentMaxChars;
  const isOverSceneLimit = sceneCount > MAX_SCENES;

  const handleGenerate = async () => {
    if (!lyricsText.trim()) {
      toast.warning("请输入歌词或文本内容");
      return;
    }

    if (isOverCharLimit) {
      toast.error(
        `您的文本为 ${charCount} 字，超出${scriptSource === "ai" ? "AI 生成" : "自有脚本"}的免费额度 ${currentMaxChars} 字。超出部分需消耗 Credits。`,
        {
          action: {
            label: "查看 Credits",
            onClick: () => navigate("/pricing"),
          },
        }
      );
      return;
    }

    try {
      const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "storyboard" });
      if (!accessCheck.allowed) {
        setQuotaModalInfo({
          isTrial: (accessCheck as any).isTrial,
          planName: (accessCheck as any).planName,
        });
        setQuotaModalVisible(true);
        return;
      }
    } catch (error: any) {
      toast.error(error.message || "无法检查使用权限");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateStoryboard.mutateAsync({
        lyrics: lyricsText,
        sceneCount: sceneCount,
      });

      if (result.success && result.storyboard) {
        setStoryboard(result.storyboard);
        usageStatsQuery.refetch();
        toast.success(result.message || "分镜脚本已生成！");
      }
    } catch (error) {
      console.error("AlertCircle generating storyboard:", error);
      toast.error("生成分镜脚本失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setLyricsText("");
    setSceneCount(5);
    setStoryboard(null);
    setScriptSource("own");
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleExport = async (format: "pdf" | "word") => {
    if (!storyboard) {
      setExportStatus('请先生成分镜脚本');
      setTimeout(() => setExportStatus(null), 3000);
      return;
    }

    const formatName = format === 'pdf' ? 'PDF' : 'Word';
    try {
      setExportStatus(`正在生成 ${formatName}...`);
      const result = await exportPDFMutation.mutateAsync({ storyboard, format });
      
      if (result.success && result.pdfUrl) {
        setExportStatus(`${formatName} 已生成，正在下载...`);
        triggerDownload(result.pdfUrl, `${storyboard.title || 'storyboard'}.${format === 'pdf' ? 'pdf' : 'doc'}`);
        setTimeout(() => setExportStatus(null), 3000);
      } else {
        setExportStatus(result.message || `${formatName} 生成失败，请重试`);
        setTimeout(() => setExportStatus(null), 5000);
      }
    } catch (error: any) {
      console.error(`[Export ${formatName} AlertCircle]`, error);
      setExportStatus(`导出失败: ${error.message || '未知错误'}`);
      setTimeout(() => setExportStatus(null), 5000);
    }
  };

  const handleEditScene = (scene: StoryboardScene) => {
    setEditingSceneId(scene.sceneNumber);
    setEditedScene({ ...scene });
  };

  const handleSaveEdit = () => {
    if (!editedScene || !storyboard) return;

    const updatedScenes = storyboard.scenes.map((scene) =>
      scene.sceneNumber === editedScene.sceneNumber ? editedScene : scene
    );

    setStoryboard({
      ...storyboard,
      scenes: updatedScenes,
    });

    setEditingSceneId(null);
    setEditedScene(null);
    toast.success("场景已更新！");
  };

  const handleCancelEdit = () => {
    setEditingSceneId(null);
    setEditedScene(null);
  };

  const handleUpdateField = (field: keyof StoryboardScene, value: any) => {
    if (!editedScene) return;
    setEditedScene({
      ...editedScene,
      [field]: value,
    });
  };

  const handleGenerateInspiration = async () => {
    if (!inspirationInput.trim()) {
      toast.warning("请输入灵感描述");
      return;
    }
    setIsGeneratingInspiration(true);
    try {
      const result = await inspirationMutation.mutateAsync({ briefDescription: inspirationInput.trim() });
      if (result.success && result.text) {
        setLyricsText(result.text);
        setScriptSource("ai");
        setShowInspirationModal(false);
        setInspirationInput("");
        toast.success("灵感脚本已生成，您可以继续编辑或直接生成分镜");
      }
    } catch (error: any) {
      toast.error(error.message || "生成失败，请重试");
    } finally {
      setIsGeneratingInspiration(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">检查登录状态...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="overflow-y-auto">
        <UsageQuotaBanner
          featureType="storyboard"
          currentCount={usageStatsQuery.data?.features.storyboard.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.storyboard.limit ?? 1}
          loading={usageStatsQuery.isPending}
        />

        <TrialCountdownBanner
          isTrial={(usageStatsQuery.data as any)?.isTrial}
          trialEndDate={(usageStatsQuery.data as any)?.trialEndDate}
        />

        {usageStatsQuery.data?.studentPlan && (
          <StudentUpgradePrompt
            studentPlan={usageStatsQuery.data.studentPlan}
            usageData={usageStatsQuery.data.features}
            isTrial={(usageStatsQuery.data as any).isTrial}
            trialEndDate={(usageStatsQuery.data as any).trialEndDate}
            style={{ display: !upgradePromptDismissed ? 'block' : 'none' }}
            onDismiss={() => setUpgradePromptDismissed(true)}
          />
        )}

        <div className="px-6 pt-6 pb-4">
          <h1 className="text-3xl font-bold text-foreground mb-2">智能脚本与分镜生成</h1>
          <p className="text-base text-muted-foreground">输入歌词或文本，AI 自动生成专业视频分镜脚本</p>
          <div className="mt-3 bg-green-500/10 px-4 py-2.5 rounded-lg">
            <p className="text-green-500 font-semibold text-sm">
              🎁 AI 智能生成：{AI_GENERATE_MAX_CHARS} 字内免费 · 自有脚本：{OWN_SCRIPT_MAX_CHARS} 字内免费
            </p>
          </div>
        </div>

        {!storyboard && (
          <div className="px-6 py-4">
            <div className="bg-card rounded-2xl p-6 border">
              {!showInspirationModal ? (
                <button
                  onClick={() => setShowInspirationModal(true)}
                  className="mb-4 rounded-xl p-4 flex items-center w-full bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3 bg-primary/10">
                    <Sparkles className="w-[22px] h-[22px] text-primary" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-foreground font-semibold text-base">创作没灵感？</p>
                    <p className="text-muted-foreground text-sm mt-0.5">给我三句话，我帮你生成完整脚本（消耗 Credits）</p>
                  </div>
                  <ChevronRight className="w-[22px] h-[22px] text-muted-foreground" />
                </button>
              ) : (
                <div className="mb-4 rounded-xl p-4 bg-primary/10 border border-primary/20">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <Sparkles className="w-5 h-5 text-primary" />
                      <p className="text-foreground font-semibold ml-2">AI 灵感助手</p>
                      <div className="ml-2 bg-yellow-500/15 px-2 py-0.5 rounded-full">
                        <p className="text-yellow-500 text-xs font-medium">消耗 Credits</p>
                      </div>
                    </div>
                    <button onClick={() => { setShowInspirationModal(false); setInspirationInput(""); }}>
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-muted-foreground text-sm mb-1">接入 Gemini 大模型，根据描述生成专业脚本</p>
                  <p className="text-muted-foreground text-sm mb-3">例如：「一对情侣在雨天的东京重逢，从陈旧的咖啡厅开始」</p>
                  <Textarea
                    value={inspirationInput}
                    onChange={(e) => setInspirationInput(e.target.value)}
                    placeholder="用 1-3 句话描述你的灵感..."
                    maxLength={200}
                    rows={3}
                    className="bg-background rounded-lg p-3 text-foreground mb-3 text-base resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs">{inspirationInput.length}/200</p>
                    <Button
                      onClick={handleGenerateInspiration}
                      disabled={!inspirationInput.trim() || isGeneratingInspiration}
                    >
                      {isGeneratingInspiration ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>生成中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-1" />
                          <span>生成脚本</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    <p className="text-lg font-semibold text-foreground">歌词或文本内容</p>
                    {scriptSource === "ai" && (
                      <div className="ml-2 bg-primary/15 px-2 py-0.5 rounded-full">
                        <p className="text-primary text-xs font-medium">AI 生成</p>
                      </div>
                    )}
                  </div>
                  <p className={`text-sm font-medium ${isOverCharLimit ? "text-destructive" : "text-muted-foreground"}`}>
                    {charCount}/{currentMaxChars} 字
                  </p>
                </div>
                <Textarea
                  value={lyricsText}
                  onChange={(e) => {
                    setLyricsText(e.target.value);
                    if (e.target.value.length === 0) setScriptSource("own");
                  }}
                  placeholder="请输入歌词或文本内容..."
                  rows={10}
                  className={`bg-background rounded-xl p-4 text-foreground text-base resize-none ${isOverCharLimit ? "border-destructive" : "border"}`}
                />
                {isOverCharLimit && (
                  <p className="text-destructive text-sm mt-2">
                    ⚠️ 超出免费额度 {charCount - currentMaxChars} 字，超出部分需消耗 Credits
                  </p>
                )}
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-lg font-semibold text-foreground">分镜数量</p>
                  <p className={`text-sm font-medium ${isOverSceneLimit ? "text-destructive" : "text-muted-foreground"}`}>
                    {sceneCount}/{MAX_SCENES} 个
                  </p>
                </div>
                <div className="flex items-center justify-between bg-background rounded-xl p-4">
                  <Button onClick={() => setSceneCount(Math.max(1, sceneCount - 1))} disabled={sceneCount <= 1} size="icon" className="w-12 h-12 rounded-full">
                    <Minus className="w-6 h-6" />
                  </Button>
                  <p className="text-2xl font-bold text-foreground">{sceneCount}</p>
                  <Button onClick={() => setSceneCount(Math.min(MAX_SCENES + 5, sceneCount + 1))} size="icon" className="w-12 h-12 rounded-full">
                    <Plus className="w-6 h-6" />
                  </Button>
                </div>
                {isOverSceneLimit && (
                  <p className="text-destructive text-sm mt-2">
                    ⚠️ 超出免费额度 {sceneCount - MAX_SCENES} 个分镜，超出部分需消耗 Credits
                  </p>
                )}
              </div>

              <div className="mb-6">
                <NbpEngineSelector
                  selected={imageEngine}
                  onSelect={setImageEngine}
                  plan={userPlan}
                  creditsAvailable={userCredits}
                  isAdmin={user?.role === "admin"}
                />
              </div>

              <Button onClick={handleGenerate} disabled={!lyricsText.trim() || isGenerating} className="w-full py-6 text-lg">
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span>AI 生成中...</span>
                  </>
                ) : (
                  <span>生成分镜脚本</span>
                )}
              </Button>
            </div>
          </div>
        )}

        {storyboard && (
          <div className="px-6 py-4">
            <div className="bg-card rounded-2xl p-6 border mb-4">
              <h2 className="text-xl font-bold text-foreground mb-4">{storyboard.title}</h2>
              <div className="flex flex-wrap gap-2">
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">BPM: {storyboard.musicInfo.bpm}</p>
                </div>
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">{storyboard.musicInfo.emotion}</p>
                </div>
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">{storyboard.musicInfo.style}</p>
                </div>
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">调性: {storyboard.musicInfo.key}</p>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <h2 className="text-xl font-bold text-foreground mb-3">分镜详情</h2>
              {storyboard.scenes.map((scene) => {
                const isEditing = editingSceneId === scene.sceneNumber;
                const displayScene = isEditing && editedScene ? editedScene : scene;
                
                return (
                  <div key={scene.sceneNumber} className="bg-card rounded-2xl p-5 border mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold text-foreground">场景 {scene.sceneNumber}</h3>
                      <div className="flex items-center gap-2">
                        <p className="text-muted-foreground text-sm">
                          {scene.timestamp} ({scene.duration})
                        </p>
                        {!isEditing && (
                          <Button variant="outline" size="sm" onClick={() => handleEditScene(scene)} className="text-xs">
                            编辑
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {scene.previewImageUrl && (
                      <div className="mb-4 rounded-xl overflow-hidden bg-muted/30">
                        <img
                          src={scene.previewImageUrl}
                          alt={`Scene ${scene.sceneNumber} preview`}
                          className="w-full aspect-video object-contain"
                        />
                      </div>
                    )}
                    
                    <div className="mb-3">
                      <p className="text-muted-foreground text-sm mb-1">场景描述</p>
                      {isEditing ? (
                        <Textarea
                          value={displayScene.description}
                          onChange={(e) => handleUpdateField('description', e.target.value)}
                          rows={4}
                          className="bg-background rounded-lg p-3 text-foreground w-full resize-none"
                        />
                      ) : (
                        <p className="text-foreground leading-relaxed">{displayScene.description}</p>
                      )}
                    </div>
                    
                    <div className="bg-background rounded-lg p-3 mb-2">
                      <p className="text-muted-foreground text-sm mb-1">镜头运动</p>
                      {isEditing ? (
                        <Input
                          value={displayScene.cameraMovement}
                          onChange={(e) => handleUpdateField('cameraMovement', e.target.value)}
                          className="text-foreground bg- border-0"
                        />
                      ) : (
                        <p className="text-foreground">{displayScene.cameraMovement}</p>
                      )}
                    </div>
                    
                    <div className="bg-background rounded-lg p-3 mb-2">
                      <p className="text-muted-foreground text-sm mb-1">情绪氛围</p>
                      {isEditing ? (
                        <Input
                          value={displayScene.mood}
                          onChange={(e) => handleUpdateField('mood', e.target.value)}
                          className="text-foreground bg- border-0"
                        />
                      ) : (
                        <p className="text-foreground">{displayScene.mood}</p>
                      )}
                    </div>
                    
                    <div className="bg-background rounded-lg p-3 mb-2">
                      <p className="text-muted-foreground text-sm mb-2">视觉元素</p>
                      {isEditing ? (
                        <Input
                          value={displayScene.visualElements.join(', ')}
                          onChange={(e) => handleUpdateField('visualElements', e.target.value.split(',').map(s => s.trim()))}
                          placeholder="以逗号分隔多个元素"
                          className="text-foreground bg- border-0"
                        />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {displayScene.visualElements.map((element, idx) => (
                            <div key={idx} className="bg-primary/10 px-2 py-1 rounded">
                              <p className="text-primary text-xs">{element}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {(displayScene.transition || isEditing) && (
                      <div className="bg-background rounded-lg p-3 mb-2">
                        <p className="text-muted-foreground text-sm mb-1">转场建议</p>
                        {isEditing ? (
                          <Input
                            value={displayScene.transition || ''}
                            onChange={(e) => handleUpdateField('transition', e.target.value)}
                            className="text-foreground bg- border-0"
                          />
                        ) : (
                          <p className="text-foreground">{displayScene.transition}</p>
                        )}
                      </div>
                    )}
                    
                    {isEditing && (
                      <div className="flex gap-2 mt-3">
                        <Button onClick={handleSaveEdit} className="flex-1">
                          保存
                        </Button>
                        <Button onClick={handleCancelEdit} variant="secondary" className="flex-1">
                          取消
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-card rounded-2xl p-6 border mb-4">
              <h3 className="text-lg font-bold text-foreground mb-3">整体建议</h3>
              <p className="text-foreground leading-relaxed">{storyboard.summary}</p>
            </div>

            <div className="mb-6">
              <div className="flex gap-3 mb-3">
                <Button onClick={handleReset} variant="secondary" className="flex-1 py-6 text-base">
                  重新生成
                </Button>
                <Button onClick={() => setExportMenuVisible(!exportMenuVisible)} className="flex-1 py-6 text-base">
                  <Download className="w-4 h-4 mr-2" />
                  导出脚本
                </Button>
              </div>

              {exportMenuVisible && (
                <div className="bg-card rounded-xl border overflow-hidden">
                  <button
                    onClick={() => { setExportMenuVisible(false); handleExport("pdf"); }}
                    disabled={exportPDFMutation.isPending}
                    className="flex items-center p-4 border-b w-full text-left hover:bg-muted/50 disabled:opacity-50"
                  >
                    <FileText className="w-6 h-6 text-red-600" />
                    <div className="ml-3 flex-1">
                      <p className="text-foreground font-semibold">导出 PDF</p>
                      <p className="text-muted-foreground text-xs mt-0.5">含分镜图片，适合打印和分享</p>
                    </div>
                    {exportPDFMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  </button>
                  <button
                    onClick={() => { setExportMenuVisible(false); handleExport("word"); }}
                    disabled={exportPDFMutation.isPending}
                    className="flex items-center p-4 w-full text-left hover:bg-muted/50 disabled:opacity-50"
                  >
                    <FileUp className="w-6 h-6 text-blue-600" />
                    <div className="ml-3 flex-1">
                      <p className="text-foreground font-semibold">导出 Word</p>
                      <p className="text-muted-foreground text-xs mt-0.5">可编辑格式，适合团队协作</p>
                    </div>
                    {exportPDFMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  </button>
                </div>
              )}

              {exportStatus && (
                <div className="bg-card rounded-xl border border-primary p-3 mt-3">
                  <div className="flex items-center">
                    {exportPDFMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    ) : (
                      <Info className="w-4 h-4 text-primary" />
                    )}
                    <p className="text-foreground text-sm ml-2 flex-1">{exportStatus}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <QuotaExhaustedModal
        style={{ display: quotaModalVisible ? 'flex' : 'none' }}
        featureName="智能脚本与分镜生成"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
        onClose={() => setQuotaModalVisible(false)}
      />
    </div>
  );
}
