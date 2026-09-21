import { boolean, date, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { participantsTable } from "./challenge.ts";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

/** Private financial data. All money columns are integer euro cents. */
export const financialSeasonsTable = pgTable("financial_seasons", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull().references(() => participantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  country: text("country").notNull(),
  hasStarterDeduction: boolean("has_starter_deduction").notNull().default(false),
  defaultSalaryCents: integer("default_salary_cents").notNull().default(0),
  ...auditColumns,
}, (table) => [unique("financial_seasons_participant_name_unique").on(table.participantId, table.name)]);

export const financialFileSubmissionsTable = pgTable("financial_file_submissions", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull().references(() => participantsTable.id, { onDelete: "cascade" }),
  seasonId: integer("season_id").notNull().references(() => financialSeasonsTable.id, { onDelete: "cascade" }),
  fileType: text("file_type").notNull(), // teachers, subscriptions
  originalFilename: text("original_filename").notNull(),
  objectPath: text("object_path").notNull().unique(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull().default("open"), // uploading, deleting, open, in_progress, processed
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  statusChangedBy: text("status_changed_by"),
  notificationAttemptedAt: timestamp("notification_attempted_at", { withTimezone: true }),
  notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
  notificationError: text("notification_error"),
  ...auditColumns,
});

export const financialTeachersTable = pgTable("financial_teachers", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => financialSeasonsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hourlyRateCents: integer("hourly_rate_cents").notNull(),
  weeklyTravelCents: integer("weekly_travel_cents").notNull().default(0),
  ...auditColumns,
});

export const financialLocationsTable = pgTable("financial_locations", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => financialSeasonsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rentFrequency: text("rent_frequency").notNull(), // hour, month, session
  rentCents: integer("rent_cents").notNull(),
  rentTermCount: integer("rent_term_count").default(12),
  sessionMinutes: integer("session_minutes"),
  ...auditColumns,
});

export const financialSubscriptionsTable = pgTable("financial_subscriptions", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => financialSeasonsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  audience: text("audience").notNull(), // youth, adult
  productType: text("product_type").notNull().default("subscription"), // subscription, punch_card
  paymentFrequency: text("payment_frequency").notNull().default("monthly"), // monthly, four_weekly, quarterly, half_yearly, yearly, installments, one_time
  priceCents: integer("price_cents").notNull(),
  installmentCount: integer("installment_count"),
  durationMonths: integer("duration_months"),
  rideCount: integer("ride_count"),
  validityMonths: integer("validity_months"),
  vatRateBasisPoints: integer("vat_rate_basis_points").notNull().default(0),
  ...auditColumns,
});

export const financialLessonsTable = pgTable("financial_lessons", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => financialSeasonsTable.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").references(() => financialTeachersTable.id, { onDelete: "set null" }),
  locationId: integer("location_id").references(() => financialLocationsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  weekday: integer("weekday").notNull(), // 0 Sunday through 6 Saturday
  startTime: text("start_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  activeFrom: date("active_from", { mode: "string" }).notNull(),
  activeUntil: date("active_until", { mode: "string" }).notNull(),
  ...auditColumns,
});

export const financialClosuresTable = pgTable("financial_closures", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => financialSeasonsTable.id, { onDelete: "cascade" }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  name: text("name").notNull(),
  ...auditColumns,
}, (table) => [unique("financial_closures_season_period_unique").on(table.seasonId, table.startDate, table.endDate)]);

export const financialMonthsTable = pgTable("financial_months", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => financialSeasonsTable.id, { onDelete: "cascade" }),
  month: date("month", { mode: "string" }).notNull(),
  contributionRevenueCents: integer("contribution_revenue_cents").notNull().default(0),
  taxArrearsCents: integer("tax_arrears_cents").notNull().default(0),
  salaryOverrideCents: integer("salary_override_cents"),
  /** Immutable master data captured transactionally with its lesson inputs; legacy null rows fall back to current data. */
  masterDataSnapshot: jsonb("master_data_snapshot"),
  ...auditColumns,
}, (table) => [unique("financial_months_season_month_unique").on(table.seasonId, table.month)]);

export const financialTaxYearsTable = pgTable("financial_tax_years", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull().references(() => participantsTable.id, { onDelete: "cascade" }),
  calendarYear: integer("calendar_year").notNull(),
  preliminaryPaymentsCents: integer("preliminary_payments_cents").notNull().default(0),
  ...auditColumns,
}, (table) => [unique("financial_tax_years_participant_year_unique").on(table.participantId, table.calendarYear)]);

export const financialFixedCostsTable = pgTable("financial_fixed_costs", {
  id: serial("id").primaryKey(),
  financialMonthId: integer("financial_month_id").notNull().references(() => financialMonthsTable.id, { onDelete: "cascade" }),
  costGroup: text("cost_group").notNull().default("Overig"),
  category: text("category").notNull(),
  frequency: text("frequency").notNull().default("one_time"),
  amountCents: integer("amount_cents").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const financialActivitiesTable = pgTable("financial_activities", {
  id: serial("id").primaryKey(),
  financialMonthId: integer("financial_month_id").notNull().references(() => financialMonthsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  amountCents: integer("amount_cents").notNull(),
});

export const financialLessonMonthInputsTable = pgTable("financial_lesson_month_inputs", {
  id: serial("id").primaryKey(),
  financialMonthId: integer("financial_month_id").notNull().references(() => financialMonthsTable.id, { onDelete: "cascade" }),
  lessonId: integer("lesson_id").notNull().references(() => financialLessonsTable.id, { onDelete: "cascade" }),
  attendance: integer("attendance"),
  lessonCountOverride: integer("lesson_count_override"),
}, (table) => [unique("financial_lesson_month_inputs_month_lesson_unique").on(table.financialMonthId, table.lessonId)]);

export const insertFinancialSeasonSchema = createInsertSchema(financialSeasonsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type FinancialSeason = typeof financialSeasonsTable.$inferSelect;
export type FinancialTeacher = typeof financialTeachersTable.$inferSelect;
export type FinancialLocation = typeof financialLocationsTable.$inferSelect;
export type FinancialSubscription = typeof financialSubscriptionsTable.$inferSelect;
export type FinancialLesson = typeof financialLessonsTable.$inferSelect;
export type FinancialClosure = typeof financialClosuresTable.$inferSelect;
export type FinancialMonth = typeof financialMonthsTable.$inferSelect;
export type FinancialTaxYear = typeof financialTaxYearsTable.$inferSelect;
export type FinancialFileSubmission = typeof financialFileSubmissionsTable.$inferSelect;
export type InsertFinancialSeason = z.infer<typeof insertFinancialSeasonSchema>;