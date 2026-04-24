import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const userFeedback = pgTable("user_feedback", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  message: text("message").notNull(),
  status: text("status").default("pending").notNull(),
  creditsAwarded: integer("creditsAwarded"),
  adoptedAt: timestamp("adoptedAt"),
  adoptedBy: integer("adoptedBy"),
  adminNote: varchar("adminNote", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserFeedback = typeof userFeedback.$inferSelect;
