import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { workflows, workflowStepRuns, workspaces } from "../../drizzle/schema";

const stepTypeSchema = z.enum(["script", "storyboard", "images", "video", "audio", "export"]);

const templateLibrary = [
  {
    id: "mv-performance-video",
    name: "MV Performance Builder",
    category: "video",
    tags: ["video", "music", "performance"],
    description: "Build a complete performance MV with beat-matched cuts and cinematic transitions.",
    blueprint: {
      workflowDescription: "Music-first performance workflow with rhythm-aware scene planning.",
      initialSteps: {
        script: "Write a 60-second performance script with intro, hook, bridge, and climax.",
        storyboard: "Generate 8 storyboard cards aligned to music phrases and camera movement.",
      },
      klingDefaults: {
        motionControl: true,
        lipsync: false,
        elements: true,
      },
    },
  },
  {
    id: "lyric-storyboard",
    name: "Lyric Storyboard Sprint",
    category: "storyboard",
    tags: ["storyboard", "lyrics", "social"],
    description: "Turn lyric concepts into fast storyboard drafts for short-form releases.",
    blueprint: {
      workflowDescription: "Storyboard-heavy flow for lyrics-driven concepts.",
      initialSteps: {
        script: "Draft concise lyric narrative blocks: setup, turn, payoff.",
        storyboard: "Create 6 visual beats with color palette and lens notes.",
      },
      klingDefaults: {
        motionControl: true,
        lipsync: false,
        elements: false,
      },
    },
  },
  {
    id: "music-video-polish",
    name: "Music Video Polish",
    category: "music",
    tags: ["music", "audio", "mix", "video"],
    description: "Focus on audio energy, transitions, and final export polish.",
    blueprint: {
      workflowDescription: "Audio-forward workflow with final export optimization.",
      initialSteps: {
        script: "Outline emotional arc and sync points for chorus lifts.",
        storyboard: "Plan shots around kick/snare accents and vocal emphasis.",
      },
      klingDefaults: {
        motionControl: false,
        lipsync: true,
        elements: true,
      },
    },
  },
] as const;

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

async function assertWorkspaceOwner(workspaceId: number, userId: number) {
  const database = await db();
  const [workspace] = await database
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  return workspace;
}

async function assertWorkflowOwner(workflowId: number, userId: number) {
  const database = await db();
  const [workflow] = await database
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
    .limit(1);

  if (!workflow) {
    throw new Error("Workflow not found");
  }

  return workflow;
}

