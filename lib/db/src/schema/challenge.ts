import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { postgresJavaScriptTrimWhitespaceLiteral } from "../emailWhitespace.mjs";

const javascriptTrimWhitespaceSql = sql.raw(postgresJavaScriptTrimWhitespaceLiteral);

export const challengeSettingsTable = pgTable("challenge_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("ByB Ledenchallenge"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const participantsTable = pgTable(
  "participants",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").unique(),
    schoolName: text("school_name").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    startingMembers: integer("starting_members"),
    targetNewMembers: integer("target_new_members"),
    country: text("country").notNull().default("Nederland"),
    masterDataRoute: text("master_data_route"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "participants_email_canonical",
      sql`translate(${table.email}, ${javascriptTrimWhitespaceSql}, '') <> '' and ${table.email} = lower(btrim(${table.email}))`,
    ),
    check(
      "participants_email_usable",
      sql`translate(${table.email}, ${javascriptTrimWhitespaceSql}, '') = ${table.email} and ${table.email} ~ '^[^@]+@[^@]+\\.[^@]+$'`,
    ),
    uniqueIndex("participants_email_lower_unique").on(sql`lower(${table.email})`),
  ],
);

export const participantIdentityReleasesTable = pgTable(
  "participant_identity_releases",
  {
    id: serial("id").primaryKey(),
    participantId: integer("participant_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastWarnedAt: timestamp("last_warned_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("participant_identity_releases_participant_clerk_unique")
      .on(table.participantId, table.clerkUserId),
  ],
);

export const weeklyEntriesTable = pgTable("weekly_entries", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull().references(() => participantsTable.id, { onDelete: "cascade" }),
  weekNumber: integer("week_number").notNull(),
  signups: integer("signups").notNull().default(0),
  attendance: integer("attendance").notNull().default(0),
  enrolled: integer("enrolled").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChallengeSchema = createInsertSchema(challengeSettingsTable).omit({ id: true, updatedAt: true });
export const insertParticipantSchema = createInsertSchema(participantsTable).omit({ id: true, revision: true, createdAt: true, updatedAt: true });
export const insertWeeklyEntrySchema = createInsertSchema(weeklyEntriesTable).omit({ id: true, updatedAt: true });

export type ChallengeSetting = typeof challengeSettingsTable.$inferSelect;
export type Participant = typeof participantsTable.$inferSelect;
export type ParticipantIdentityRelease = typeof participantIdentityReleasesTable.$inferSelect;
export type WeeklyEntry = typeof weeklyEntriesTable.$inferSelect;
export type InsertChallenge = z.infer<typeof insertChallengeSchema>;
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type InsertWeeklyEntry = z.infer<typeof insertWeeklyEntrySchema>;