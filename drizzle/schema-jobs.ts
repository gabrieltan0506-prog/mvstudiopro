import { integer, json, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const jobs = pgTable("jobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("userId", { length: 64 }).notNull(),
  type: text("type").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  status: text("status").default("queued").notNull(),
  input: json("input").notNull(),
  output: json("output"),
  error: text("error"),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;
