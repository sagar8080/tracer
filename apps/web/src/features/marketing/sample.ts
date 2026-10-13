import type { Person, Assignment, Absence } from "@/lib/model";
import { capacity, dates } from "@/lib/scheduling";

// Illustrative product data only. Never fetched from or written to a workspace.
export const weekStart = "2026-10-19";
export const week = dates(weekStart, 5);
const orgId = "10000000-0000-4000-8000-000000000001";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const people: Person[] = [
  {
    id: id(2),
    orgId,
    name: "Maya Chen",
    role: "Brand designer",
    team: "Studio",
    dailyMinutes: 480,
    costRate: null,
    color: "sage",
    version: 1,
  },
  {
    id: id(3),
    orgId,
    name: "Oliver Reed",
    role: "Product designer",
    team: "Studio",
    dailyMinutes: 480,
    costRate: null,
    color: "lilac",
    version: 1,
  },
  {
    id: id(4),
    orgId,
    name: "Sofia Walker",
    role: "Developer",
    team: "Studio",
    dailyMinutes: 480,
    costRate: null,
    color: "blue",
    version: 1,
  },
  {
    id: id(5),
    orgId,
    name: "Noah Patel",
    role: "Project lead",
    team: "Studio",
    dailyMinutes: 420,
    costRate: null,
    color: "peach",
    version: 1,
  },
];
export const projects = [
  { id: id(10), name: "Atlas rebrand", color: "sage" },
  { id: id(11), name: "Studio website", color: "lilac" },
  { id: id(12), name: "Mobile app", color: "blue" },
  { id: id(13), name: "New business", color: "peach" },
] as const;
const allocation = (
  n: number,
  person: number,
  project: number,
  title: string,
  start: number,
  end: number,
  dailyMinutes: number,
): Assignment => ({
  id: id(n),
  orgId,
  personId: people[person].id,
  projectId: projects[project].id,
  title,
  start: week[start],
  end: week[end],
  dailyMinutes,
  status: "confirmed",
  version: 1,
});
export const assignments = [
  allocation(20, 0, 0, "Brand exploration", 0, 2, 360),
  allocation(21, 0, 0, "Identity guidelines", 3, 4, 240),
  allocation(22, 1, 1, "Website design", 0, 2, 360),
  allocation(23, 1, 2, "Product flows", 3, 4, 300),
  allocation(24, 1, 3, "Pitch concepts", 3, 4, 240),
  allocation(25, 2, 0, "Build & handoff", 0, 2, 420),
  allocation(26, 3, 1, "Delivery planning", 0, 4, 210),
];
export const absences: Absence[] = [
  {
    id: id(30),
    orgId,
    personId: people[2].id,
    category: "timeOff",
    title: "Time off",
    start: week[3],
    end: week[4],
    dailyMinutes: null,
    version: 1,
  },
];
export const loads = people.map((p) =>
  capacity(p, assignments, weekStart, 5, { calendars: [], absences }),
);
export const totals = {
  planned: loads.reduce((n, p) => n + p.planned, 0),
  capacity: loads.reduce((n, p) => n + p.total, 0),
  available: loads.reduce((n, p) => n + p.available, 0),
  overload: loads.reduce((n, p) => n + p.overload, 0),
};
export const actualMinutes = [1440, 2040, 1200, 1080];
export const dailyTotals = week.map((_, i) => ({
  capacity: loads.reduce((n, p) => n + p.days[i].total, 0),
  planned: loads.reduce((n, p) => n + p.days[i].planned, 0),
}));
