import { z } from "zod";
const id = z.string().uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Choose a valid date",
  );
export const organizationSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
  currency: z.literal("USD"),
  version: z.number().int().min(1).default(1),
});
export const personSchema = z.object({
  id,
  orgId: id,
  name: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(100),
  team: z.string().trim().min(1).max(100),
  dailyMinutes: z.number().int().min(60).max(1440),
  costRate: z.number().int().min(0).max(10000000).nullable(),
  version: z.number().int().min(1).default(1),
  color: z.enum(["sage", "lilac", "blue", "peach", "rose"]),
});
export const projectSchema = z.object({
  id,
  orgId: id,
  name: z.string().trim().min(1).max(100),
  client: z.string().trim().min(1).max(100),
  color: z.enum(["sage", "lilac", "blue", "peach", "rose"]),
  budgetMinutes: z.number().int().min(60).max(100000000),
  billRate: z.number().int().min(0).max(10000000).nullable(),
  version: z.number().int().min(1).default(1),
  status: z.enum(["confirmed", "tentative", "complete"]),
});
export const assignmentSchema = z
  .object({
    id,
    orgId: id,
    personId: id,
    projectId: id,
    title: z.string().trim().min(1).max(100),
    start: date,
    end: date,
    dailyMinutes: z.number().int().min(15).max(1440).multipleOf(15),
    status: z.enum(["confirmed", "tentative"]),
    version: z.number().int().min(1),
  })
  .refine((v) => v.end >= v.start, "End date must follow start date")
  .refine(
    (v) => (Date.parse(v.end) - Date.parse(v.start)) / 86400000 <= 366,
    "Allocations can span up to one year",
  );
export const calendarSchema = z.object({
  id,
  orgId: id,
  personId: id,
  effectiveFrom: date,
  weeklyMinutes: z
    .array(z.number().int().min(0).max(1440).multipleOf(15))
    .length(7),
  version: z.number().int().min(1),
});
export const absenceSchema = z
  .object({
    id,
    orgId: id,
    personId: id.nullable(),
    category: z.enum(["timeOff", "holiday"]),
    title: z.string().trim().min(1).max(100),
    start: date,
    end: date,
    dailyMinutes: z.number().int().min(15).max(1440).multipleOf(15).nullable(),
    version: z.number().int().min(1),
  })
  .refine(
    (v) =>
      v.end >= v.start &&
      (Date.parse(v.end) - Date.parse(v.start)) / 86400000 <= 366,
    "Choose a range of up to one year",
  )
  .refine(
    (v) =>
      v.category === "holiday"
        ? v.personId === null && v.dailyMinutes === null
        : v.personId !== null,
    "Choose a person for time off; holidays cover the workspace",
  );
export const workspaceSchema = z
  .object({
    actorId: id.nullable().default(null),
    access: z
      .array(
        z.object({
          orgId: id,
          role: z.enum(["owner", "admin", "planner", "member", "viewer"]),
          revision: z.number().int().min(0),
        }),
      )
      .default([]),
    organizations: z.array(organizationSchema),
    people: z.array(personSchema),
    projects: z.array(projectSchema),
    assignments: z.array(assignmentSchema),
    calendars: z.array(calendarSchema).default([]),
    absences: z.array(absenceSchema).default([]),
  })
  .superRefine((s, ctx) => {
    for (const a of s.assignments)
      if (
        !s.people.some((p) => p.id === a.personId && p.orgId === a.orgId) ||
        !s.projects.some((p) => p.id === a.projectId && p.orgId === a.orgId)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Allocation references another workspace or a missing record",
        });
    for (const r of [...s.calendars, ...s.absences]) {
      if (
        !s.organizations.some((o) => o.id === r.orgId) ||
        (r.personId !== null &&
          !s.people.some((p) => p.id === r.personId && p.orgId === r.orgId))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Calendar or time off references another workspace or a missing person",
        });
    }
    const calendarKeys = s.calendars.map(
      (c) => `${c.personId}:${c.effectiveFrom}`,
    );
    if (new Set(calendarKeys).size !== calendarKeys.length)
      ctx.addIssue({
        code: "custom",
        message: "A working calendar already starts on this date",
      });
    for (const rows of [
      s.organizations,
      s.people,
      s.projects,
      s.assignments,
      s.calendars,
      s.absences,
    ])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        ctx.addIssue({
          code: "custom",
          message: "Duplicate record identifier",
        });
    for (const r of [...s.people, ...s.projects])
      if (!s.organizations.some((o) => o.id === r.orgId))
        ctx.addIssue({ code: "custom", message: "Missing workspace" });
  });
export type Organization = z.infer<typeof organizationSchema>;
export type Person = z.infer<typeof personSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type WorkspaceData = z.infer<typeof workspaceSchema>;
export type Color = Project["color"];
export const colors: Color[] = ["sage", "lilac", "blue", "peach", "rose"];

export type WorkingCalendar = z.infer<typeof calendarSchema>;
export type Absence = z.infer<typeof absenceSchema>;
export type CalendarData = Pick<WorkspaceData, "calendars" | "absences">;
