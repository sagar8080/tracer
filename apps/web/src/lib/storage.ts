import { request } from "./http";
import { workspaceSchema, type WorkspaceData } from "./model";
import { seed } from "./seed";
export const STORAGE_KEY = "kivo.workspace.v1";
export function readWorkspace(): WorkspaceData {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? workspaceSchema.parse(JSON.parse(raw)) : seed();
}
export function saveWorkspace(data: WorkspaceData) {
  workspaceSchema.parse(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
export const isRemote = process.env.NEXT_PUBLIC_STORAGE_MODE === "api";
const api = (method = "GET", body?: unknown) =>
  request("/api/workspace", method === "GET" ? undefined : body);
export async function loadWorkspace(): Promise<WorkspaceData> {
  return isRemote ? workspaceSchema.parse(await api()) : readWorkspace();
}
export async function persistRemote(
  previous: WorkspaceData,
  next: WorkspaceData,
): Promise<WorkspaceData> {
  const keys = [
    "organizations",
    "people",
    "projects",
    "assignments",
    "calendars",
    "absences",
  ] as const;
  const kinds = {
    organizations: "organization",
    people: "person",
    projects: "project",
    assignments: "assignment",
    calendars: "calendar",
    absences: "absence",
  };
  const commands: unknown[] = [];
  for (const key of keys) {
    for (const record of next[key]) {
      const old = previous[key].find((r) => r.id === record.id);
      if (JSON.stringify(old) !== JSON.stringify(record))
        commands.push({ kind: kinds[key], value: record });
    }
    for (const record of previous[key])
      if (!next[key].some((r) => r.id === record.id)) {
        if (!["assignments", "calendars", "absences"].includes(key))
          throw new Error("This record cannot be deleted.");
        commands.push({
          kind:
            key === "calendars"
              ? "deleteCalendar"
              : key === "absences"
                ? "deleteAbsence"
                : "deleteAssignment",
          value: record,
        });
      }
  }
  if (commands.length !== 1) throw new Error("Save one record at a time.");
  await api("POST", commands[0]);
  try {
    return workspaceSchema.parse(await api());
  } catch {
    throw new Error(
      "The change was saved, but the refreshed plan could not be loaded. Reload before editing again.",
    );
  }
}
