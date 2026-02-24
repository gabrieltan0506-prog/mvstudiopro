import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Category = "all" | "video" | "music" | "storyboard";

export default function TemplatesLibraryPage() {
  const { isAuthenticated, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>("");

  const utils = trpc.useUtils();

  const workspacesQuery = trpc.workflow.listWorkspaces.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });

  const templatesQuery = trpc.workflow.listTemplates.useQuery(
    {
      category: category === "all" ? undefined : category,
      query: query.trim() || undefined,
    },
    { enabled: isAuthenticated && !loading },
  );

  const createFromTemplate = trpc.workflow.createWorkflowFromTemplate.useMutation({
    onSuccess: async () => {
      toast.success("Workflow created from template");
      await utils.workflow.listWorkflows.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    const first = workspacesQuery.data?.[0];
    if (!first) return;
    if (!workspaceId) setWorkspaceId(String(first.id));
  }, [workspacesQuery.data, workspaceId]);

  const activeWorkspace = useMemo(
    () => workspacesQuery.data?.find((item) => String(item.id) === workspaceId),
    [workspacesQuery.data, workspaceId],
  );

  if (loading || workspacesQuery.isLoading || templatesQuery.isLoading) {
    return (
      <div className="min-h-screen bg-[#0C1117] text-white flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0C1117] text-[#E8EDF2] p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="rounded-xl border border-white/10 bg-[#111827] p-4 mb-4">
          <h1 className="text-xl font-semibold">Template Library V1</h1>
          <p className="text-sm text-white/70 mt-1">Filter blueprints and create a workflow in one click.</p>

          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_280px] gap-3 mt-4">
            <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="music">Music</SelectItem>
                <SelectItem value="storyboard">Storyboard</SelectItem>
              </SelectContent>
            </Select>

            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by template name, description, or tags"
            />

            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {(workspacesQuery.data ?? []).map((ws) => (
                  <SelectItem key={ws.id} value={String(ws.id)}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-white/60 mt-2">
            Destination: {activeWorkspace ? activeWorkspace.name : "No workspace selected"}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(templatesQuery.data ?? []).map((template) => (
            <article key={template.id} className="rounded-xl border border-white/10 bg-[#111827] p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{template.name}</h2>
                <Badge variant="outline">{template.category}</Badge>
              </div>
              <p className="text-sm text-white/70 mt-2 min-h-16">{template.description}</p>

              <div className="flex flex-wrap gap-1 mt-2 mb-4">
                {template.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>

              <Button
                className="w-full"
                disabled={!workspaceId || createFromTemplate.isPending}
                onClick={() => {
                  void createFromTemplate.mutateAsync({
                    workspaceId: Number(workspaceId),
                    templateId: template.id,
                  });
                }}
              >
                Create workflow from blueprint
              </Button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