export const workflowRouter = router({
  listWorkspaces: protectedProcedure.query(async ({ ctx }) => {
    const database = await db();
    const items = await database
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
        workflowCount: sql<number>`(
          SELECT COUNT(*) FROM workflows w WHERE w.workspaceId = ${workspaces.id}
        )`,
      })
      .from(workspaces)
      .where(eq(workspaces.userId, ctx.user.id))
      .orderBy(desc(workspaces.updatedAt));

    return items;
  }),

  createWorkspace: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await db();
      const [result] = await database.insert(workspaces).values({
        userId: ctx.user.id,
        name: input.name,
        description: input.description ?? null,
      });

      return { id: result.insertId };
    }),

  updateWorkspace: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(input.id, ctx.user.id);
      const database = await db();

      await database
        .update(workspaces)
        .set({
          name: input.name,
          description: input.description ?? null,
        })
        .where(and(eq(workspaces.id, input.id), eq(workspaces.userId, ctx.user.id)));

      return { success: true };
    }),

  deleteWorkspace: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(input.id, ctx.user.id);
      const database = await db();

      const workflowIds = await database
        .select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.workspaceId, input.id), eq(workflows.userId, ctx.user.id)));

      for (const workflowRow of workflowIds) {
        await database
          .delete(workflowStepRuns)
          .where(and(eq(workflowStepRuns.workflowId, workflowRow.id), eq(workflowStepRuns.userId, ctx.user.id)));
      }

      await database
        .delete(workflows)
        .where(and(eq(workflows.workspaceId, input.id), eq(workflows.userId, ctx.user.id)));

      await database
        .delete(workspaces)
        .where(and(eq(workspaces.id, input.id), eq(workspaces.userId, ctx.user.id)));

      return { success: true };
    }),

  listWorkflows: protectedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceOwner(input.workspaceId, ctx.user.id);
      const database = await db();

      return database
        .select()
        .from(workflows)
        .where(and(eq(workflows.workspaceId, input.workspaceId), eq(workflows.userId, ctx.user.id)))
        .orderBy(desc(workflows.updatedAt));
    }),

  getWorkflow: protectedProcedure
    .input(z.object({ workflowId: z.number() }))
    .query(async ({ ctx, input }) => {
      const workflow = await assertWorkflowOwner(input.workflowId, ctx.user.id);
      const database = await db();

      const latestStepRows = await database
        .select()
        .from(workflowStepRuns)
        .where(and(eq(workflowStepRuns.workflowId, workflow.id), eq(workflowStepRuns.userId, ctx.user.id)))
        .orderBy(desc(workflowStepRuns.stepType), desc(workflowStepRuns.version));

      const latestByStep: Record<string, (typeof latestStepRows)[number]> = {};
      for (const row of latestStepRows) {
        if (!latestByStep[row.stepType]) {
          latestByStep[row.stepType] = row;
        }
      }

      return {
        ...workflow,
        latestByStep,
      };
    }),

  createWorkflow: protectedProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        name: z.string().min(1).max(160),
        description: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(input.workspaceId, ctx.user.id);
      const database = await db();
      const [result] = await database.insert(workflows).values({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
        status: "draft",
        klingMotionControlEnabled: false,
        klingLipsyncEnabled: false,
        klingElementsEnabled: false,
      });

      return { id: result.insertId };
    }),

  updateWorkflow: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(160),
        description: z.string().max(4000).optional().nullable(),
        status: z.enum(["draft", "active", "archived"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkflowOwner(input.id, ctx.user.id);
      const database = await db();

      await database
        .update(workflows)
        .set({
          name: input.name,
          description: input.description ?? null,
          status: input.status,
        })
        .where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.user.id)));

      return { success: true };
    }),

  deleteWorkflow: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkflowOwner(input.id, ctx.user.id);
      const database = await db();

      await database
        .delete(workflowStepRuns)
        .where(and(eq(workflowStepRuns.workflowId, input.id), eq(workflowStepRuns.userId, ctx.user.id)));

      await database
        .delete(workflows)
        .where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.user.id)));

      return { success: true };
    }),

  updateStudioControls: protectedProcedure
    .input(
      z.object({
        workflowId: z.number(),
        motionControl: z.boolean(),
        lipsync: z.boolean(),
        elements: z.boolean(),
        klingParams: z
          .object({
            motionIntensity: z.number().min(0).max(1).optional(),
            lipsyncStrength: z.number().min(0).max(1).optional(),
            elementsPrompt: z.string().max(800).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkflowOwner(input.workflowId, ctx.user.id);
      const database = await db();

      await database
        .update(workflows)
        .set({
          klingMotionControlEnabled: input.motionControl,
          klingLipsyncEnabled: input.lipsync,
          klingElementsEnabled: input.elements,
          klingParams: input.klingParams,
        })
        .where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, ctx.user.id)));

      return { success: true };
    }),

  listStepRuns: protectedProcedure
    .input(
      z.object({
        workflowId: z.number(),
        stepType: stepTypeSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWorkflowOwner(input.workflowId, ctx.user.id);
      const database = await db();

      return database
        .select()
        .from(workflowStepRuns)
        .where(
          and(
            eq(workflowStepRuns.workflowId, input.workflowId),
            eq(workflowStepRuns.userId, ctx.user.id),
            ...(input.stepType ? [eq(workflowStepRuns.stepType, input.stepType)] : []),
          ),
        )
        .orderBy(desc(workflowStepRuns.version), desc(workflowStepRuns.startedAt));
    }),

  startStepRun: protectedProcedure
    .input(
      z.object({
        workflowId: z.number(),
        stepType: stepTypeSchema,
        input: z
          .object({
            prompt: z.string().max(4000).optional(),
            notes: z.string().max(4000).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkflowOwner(input.workflowId, ctx.user.id);
      const database = await db();

      const [latest] = await database
        .select({ version: workflowStepRuns.version })
        .from(workflowStepRuns)
        .where(
          and(
            eq(workflowStepRuns.workflowId, input.workflowId),
            eq(workflowStepRuns.userId, ctx.user.id),
            eq(workflowStepRuns.stepType, input.stepType),
          ),
        )
        .orderBy(desc(workflowStepRuns.version))
        .limit(1);

      const nextVersion = (latest?.version ?? 0) + 1;

      const [result] = await database.insert(workflowStepRuns).values({
        userId: ctx.user.id,
        workflowId: input.workflowId,
        stepType: input.stepType,
        version: nextVersion,
        status: "running",
        input: input.input ?? null,
      });

      await database
        .update(workflows)
        .set({ updatedAt: new Date() })
        .where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, ctx.user.id)));

      return { id: result.insertId, version: nextVersion };
    }),

  completeStepRun: protectedProcedure
    .input(
      z.object({
        runId: z.number(),
        status: z.enum(["completed", "failed"]),
        output: z
          .object({
            summary: z.string().max(4000).optional(),
            assetUrl: z.string().max(2000).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await db();
      const [run] = await database
        .select()
        .from(workflowStepRuns)
        .where(and(eq(workflowStepRuns.id, input.runId), eq(workflowStepRuns.userId, ctx.user.id)))
        .limit(1);

      if (!run) throw new Error("Step run not found");

      await database
        .update(workflowStepRuns)
        .set({
          status: input.status,
          output: input.output ?? null,
          completedAt: new Date(),
        })
        .where(and(eq(workflowStepRuns.id, input.runId), eq(workflowStepRuns.userId, ctx.user.id)));

      await database
        .update(workflows)
        .set({ updatedAt: new Date() })
        .where(and(eq(workflows.id, run.workflowId), eq(workflows.userId, ctx.user.id)));

      return { success: true };
    }),

  listTemplates: protectedProcedure
    .input(
      z
        .object({
          category: z.enum(["video", "music", "storyboard"]).optional(),
          query: z.string().max(80).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const q = input?.query?.trim().toLowerCase();

      return templateLibrary.filter((template) => {
        if (input?.category && template.category !== input.category) return false;
        if (!q) return true;

        return (
          template.name.toLowerCase().includes(q) ||
          template.description.toLowerCase().includes(q) ||
          template.tags.some((tag) => tag.includes(q))
        );
      });
    }),

  createWorkflowFromTemplate: protectedProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        templateId: z.string().min(1),
        name: z.string().min(1).max(160).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(input.workspaceId, ctx.user.id);
      const template = templateLibrary.find((item) => item.id === input.templateId);
      if (!template) throw new Error("Template not found");

      const database = await db();
      const [workflowInsert] = await database.insert(workflows).values({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        name: input.name?.trim() || template.name,
        description: template.blueprint.workflowDescription,
        status: "draft",
        klingMotionControlEnabled: template.blueprint.klingDefaults.motionControl,
        klingLipsyncEnabled: template.blueprint.klingDefaults.lipsync,
        klingElementsEnabled: template.blueprint.klingDefaults.elements,
        klingParams: {
          sourceTemplateId: template.id,
        },
      });

      const workflowId = workflowInsert.insertId;

      for (const [stepType, textValue] of Object.entries(template.blueprint.initialSteps)) {
        await database.insert(workflowStepRuns).values({
          userId: ctx.user.id,
          workflowId,
          stepType: stepType as z.infer<typeof stepTypeSchema>,
          version: 1,
          status: "completed",
          input: {
            prompt: textValue,
          },
          output: {
            summary: `${stepType} initialized from template ${template.name}`,
          },
          completedAt: new Date(),
        });
      }

      return { workflowId };
    }),

  suggestFeatureCards: protectedProcedure
    .input(z.object({ workflowId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertWorkflowOwner(input.workflowId, ctx.user.id);
      const database = await db();
      const rows = await database
        .select({
          stepType: workflowStepRuns.stepType,
          total: sql<number>`COUNT(*)`,
        })
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.userId, ctx.user.id))
        .groupBy(workflowStepRuns.stepType);

      const scoreMap = new Map(rows.map((row) => [row.stepType, Number(row.total)]));

      const isVideoHeavy = (scoreMap.get("video") ?? 0) >= (scoreMap.get("audio") ?? 0);
      const isMusicHeavy = (scoreMap.get("audio") ?? 0) > (scoreMap.get("video") ?? 0);

      const cards = [
        {
          id: "storyboard-refiner",
          title: "Storyboard Refiner",
          description: "Auto-balance shot pacing before rendering your next scene.",
          type: "storyboard",
          relevance: (scoreMap.get("storyboard") ?? 0) + 2,
        },
        {
          id: "video-transition-pack",
          title: "Video Transition Pack",
          description: "Apply rhythm-aware transitions optimized for short MV cuts.",
          type: "video",
          relevance: (scoreMap.get("video") ?? 0) + (isVideoHeavy ? 4 : 1),
        },
        {
          id: "music-energy-matcher",
          title: "Music Energy Matcher",
          description: "Suggest energy curves and timing markers for audio/video sync.",
          type: "music",
          relevance: (scoreMap.get("audio") ?? 0) + (isMusicHeavy ? 4 : 1),
        },
      ];

      return cards.sort((a, b) => b.relevance - a.relevance);
    }),
});
