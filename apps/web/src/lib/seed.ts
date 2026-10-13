import { addDays, monday, today } from "./scheduling";
import { workspaceSchema, type WorkspaceData } from "./model";
export const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function seed(): WorkspaceData {
  const start = monday(today());
  const orgId = uid(1);
  const people = [
    ["Olivia Chen", "Design lead", "Design", "sage", 8, 85],
    ["James Wilson", "Product designer", "Design", "lilac", 8, 65],
    ["Sofia Martinez", "Brand designer", "Design", "peach", 8, 60],
    ["Noah Williams", "Frontend engineer", "Engineering", "blue", 8, 90],
    ["Emma Thompson", "Full-stack engineer", "Engineering", "rose", 8, 85],
    ["Liam Patel", "Product manager", "Strategy", "sage", 8, 80],
    ["Ava Robinson", "UX researcher", "Strategy", "lilac", 6, 70],
    ["Oliver Kim", "Motion designer", "Design", "peach", 8, 65],
  ].map((p, i) => ({
    id: uid(10 + i),
    orgId,
    name: String(p[0]),
    role: String(p[1]),
    team: String(p[2]),
    color: p[3] as "sage",
    dailyMinutes: Number(p[4]) * 60,
    costRate: Number(p[5]) * 100,
  }));
  const projects = [
    ["Orbit rebrand", "Orbit", "lilac", 640, 150],
    ["Lumina website", "Lumina", "sage", 480, 160],
    ["Forma mobile app", "Forma", "blue", 960, 175],
    ["Studio operations", "Internal", "peach", 320, 0],
    ["Evergreen discovery", "Evergreen", "rose", 160, 140],
  ].map((p, i) => ({
    id: uid(30 + i),
    orgId,
    name: String(p[0]),
    client: String(p[1]),
    color: p[2] as "sage",
    budgetMinutes: Number(p[3]) * 60,
    billRate: Number(p[4]) * 100,
    status: i === 4 ? ("tentative" as const) : ("confirmed" as const),
  }));
  const rows: [number, number, number, number, number, string, boolean?][] = [
    [0, 0, 0, 4, 6, "Creative direction"],
    [0, 1, 7, 11, 6, "Design review"],
    [0, 3, 0, 2, 2, "Studio planning"],
    [1, 1, 0, 4, 8, "Website design"],
    [1, 0, 7, 9, 6, "Design system"],
    [1, 4, 10, 11, 4, "Discovery", true],
    [2, 0, 0, 8, 6, "Visual identity"],
    [2, 4, 9, 11, 6, "Brand workshop", true],
    [3, 1, 0, 4, 8, "Frontend build"],
    [3, 2, 7, 11, 8, "App development"],
    [4, 2, 0, 8, 8, "Core platform"],
    [4, 1, 2, 3, 3, "Technical review"],
    [4, 2, 9, 11, 6, "API integration"],
    [5, 3, 0, 1, 4, "Sprint planning"],
    [5, 2, 2, 9, 6, "Product strategy"],
    [5, 4, 10, 11, 4, "Project kickoff", true],
    [6, 2, 0, 3, 4, "User interviews"],
    [6, 1, 7, 10, 6, "Usability testing"],
    [7, 0, 1, 4, 6, "Motion exploration"],
    [7, 1, 7, 11, 4, "Micro-interactions"],
  ];
  return workspaceSchema.parse({
    organizations: [
      {
        id: orgId,
        name: "Studio North",
        timezone: "America/New_York",
        currency: "USD",
      },
    ],
    people,
    projects,
    calendars: [],
    absences: [],
    assignments: rows.map((r, i) => ({
      id: uid(100 + i),
      orgId,
      personId: people[r[0]].id,
      projectId: projects[r[1]].id,
      start: addDays(start, r[2]),
      end: addDays(start, r[3]),
      dailyMinutes: r[4] * 60,
      title: r[5],
      status: r[6] ? "tentative" : "confirmed",
      version: 1,
    })),
  });
}
