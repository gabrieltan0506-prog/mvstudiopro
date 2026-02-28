import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, PencilLine, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type StepType = "script" | "storyboard" | "images" | "video" | "audio" | "export";

const FIXED_STEPS: { key: StepType; label: string; hint: string }[] = [
  { key: "script", label: "脚本", hint: "叙事结构、钩子设计与节奏分段" },
  { key: "storyboard", label: "分镜", hint: "画面规划与镜头调度" },
  { key: "images", label: "图像", hint: "参考图像与已生成静态图" },
  { key: "video", label: "视频", hint: "主要动态渲染结果" },
  { key: "audio", label: "音频", hint: "人声与音乐处理" },
  { key: "export", label: "导出", hint: "交付包与发布素材" },
];

const RENDER_MESSAGES = [
  "正在分析你最近的创作模式...",
  "正在基于历史运行结果起草下一版...",
  "正在优化时序与画面节奏...",
  "正在打包当前步骤产物...",
];

export default function WorkspaceStudioPage() {
  const { isAuthenticated, loading } = useAuth({ redirectOnUnauthenticated: true });

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [runPromptByStep, setRunPromptByStep] = useState<Record<StepType, string>>({
    script: "",
    storyboard: "",
    images: "",
    video: "",
    audio: "",
    export: "",
  });

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);

  const [isRendering, setIsRendering] = useState(false);
  const [currentRenderMessage, setCurrentRenderMessage] = useState(RENDER_MESSAGES[0]);

  const [motionControl, setMotionControl] = useState(false);
  const [lipsync, setLipsync] = useState(false);
  const [elements, setElements] = useState(false);
  const [motionIntensity, setMotionIntensity] = useState("0.6");
  const [lipsyncStrength, setLipsyncStrength] = useState("0.7");
  const [elementsPrompt, setElementsPrompt] = useState("");

  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const utils = trpc.useUtils();

  const workspacesQuery = trpc.workflow.listWorkspaces.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });

  const workflowsQuery = trpc.workflow.listWorkflows.useQuery(
    { workspaceId: selectedWorkspaceId ?? 0 },
    { enabled: isAuthenticated && !loading && selectedWorkspaceId !== null },
  );

  const workflowQuery = trpc.workflow.getWorkflow.useQuery(
    { workflowId: selectedWorkflowId ?? 0 },
    { enabled: isAuthenticated && !loading && selectedWorkflowId !== null },
  );

  const stepRunsQuery = trpc.workflow.listStepRuns.useQuery(
    { workflowId: selectedWorkflowId ?? 0 },
    { enabled: isAuthenticated && !loading && selectedWorkflowId !== null },
  );

  const suggestionCardsQuery = trpc.workflow.suggestFeatureCards.useQuery(
    { workflowId: selectedWorkflowId ?? 0 },
    {
      enabled: isAuthenticated && !loading && selectedWorkflowId !== null && isRendering,
    },
  );

  const createWorkspace = trpc.workflow.createWorkspace.useMutation({
    onSuccess: async () => {
      setNewWorkspaceName("");
      await utils.workflow.listWorkspaces.invalidate();
    },
  });

  const updateWorkspace = trpc.workflow.updateWorkspace.useMutation({
    onSuccess: async () => {
      await utils.workflow.listWorkspaces.invalidate();
    },
  });

  const deleteWorkspace = trpc.workflow.deleteWorkspace.useMutation({
    onSuccess: async () => {
      setSelectedWorkspaceId(null);
      setSelectedWorkflowId(null);
      await utils.workflow.listWorkspaces.invalidate();
      await utils.workflow.listWorkflows.invalidate();
    },
  });

  const createWorkflow = trpc.workflow.createWorkflow.useMutation({
    onSuccess: async () => {
      setNewWorkflowName("");
      await utils.workflow.listWorkflows.invalidate();
    },
  });

  const updateWorkflow = trpc.workflow.updateWorkflow.useMutation({
    onSuccess: async () => {
      await utils.workflow.listWorkflows.invalidate();
      await utils.workflow.getWorkflow.invalidate();
    },
  });

  const deleteWorkflow = trpc.workflow.deleteWorkflow.useMutation({
    onSuccess: async () => {
      setSelectedWorkflowId(null);
      await utils.workflow.listWorkflows.invalidate();
      await utils.workflow.getWorkflow.invalidate();
      await utils.workflow.listStepRuns.invalidate();
    },
  });

  const updateStudioControls = trpc.workflow.updateStudioControls.useMutation({
    onSuccess: async () => {
      await utils.workflow.getWorkflow.invalidate();
      toast.success("工作室设置已保存");
    },
    onError: (error) => toast.error(error.message),
  });

  const startStepRun = trpc.workflow.startStepRun.useMutation();
  const completeStepRun = trpc.workflow.completeStepRun.useMutation();

  useEffect(() => {
    if (!workspacesQuery.data || workspacesQuery.data.length === 0) {
      setSelectedWorkspaceId(null);
      return;
    }

    if (!selectedWorkspaceId || !workspacesQuery.data.some((w) => w.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspacesQuery.data[0].id);
    }
  }, [workspacesQuery.data, selectedWorkspaceId]);

  useEffect(() => {
    const workflows = workflowsQuery.data ?? [];
    if (workflows.length === 0) {
      setSelectedWorkflowId(null);
      return;
    }

    if (!selectedWorkflowId || !workflows.some((w) => w.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [workflowsQuery.data, selectedWorkflowId]);

  useEffect(() => {
    const wf = workflowQuery.data;
    if (!wf) return;

    setMotionControl(wf.klingMotionControlEnabled);
    setLipsync(wf.klingLipsyncEnabled);
    setElements(wf.klingElementsEnabled);

    const params = (wf.klingParams ?? {}) as {
      motionIntensity?: number;
      lipsyncStrength?: number;
      elementsPrompt?: string;
    };

    setMotionIntensity(String(params.motionIntensity ?? 0.6));
    setLipsyncStrength(String(params.lipsyncStrength ?? 0.7));
    setElementsPrompt(params.elementsPrompt ?? "");
  }, [workflowQuery.data]);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearInterval(messageTimerRef.current);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    };
  }, []);

  const runsByStep = useMemo(() => {
    const grouped: Record<StepType, Array<any>> = {
      script: [],
      storyboard: [],
      images: [],
      video: [],
      audio: [],
      export: [],
    };

    for (const run of stepRunsQuery.data ?? []) {
      grouped[run.stepType as StepType].push(run);
    }

    return grouped;
  }, [stepRunsQuery.data]);

  if (loading || workspacesQuery.isLoading) {
    return (
      <div className="min-h-screen bg-[#0C1117] text-white flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    await createWorkspace.mutateAsync({ name: newWorkspaceName.trim() });
  };

  const handleRenameWorkspace = async (id: number, name: string, description: string | null) => {
    const next = window.prompt("工作区名称", name)?.trim();
    if (!next || next === name) return;
    await updateWorkspace.mutateAsync({ id, name: next, description });
  };

  const handleCreateWorkflow = async () => {
    if (!selectedWorkspaceId || !newWorkflowName.trim()) return;
    await createWorkflow.mutateAsync({
      workspaceId: selectedWorkspaceId,
      name: newWorkflowName.trim(),
    });
  };

  const handleRenameWorkflow = async (id: number, name: string, description: string | null, status: "draft" | "active" | "archived") => {
    const next = window.prompt("工作流名称", name)?.trim();
    if (!next || next === name) return;
    await updateWorkflow.mutateAsync({
      id,
      name: next,
      description,
      status,
    });
  };

  const handleSaveStudioControls = async () => {
    if (!selectedWorkflowId) return;

    await updateStudioControls.mutateAsync({
      workflowId: selectedWorkflowId,
      motionControl,
      lipsync,
      elements,
      klingParams: {
        motionIntensity: Number(motionIntensity) || 0,
        lipsyncStrength: Number(lipsyncStrength) || 0,
        elementsPrompt: elementsPrompt.trim() || undefined,
      },
    });
  };

  const handleRunStep = async (stepType: StepType) => {
    if (!selectedWorkflowId) return;

    try {
      const run = await startStepRun.mutateAsync({
        workflowId: selectedWorkflowId,
        stepType,
        input: {
          prompt: runPromptByStep[stepType] || undefined,
        },
      });

      setIsRendering(true);
      let idx = 0;
      setCurrentRenderMessage(RENDER_MESSAGES[idx]);
      if (messageTimerRef.current) clearInterval(messageTimerRef.current);
      messageTimerRef.current = setInterval(() => {
        idx = (idx + 1) % RENDER_MESSAGES.length;
        setCurrentRenderMessage(RENDER_MESSAGES[idx]);
      }, 1600);

      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
      completeTimerRef.current = setTimeout(async () => {
        await completeStepRun.mutateAsync({
          runId: run.id,
          status: "completed",
          output: {
            summary: `自动完成 ${stepType} 版本 ${run.version}`,
          },
        });

        if (messageTimerRef.current) clearInterval(messageTimerRef.current);
        setIsRendering(false);
        await utils.workflow.listStepRuns.invalidate();
        await utils.workflow.getWorkflow.invalidate();
        await utils.workflow.listWorkflows.invalidate();
      }, 4200);
    } catch (error: any) {
      setIsRendering(false);
      toast.error(error?.message ?? "步骤执行失败");
    }
  };

  return (
    <div className="min-h-screen bg-[#0C1117] text-[#E8EDF2] p-4 md:p-6">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[280px_340px_1fr] gap-4">
        <section className="rounded-xl border border-white/10 bg-[#111827] p-4">
          <h2 className="text-sm uppercase tracking-wider text-white/70 mb-3">工作区管理</h2>
          <div className="flex gap-2 mb-3">
            <Input
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="新建工作区"
            />
            <Button size="icon" onClick={handleCreateWorkspace} disabled={createWorkspace.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {(workspacesQuery.data ?? []).map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => setSelectedWorkspaceId(workspace.id)}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                  selectedWorkspaceId === workspace.id ? "border-cyan-400 bg-cyan-400/10" : "border-white/10 hover:border-white/30"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{workspace.name}</p>
                    <p className="text-xs text-white/60">{workspace.workflowCount} 个工作流</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRenameWorkspace(workspace.id, workspace.name, workspace.description);
                      }}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteWorkspace.mutateAsync({ id: workspace.id });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#111827] p-4">
          <h2 className="text-sm uppercase tracking-wider text-white/70 mb-3">工作流管理</h2>
          <div className="flex gap-2 mb-3">
            <Input
              value={newWorkflowName}
              onChange={(e) => setNewWorkflowName(e.target.value)}
              placeholder="新建工作流"
              disabled={!selectedWorkspaceId}
            />
            <Button
              size="icon"
              onClick={handleCreateWorkflow}
              disabled={!selectedWorkspaceId || createWorkflow.isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {workflowsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {(workflowsQuery.data ?? []).map((workflow) => (
                <button
                  key={workflow.id}
                  onClick={() => setSelectedWorkflowId(workflow.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                    selectedWorkflowId === workflow.id ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{workflow.name}</p>
                      <p className="text-xs text-white/60">状态：{workflow.status}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRenameWorkflow(
                            workflow.id,
                            workflow.name,
                            workflow.description,
                            workflow.status,
                          );
                        }}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteWorkflow.mutateAsync({ id: workflow.id });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-[#111827] p-4 md:p-5">
          {!selectedWorkflowId ? (
            <p className="text-white/70">请选择一个工作流来管理步骤与工作室设置。</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <h2 className="text-lg font-semibold mr-2">工作流步骤与版本历史</h2>
                {workflowQuery.data ? <Badge variant="secondary">{workflowQuery.data.name}</Badge> : null}
              </div>

              <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-3 mb-4">
                <h3 className="font-medium mb-2">工作室控制 V1（Kling）</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <label className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
                    <span className="text-sm">动作控制</span>
                    <Switch checked={motionControl} onCheckedChange={setMotionControl} />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
                    <span className="text-sm">口型同步</span>
                    <Switch checked={lipsync} onCheckedChange={setLipsync} />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
                    <span className="text-sm">角色元素</span>
                    <Switch checked={elements} onCheckedChange={setElements} />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                  <Input value={motionIntensity} onChange={(e) => setMotionIntensity(e.target.value)} placeholder="动作强度（0-1）" />
                  <Input value={lipsyncStrength} onChange={(e) => setLipsyncStrength(e.target.value)} placeholder="口型强度（0-1）" />
                  <Input value={elementsPrompt} onChange={(e) => setElementsPrompt(e.target.value)} placeholder="元素提示词" />
                </div>

                <Button onClick={handleSaveStudioControls} disabled={updateStudioControls.isPending}>
                  Save controls
                </Button>
              </div>

              {isRendering ? (
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <p className="text-sm font-medium">{currentRenderMessage}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                    {(suggestionCardsQuery.data ?? []).slice(0, 3).map((card) => (
                      <div key={card.id} className="rounded-md border border-white/20 bg-white/5 p-2">
                        <p className="text-sm font-medium">{card.title}</p>
                        <p className="text-xs text-white/70 mt-1">{card.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                {FIXED_STEPS.map((step) => {
                  const runs = runsByStep[step.key] ?? [];
                  const latest = runs[0];

                  return (
                    <div key={step.key} className="rounded-lg border border-white/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div>
                          <p className="font-medium">{step.label}</p>
                          <p className="text-xs text-white/60">{step.hint}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {latest ? <Badge variant="outline">v{latest.version}</Badge> : null}
                          <Button
                            size="sm"
                            onClick={() => void handleRunStep(step.key)}
                            disabled={isRendering || startStepRun.isPending || completeStepRun.isPending}
                          >
                            <Play className="h-3.5 w-3.5 mr-1" />
                            Run
                          </Button>
                        </div>
                      </div>

                      <Textarea
                        value={runPromptByStep[step.key]}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRunPromptByStep((prev) => ({ ...prev, [step.key]: value }));
                        }}
                        placeholder={`Prompt for ${step.label}`}
                        className="mb-2"
                      />

                      <div className="space-y-1">
                        {(runs.slice(0, 4) as Array<any>).map((run) => (
                          <div key={run.id} className="rounded border border-white/10 px-2 py-1 text-xs flex items-center justify-between gap-2">
                            <span>
                              v{run.version} · {run.status}
                            </span>
                            <span className="text-white/60">{new Date(run.startedAt).toLocaleString()}</span>
                          </div>
                        ))}
                        {runs.length === 0 ? <p className="text-xs text-white/50">暂无版本记录。</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
