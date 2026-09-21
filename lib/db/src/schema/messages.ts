import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { participantsTable } from "./challenge.ts";

export const coachMessagesTable = pgTable("coach_messages", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull().references(() => participantsTable.id, { onDelete: "cascade" }),
  adminUserId: text("admin_user_id").notNull(),
  authorName: text("author_name").notNull().default("ByB coach"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCoachMessageSchema = createInsertSchema(coachMessagesTable).omit({ id: true, createdAt: true });

export type CoachMessage = typeof coachMessagesTable.$inferSelect;
export type InsertCoachMessage = z.infer<typeof insertCoachMessageSchema>;