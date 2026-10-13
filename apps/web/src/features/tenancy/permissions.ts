import type { WorkspaceData } from "@/lib/model";
export type Role = "owner" | "admin" | "planner" | "member" | "viewer";
export function permissions(
  data: WorkspaceData | null,
  orgId: string,
  remote: boolean,
) {
  const role = remote
    ? data?.access.find((a) => a.orgId === orgId)?.role
    : "owner";
  const administer = role === "owner" || role === "admin";
  return {
    role,
    administer,
    finance: administer,
    plan: administer || role === "planner",
  };
}
export function mayEdit(
  editor: {
    kind:
      | "organization"
      | "person"
      | "project"
      | "assignment"
      | "calendar"
      | "absence";
    value: { id?: string; category?: string };
  },
  access: ReturnType<typeof permissions>,
) {
  if (editor.kind === "organization" && !editor.value.id) return true;
  if (
    ["person", "organization", "calendar"].includes(editor.kind) ||
    (editor.kind === "absence" && editor.value.category === "holiday")
  )
    return access.administer;
  return access.plan;
}
