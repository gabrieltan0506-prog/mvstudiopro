import { boolean, integer, json, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const workflows = pgTable("workflows", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  workspaceId: integer("workspaceId").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  status: text("status").default("draft").notNull(),
  klingMotionControlEnabled: boolean("klingMotionControlEnabled").default(false).notNull(),
  klingLipsyncEnabled: boolean("klingLipsyncEnabled").default(false).notNull(),
  klingElementsEnabled: boolean("klingElementsEnabled").default(false).notNull(),
  klingParams: json("klingParams"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const workflowStepRuns = pgTable("workflow_step_runs", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  workflowId: integer("workflowId").notNull(),
  stepType: text("stepType").notNull(),
  version: integer("version").notNull(),
  status: text("status").default("running").notNull(),
  input: json("input"),
  output: json("output"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;

export type Workflow = typeof workflows.$inferSelect;
export type InsertWorkflow = typeof workflows.$inferInsert;

export type WorkflowStepRun = typeof workflowStepRuns.$inferSelect;
export type InsertWorkflowStepRun = typeof workflowStepRuns.$inferInsert;
