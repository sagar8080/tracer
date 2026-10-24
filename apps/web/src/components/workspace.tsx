"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  ArrowDownToLine,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FolderKanban,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
  X,
  AlertTriangle,
  ArrowUpRight,
  Undo2,
  PanelLeft,
  MoreHorizontal,
  UserRound,
  Clock3,
} from "lucide-react";
import type {
  Assignment,
  Person,
  Project,
  Organization,
  WorkspaceData,
  WorkingCalendar,
  Absence,
} from "@/lib/model";
import { workspaceSchema } from "@/lib/model";
import {
  addDays,
  capacity,
  hours,
  monday,
  today,
  workingDays,
  weeklyMinutes,
} from "@/lib/scheduling";
import {
  readWorkspace,
  saveWorkspace,
  loadWorkspace,
  persistRemote,
  isRemote,
} from "@/lib/storage";
import Editor, {
  type EditorState,
  editAssignment,
  newAssignment,
  editCalendar,
  editAbsence,
} from "./editor";
import Timeline from "./timeline";
import CapacityView from "./capacity-view";
import { permissions, mayEdit } from "@/features/tenancy/permissions";
import { Welcome } from "@/features/onboarding/welcome";
import { Imports } from "@/features/imports/imports";
import { Agents } from "@/features/agents/agents";
import { TeamDialog } from "@/features/tenancy/team-dialog";
import { useLiveWorkspace } from "@/features/realtime/use-live-workspace";
import { MyWork } from "@/features/my-work/my-work";
import { Timesheets } from "@/features/time-tracking/timesheets";
import { Reports } from "@/features/reporting/reports";
import { ApiError } from "@/lib/http";
const nav = [
  { id: "mywork", label: "My work", icon: UserRound },
  { id: "timesheets", label: "Timesheets", icon: Clock3 },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "people", label: "People", icon: Users },
  { id: "capacity", label: "Capacity", icon: BarChart3 },
] as const;
type View = (typeof nav)[number]["id"] | "agents" | "imports";
export default function Workspace({ account }: { account?: string }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [view, setView] = useState<View>("schedule");
  const featureView = [
    "mywork",
    "timesheets",
    "reports",
    "agents",
    "imports",
  ].includes(view);
  const [start, setStart] = useState(monday(today()));
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("All teams");
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [editor, setEditorState] = useState<EditorState | null>(null);
  const [toast, setToast] = useState("");
  const [undo, setUndo] = useState<WorkspaceData | null>(null);
  const [help, setHelp] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const access = permissions(data, orgId, isRemote);
  function setEditor(value: EditorState | null) {
    if (value && !mayEdit(value, access)) return;
    if (isRemote && value?.kind === "organization" && !value.value.id) {
      setOnboarding(true);
      return;
    }
    setError("");
    setEditorState(value);
  }
  function receiveSnapshot(next: WorkspaceData) {
    setData(next);
    setOrgId((current) =>
      next.organizations.some((o) => o.id === current)
        ? current
        : (next.organizations[0]?.id ?? ""),
    );
  }
  const liveStatus = useLiveWorkspace({
    orgId,
    data,
    busy,
    enabled: isRemote && !!data,
    onSnapshot: receiveSnapshot,
    onFailure: (message) => {
      setError(message);
      setData(null);
    },
  });
  useEffect(() => {
    setEditorState(null);
    setTeamOpen(false);
  }, [orgId, access.role]);
  useEffect(() => {
    if (["agents", "imports"].includes(view) && !access.plan)
      setView("schedule");
  }, [view, access.plan]);
  async function refreshWorkspace() {
    receiveSnapshot(await loadWorkspace());
  }
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadWorkspace()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          const selected = sessionStorage.getItem("kivo.selected-org");
          const id =
            d.organizations.find((o) => o.id === selected)?.id ??
            d.organizations[0]?.id ??
            "";
          setOrgId(id);
          if (
            isRemote &&
            d.access.find((a) => a.orgId === id)?.role === "member"
          )
            setView("mywork");
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            isRemote
              ? String(e.message)
              : "Your saved workspace could not be loaded. Its data has been preserved. Export the stored data from your browser before clearing storage.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!isRemote && e.key === "kivo.workspace.v1") {
        try {
          const updated = readWorkspace();
          setData(updated);
          setOrgId((current) =>
            updated.organizations.some((o) => o.id === current)
              ? current
              : (updated.organizations[0]?.id ?? ""),
          );
          setUndo(null);
        } catch {
          setError(
            "A change in another tab could not be loaded. Reload to retry.",
          );
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (onboarding || !data?.organizations.length || featureView) return;
      const input =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if (!editor && (e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
      }
      if (!input && !editor && !e.metaKey && !e.ctrlKey && e.key === "n") {
        e.preventDefault();
        openNew();
      }
      if (!input && !editor && e.key === "?") setHelp((h) => !h);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const org = data?.organizations.find((o) => o.id === orgId);
  const allPeople = useMemo(
    () => data?.people.filter((p) => p.orgId === orgId) ?? [],
    [data, orgId],
  );
  const projects = useMemo(
    () => data?.projects.filter((p) => p.orgId === orgId) ?? [],
    [data, orgId],
  );
  const assignments = useMemo(
    () => data?.assignments.filter((a) => a.orgId === orgId) ?? [],
    [data, orgId],
  );
  const people = useMemo(
    () =>
      allPeople.filter(
        (p) =>
          (team === "All teams" || p.team === team) &&
          (!query ||
            `${p.name} ${p.role} ${p.team}`
              .toLowerCase()
              .includes(query.toLowerCase()) ||
            assignments.some(
              (a) =>
                a.personId === p.id &&
                projects
                  .find((pr) => pr.id === a.projectId)
                  ?.name.toLowerCase()
                  .includes(query.toLowerCase()),
            )) &&
          (!onlyConflicts ||
            capacity(p, assignments, start, 14, data ?? undefined).conflictDays
              .length > 0),
      ),
    [allPeople, team, query, assignments, projects, onlyConflicts, start, data],
  );
  const metrics = people.map((p) =>
    capacity(p, assignments, start, 14, data ?? undefined),
  );
  const planned = metrics.reduce((s, c) => s + c.planned, 0),
    total = metrics.reduce((s, c) => s + c.total, 0),
    available = metrics.reduce((s, c) => s + c.available, 0),
    conflicts = metrics.filter((c) => c.conflictDays.length).length;
  const activeProjects = projects.filter((p) => p.status !== "complete");
  async function update(next: WorkspaceData, message: string) {
    if (busy) return false;
    setBusy(true);
    try {
      const result = isRemote
        ? await persistRemote(data!, next)
        : (saveWorkspace(next), next);
      setUndo(isRemote ? null : data);
      setData(result);
      setToast(message);
      setError("");
      return true;
    } catch (e) {
      if (
        isRemote &&
        e instanceof ApiError &&
        [409, 422, 403].includes(e.status)
      ) {
        try {
          receiveSnapshot(await loadWorkspace());
        } catch {
          setData(null);
        }
      } else if (isRemote) setData(null);
      setError(
        isRemote && e instanceof Error
          ? e instanceof ApiError && e.status === 409
            ? "This record changed. Your draft is still here; close and reopen it before saving."
            : e.message
          : "Could not save this change. Browser storage may be full or unavailable. Your previous plan is unchanged.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(
    kind: EditorState["kind"],
    value:
      Assignment | Person | Project | Organization | WorkingCalendar | Absence,
  ) {
    if (!data) return;
    const key = {
      assignment: "assignments",
      person: "people",
      project: "projects",
      organization: "organizations",
      calendar: "calendars",
      absence: "absences",
    }[kind] as
      | "organizations"
      | "people"
      | "projects"
      | "assignments"
      | "calendars"
      | "absences";
    const next = {
      ...data,
      [key]: data[key].some((x) => x.id === value.id)
        ? data[key].map((x) => (x.id === value.id ? value : x))
        : [...data[key], value],
    };
    if (await update(workspaceSchema.parse(next), "Changes saved")) {
      setEditor(null);
      if (kind === "organization") {
        setOrgId(value.id);
        setTeam("All teams");
        setQuery("");
      }
    }
  }
  function move(a: Assignment) {
    if (!data || !access.plan) return;
    if (
      !workingDays(
        a.start,
        a.end,
        data.people.find((p) => p.id === a.personId),
        data.calendars,
      )
    ) {
      setToast("Choose a range that includes a working day");
      return;
    }
    update(
      {
        ...data,
        assignments: data.assignments.map((x) => (x.id === a.id ? a : x)),
      },
      "Allocation updated",
    );
  }
  function openNew() {
    if (["agents", "imports"].includes(view)) return;
    if (!access.plan || (view === "people" && !access.administer)) return;
    if (view === "people")
      setEditor({
        kind: "person",
        value: { orgId, color: "sage", ...{ hours: 8, cost: 75 } },
      });
    else if (view === "projects")
      setEditor({
        kind: "project",
        value: {
          orgId,
          color: "lilac",
          status: "confirmed",
          ...{ budget: 160, rate: 150 },
        },
      });
    else
      setEditor(
        newAssignment(orgId, start, allPeople[0]?.id, activeProjects[0]?.id),
      );
  }
  function newTimeOff(
    personId = allPeople[0]?.id,
    date = start,
    category: Absence["category"] = "timeOff",
  ) {
    setEditor(
      editAbsence({
        orgId,
        personId: category === "holiday" ? null : personId,
        category,
        start: date,
        end: date,
      }),
    );
  }
  function editPerson(p: Person) {
    setEditor({
      kind: "person",
      value: {
        ...p,
        ...{ hours: p.dailyMinutes / 60, cost: (p.costRate ?? 0) / 100 },
      },
    });
  }
  function exportCsv() {
    const rows = [
      [
        "Person",
        "Project",
        "Work",
        "Start",
        "End",
        "Hours per workday",
        "Status",
      ],
      ...assignments.map((a) => [
        allPeople.find((p) => p.id === a.personId)?.name ?? "",
        projects.find((p) => p.id === a.projectId)?.name ?? "",
        a.title,
        a.start,
        a.end,
        String(hours(a.dailyMinutes)),
        a.status,
      ]),
    ];
    const safe = (v: string) =>
      `"${(/^[=+@\-\t\r]/.test(v) ? "'" : "") + v.replaceAll('"', '""')}"`;
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(safe).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "kivo-schedule.csv";
    a.click();
    URL.revokeObjectURL(url);
    setToast("Workspace schedule exported");
  }
  if (!data)
    return (
      <div className="loading">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M5 4v16M19 4 9 12l10 8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1>{error ? "Workspace unavailable" : "Opening your workspace…"}</h1>
        {account && error && (
          <a className="text-button" href="/auth/login?returnTo=%2Fapp">
            Sign in again
          </a>
        )}
        {error && (
          <>
            <p role="alert">{error}</p>
            <button className="button" onClick={() => window.location.reload()}>
              Reload workspace
            </button>
          </>
        )}
      </div>
    );
  if (isRemote && (!data.organizations.length || onboarding))
    return (
      <Welcome
        account={account}
        onCancel={
          data.organizations.length ? () => setOnboarding(false) : undefined
        }
        onComplete={async (id) => {
          await refreshWorkspace();
          setOrgId(id);
          setOnboarding(false);
        }}
      />
    );
  if (!data.organizations.length)
    return (
      <div className="loading">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M5 4v16M19 4 9 12l10 8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1>Create your workspace</h1>
        <p>Create your first workspace, then add people and projects.</p>
        {account && (
          <a className="text-button" href="/auth/logout">
            Sign out · {account}
          </a>
        )}
        <button
          className="primary"
          onClick={() =>
            setEditor({
              kind: "organization",
              value: { timezone: "America/New_York" },
            })
          }
        >
          Create workspace
        </button>
        {teamOpen && isRemote && access.administer && access.role && (
          <TeamDialog
            orgId={orgId}
            revision={data.access.find((a) => a.orgId === orgId)?.revision ?? 0}
            role={access.role}
            actorId={data.actorId}
            people={allPeople}
            onClose={() => setTeamOpen(false)}
            onChanged={refreshWorkspace}
          />
        )}
        {editor && (
          <Editor
            canFinance={access.finance}
            externalError={error}
            editor={editor}
            data={data}
            orgId=""
            onClose={() => setEditor(null)}
            onSave={save}
            onDelete={() => {}}
          />
        )}
        {busy && (
          <div className="saving-overlay" role="status">
            Creating workspace…
          </div>
        )}
      </div>
    );
  const dateLabel = new Date(start + "T12:00Z").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const end = addDays(start, 13);
  const rangeLabel = `${new Date(start + "T12:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${new Date(end + "T12:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <Dropdown.Root>
          <Dropdown.Trigger
            className="workspace-switch"
            aria-label={`${org?.name ?? "Workspace"} · switch workspace`}
          >
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 4v16M19 4 9 12l10 8"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>{org?.name}</span>
            <ChevronDown size={14} />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content className="menu" align="start" sideOffset={8}>
              {data.organizations.map((o) => (
                <Dropdown.Item
                  key={o.id}
                  onSelect={() => {
                    setOrgId(o.id);
                    sessionStorage.setItem("kivo.selected-org", o.id);
                    setTeam("All teams");
                    setQuery("");
                    setOnlyConflicts(false);
                    setUndo(null);
                  }}
                >
                  {o.name}
                  {o.id === orgId && <Check size={14} />}
                </Dropdown.Item>
              ))}
              {isRemote && access.administer && (
                <Dropdown.Item onSelect={() => setTeamOpen(true)}>
                  <Users size={15} />
                  Team access
                </Dropdown.Item>
              )}
              {isRemote && access.plan && (
                <>
                  <Dropdown.Item onSelect={() => setView("imports")}>
                    <ArrowDownToLine size={15} />
                    Spreadsheet imports
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={() => setView("agents")}>
                    <Settings2 size={15} /> Agent activity
                  </Dropdown.Item>
                </>
              )}
              {account && (
                <>
                  <Dropdown.Separator />
                  <Dropdown.Item asChild>
                    <a href="/auth/logout">Sign out · {account}</a>
                  </Dropdown.Item>
                </>
              )}
              <Dropdown.Separator />
              <Dropdown.Item
                onSelect={() =>
                  setEditor({
                    kind: "organization",
                    value: { timezone: "America/New_York" },
                  })
                }
              >
                <Plus size={15} />
                New workspace
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
        <div className="nav-label">Workspace</div>
        <nav>
          {nav
            .filter(
              (n) =>
                isRemote || !["mywork", "timesheets", "reports"].includes(n.id),
            )
            .map((n) => (
              <button
                key={n.id}
                className={view === n.id ? "active" : ""}
                aria-label={n.label}
                aria-current={view === n.id ? "page" : undefined}
                title={n.label}
                onClick={() => {
                  setView(n.id);
                  setQuery("");
                  setOnlyConflicts(false);
                }}
              >
                <n.icon size={18} />
                {n.label}
                {n.id === "people" && (
                  <span className="nav-count">{allPeople.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-projects">
          <div className="nav-label">
            Projects{" "}
            <button
              className="icon-button"
              disabled={!access.plan}
              aria-label="Create project"
              onClick={() => {
                setView("projects");
                setEditor({
                  kind: "project",
                  value: {
                    orgId,
                    color: "lilac",
                    status: "confirmed",
                    ...{ budget: 160, rate: 150 },
                  },
                });
              }}
            >
              <Plus size={13} />
            </button>
          </div>
          {activeProjects.map((p) => (
            <button
              className={`sidebar-project ${query === p.name ? "selected" : ""}`}
              key={p.id}
              onClick={() => {
                setView("schedule");
                setQuery(p.name);
                setTeam("All teams");
                setOnlyConflicts(false);
              }}
            >
              <span className={`project-dot ${p.color}`} />
              <span>{p.name}</span>
              {p.status === "tentative" && (
                <span className="tentative-dot" title="Tentative" />
              )}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div
            className="workspace-status"
            title={
              isRemote
                ? "Updates from your shared workspace"
                : "Your changes are saved in this browser"
            }
          >
            <span className="status-dot" />
            <span>{isRemote ? liveStatus : "Local workspace"}</span>
          </div>
          <div className="sidebar-utilities">
            <button
              onClick={() => setEditor({ kind: "organization", value: org! })}
              disabled={!access.administer}
              aria-label="Workspace settings"
            >
              <Settings2 size={15} />
              <span>Settings</span>
            </button>
            <button
              onClick={() => setHelp(!help)}
              aria-label="Help and shortcuts"
              title="Help and shortcuts (?)"
            >
              <CircleHelp size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main
        className="main"
        aria-label={`${view === "imports" ? "Spreadsheet imports" : view === "agents" ? "Agent activity" : nav.find((n) => n.id === view)?.label} workspace`}
      >
        <header className="app-header">
          <div className="header-title">
            <button
              className="icon-button sidebar-toggle"
              aria-label="Toggle sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <PanelLeft size={16} />
            </button>
            <h1>
              {view === "imports"
                ? "Spreadsheet imports"
                : view === "agents"
                  ? "Agent activity"
                  : nav.find((n) => n.id === view)?.label}
            </h1>
            <span className="header-context">
              {featureView
                ? "Your workspace"
                : view === "projects"
                  ? `${projects.length} projects`
                  : `${allPeople.length} ${allPeople.length === 1 ? "person" : "people"}`}
            </span>
          </div>
          {!featureView && (
            <div className="heading-actions">
              <Dropdown.Root>
                <Dropdown.Trigger
                  className="icon-button"
                  aria-label="Workspace actions"
                >
                  <MoreHorizontal size={18} />
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content className="menu" align="end" sideOffset={8}>
                    <Dropdown.Item
                      disabled={!access.plan}
                      onSelect={() => newTimeOff()}
                    >
                      <CalendarDays size={15} />
                      Add time off
                    </Dropdown.Item>
                    <Dropdown.Item
                      disabled={!access.administer}
                      onSelect={() => newTimeOff(undefined, start, "holiday")}
                    >
                      <CalendarDays size={15} />
                      Add workspace holiday
                    </Dropdown.Item>
                    <Dropdown.Separator />
                    {isRemote && access.plan && (
                      <Dropdown.Item onSelect={() => setView("imports")}>
                        <ArrowDownToLine size={15} />
                        Import workbook
                      </Dropdown.Item>
                    )}
                    <Dropdown.Item onSelect={exportCsv}>
                      <ArrowDownToLine size={15} />
                      Export schedule CSV
                    </Dropdown.Item>
                    <Dropdown.Item
                      disabled={!access.administer}
                      onSelect={() =>
                        setEditor({ kind: "organization", value: org! })
                      }
                    >
                      <Settings2 size={15} />
                      Workspace settings
                    </Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
              <button
                className="primary"
                disabled={view === "people" ? !access.administer : !access.plan}
                onClick={openNew}
              >
                <Plus size={15} />
                {view === "people"
                  ? "Add person"
                  : view === "projects"
                    ? "New project"
                    : "Plan work"}
              </button>
            </div>
          )}
        </header>
        {error && (
          <div className="error global-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        <section className="work-area" key={view}>
          {view === "mywork" && (
            <MyWork
              orgId={orgId}
              data={data}
              onChanged={refreshWorkspace}
              onTimesheet={() => setView("timesheets")}
            />
          )}
          {view === "timesheets" && (
            <Timesheets
              orgId={orgId}
              data={data}
              onChanged={refreshWorkspace}
            />
          )}
          {view === "reports" && <Reports orgId={orgId} data={data} />}
          {view === "imports" && access.plan && (
            <Imports
              key={orgId}
              orgId={orgId}
              data={data}
              onChanged={refreshWorkspace}
            />
          )}
          {view === "agents" && access.plan && (
            <Agents
              key={orgId}
              orgId={orgId}
              data={data}
              onChanged={refreshWorkspace}
            />
          )}
          {!featureView && (
            <>
              <div className="workspace-toolbar">
                {view === "schedule" || view === "capacity" ? (
                  <div className="date-controls">
                    <strong title={rangeLabel}>{dateLabel}</strong>
                    <div className="date-nav">
                      <button
                        aria-label="Previous two weeks"
                        onClick={() => setStart(addDays(start, -14))}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <button
                        aria-label="Next two weeks"
                        onClick={() => setStart(addDays(start, 14))}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                    <button
                      className="today-button"
                      onClick={() => setStart(monday(today(org?.timezone)))}
                    >
                      Today
                    </button>
                  </div>
                ) : (
                  <div className="view-label">
                    {view === "projects" ? "All projects" : "Everyone"}
                  </div>
                )}
                <div className="filters">
                  <div className="search">
                    <Search size={14} />
                    <input
                      ref={search}
                      aria-label="Search workspace"
                      placeholder="Search…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button"
                        aria-label="Clear search"
                        onClick={() => setQuery("")}
                      >
                        <X size={12} />
                      </button>
                    )}
                    <kbd>⌘ K</kbd>
                  </div>
                  {view !== "projects" && (
                    <Dropdown.Root>
                      <Dropdown.Trigger
                        className={`filter-trigger ${team !== "All teams" || onlyConflicts ? "is-filtered" : ""}`}
                      >
                        <SlidersHorizontal size={14} />
                        <span>{team === "All teams" ? "Filter" : team}</span>
                        {onlyConflicts && (
                          <span className="filter-count">1</span>
                        )}
                      </Dropdown.Trigger>
                      <Dropdown.Portal>
                        <Dropdown.Content
                          className="menu"
                          align="end"
                          sideOffset={8}
                        >
                          <Dropdown.Label className="menu-label">
                            Teams
                          </Dropdown.Label>
                          {[
                            "All teams",
                            ...new Set(allPeople.map((p) => p.team)),
                          ].map((t) => (
                            <Dropdown.CheckboxItem
                              key={t}
                              checked={team === t}
                              onCheckedChange={() => setTeam(t)}
                            >
                              {t}
                              {team === t && <Check size={14} />}
                            </Dropdown.CheckboxItem>
                          ))}
                          <Dropdown.Separator />
                          <Dropdown.CheckboxItem
                            checked={onlyConflicts}
                            onCheckedChange={setOnlyConflicts}
                          >
                            Over capacity only
                            {onlyConflicts && <Check size={14} />}
                          </Dropdown.CheckboxItem>
                        </Dropdown.Content>
                      </Dropdown.Portal>
                    </Dropdown.Root>
                  )}
                </div>
              </div>
              {(team !== "All teams" || onlyConflicts) &&
                view !== "projects" && (
                  <div className="active-filters">
                    {team !== "All teams" && (
                      <button
                        className="filter-chip"
                        onClick={() => setTeam("All teams")}
                      >
                        {team}
                        <X size={12} />
                      </button>
                    )}
                    {onlyConflicts && (
                      <button
                        className="filter-chip"
                        onClick={() => setOnlyConflicts(false)}
                      >
                        Over capacity
                        <X size={12} />
                      </button>
                    )}
                    <span>
                      {people.length}{" "}
                      {people.length === 1 ? "person" : "people"}
                    </span>
                    <button
                      className="clear-filters"
                      onClick={() => {
                        setTeam("All teams");
                        setOnlyConflicts(false);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                )}
            </>
          )}
          {view === "schedule" && (
            <Timeline
              readOnly={!access.plan}
              canAdminister={access.administer}
              people={people}
              projects={projects}
              assignments={assignments}
              calendar={data}
              onAbsence={(a) => setEditor(editAbsence(a))}
              start={start}
              today={today(org?.timezone)}
              onEdit={(a) => setEditor(editAssignment(a))}
              onCreate={(personId, d, endDate) =>
                setEditor(
                  newAssignment(
                    orgId,
                    d,
                    personId,
                    activeProjects[0]?.id,
                    endDate,
                  ),
                )
              }
              onMove={move}
              onPerson={editPerson}
            />
          )}
          {view === "projects" && (
            <div
              className={`project-list ${access.finance ? "" : "without-finance"}`}
            >
              <div className="project-list-header">
                <span>Project</span>
                <span>Status</span>
                <span>Team</span>
                <span>Hours planned</span>
                {access.finance && <span>Rate</span>}
                <span />
              </div>
              {projects
                .filter((p) =>
                  `${p.name} ${p.client}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((p) => {
                  const allocated = assignments.filter(
                    (a) => a.projectId === p.id && a.status === "confirmed",
                  );
                  const minutes = allocated.reduce(
                    (s, a) =>
                      s +
                      a.dailyMinutes *
                        workingDays(
                          a.start,
                          a.end,
                          allPeople.find((person) => person.id === a.personId),
                          data.calendars,
                        ),
                    0,
                  );
                  const members = allPeople.filter((person) =>
                    allocated.some((a) => a.personId === person.id),
                  );
                  return (
                    <button
                      key={p.id}
                      className="project-row"
                      disabled={!access.plan}
                      onClick={() =>
                        setEditor({
                          kind: "project",
                          value: {
                            ...p,
                            ...{
                              budget: hours(p.budgetMinutes),
                              rate: (p.billRate ?? 0) / 100,
                            },
                          },
                        })
                      }
                    >
                      <div className="project-identity">
                        <span className={`project-icon ${p.color}`}>
                          <FolderKanban size={16} />
                        </span>
                        <div>
                          <h2>{p.name}</h2>
                          <span className="client-name">{p.client}</span>
                        </div>
                      </div>
                      <span className={`project-status ${p.status}`}>
                        <span />
                        {p.status}
                      </span>
                      <div className="avatar-stack">
                        {members.slice(0, 4).map((m) => (
                          <span
                            className={`avatar ${m.color}`}
                            key={m.id}
                            title={m.name}
                          >
                            {m.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </span>
                        ))}
                        {!members.length && <small>Unassigned</small>}
                      </div>
                      <div className="project-budget">
                        <span>
                          {hours(minutes)}
                          <small> / {hours(p.budgetMinutes)}h</small>
                        </span>
                        <div className={`budget-track ${p.color}`}>
                          <i
                            style={{
                              width: `${Math.min(100, (minutes / p.budgetMinutes) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                      {access.finance && (
                        <span className="project-rate">
                          ${(p.billRate ?? 0) / 100}
                          <small>/h</small>
                        </span>
                      )}
                      <ChevronRight size={15} />
                    </button>
                  );
                })}
              <button
                className="add-project"
                disabled={!access.plan}
                onClick={openNew}
              >
                <Plus size={15} />
                <span>Create project</span>
              </button>
            </div>
          )}
          {view === "people" && (
            <div className="directory">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Team</th>
                    <th>Capacity</th>
                    {access.finance && <th>Cost rate</th>}
                    <th>Utilization</th>
                    <th>
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const c = capacity(
                      p,
                      assignments,
                      start,
                      14,
                      data ?? undefined,
                    );
                    return (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="directory-person"
                            disabled={!access.administer}
                            onClick={() => editPerson(p)}
                          >
                            <span className={`avatar ${p.color}`}>
                              {p.name
                                .split(" ")
                                .map((s) => s[0])
                                .join("")}
                            </span>
                            <span>
                              <strong>{p.name}</strong>
                              <small>{p.role}</small>
                            </span>
                          </button>
                        </td>
                        <td>{p.team}</td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => {
                              setView("capacity");
                              setQuery(p.name);
                              setTeam("All teams");
                              setOnlyConflicts(false);
                            }}
                            aria-label={`Working calendar for ${p.name}`}
                          >
                            {hours(
                              weeklyMinutes(
                                p,
                                today(org?.timezone),
                                data.calendars,
                              ).reduce((s, m) => s + m, 0),
                            )}
                            h / week <CalendarDays size={13} />
                          </button>
                        </td>
                        {access.finance && (
                          <td>${(p.costRate ?? 0) / 100} / h</td>
                        )}
                        <td>
                          <span
                            className={`table-util ${c.conflictDays.length ? "over" : ""}`}
                          >
                            {c.utilization === null ? "—" : `${c.utilization}%`}
                          </span>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            disabled={!access.administer}
                            aria-label={`Edit ${p.name}`}
                            onClick={() => editPerson(p)}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!people.length && (
                <div className="empty-state">
                  <Users size={28} />
                  <h2>No people yet</h2>
                  <p>
                    {allPeople.length
                      ? "Clear your filters to see your people."
                      : access.administer
                        ? "Add a scheduling profile or add someone with workspace access to the schedule."
                        : "Your workspace administrator can add people to the schedule. Your invitation gives you access to this workspace."}
                  </p>
                  <button
                    className="primary"
                    disabled={
                      view === "people" ? !access.administer : !access.plan
                    }
                    onClick={openNew}
                  >
                    Add person
                  </button>
                  {isRemote && access.administer && !allPeople.length && (
                    <button
                      className="text-button"
                      onClick={() => setTeamOpen(true)}
                    >
                      Add someone with access
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {view === "capacity" && (
            <CapacityView
              canPlan={access.plan}
              canAdminister={access.administer}
              people={people}
              assignments={assignments}
              projects={projects}
              data={data}
              orgId={orgId}
              start={start}
              onCalendar={(p, value) =>
                setEditor(editCalendar(p, start, data, value))
              }
              onAbsence={(a) => setEditor(editAbsence(a))}
              onNewAbsence={newTimeOff}
              onPlan={(p, date) =>
                setEditor(
                  newAssignment(orgId, date, p.id, activeProjects[0]?.id, date),
                )
              }
              onAssignment={(a) => setEditor(editAssignment(a))}
            />
          )}
        </section>
        {!featureView && (
          <footer className="workspace-footer">
            {view === "schedule" || view === "capacity" ? (
              <>
                <div className="plan-summary" aria-label="Capacity summary">
                  <span>
                    <i className="summary-dot" />
                    <strong>
                      {total ? `${Math.round((planned / total) * 100)}%` : "—"}
                    </strong>{" "}
                    planned
                  </span>
                  <span>
                    <strong>{hours(available)}h</strong> available
                  </span>
                  <button
                    className={conflicts ? "over" : ""}
                    aria-pressed={onlyConflicts}
                    onClick={() => setOnlyConflicts(!onlyConflicts)}
                  >
                    {conflicts > 0 && <AlertTriangle size={12} />}
                    {conflicts ? `${conflicts} over capacity` : "No overloads"}
                  </button>
                </div>
                <button className="canvas-hint" onClick={() => setHelp(!help)}>
                  {view === "schedule"
                    ? access.plan
                      ? "Click or drag on the schedule to plan work"
                      : "Read-only schedule"
                    : "Confirmed work · Net working capacity"}
                  <CircleHelp size={12} />
                </button>
              </>
            ) : (
              <>
                <span>
                  {view === "projects"
                    ? `${projects.length} projects in your workspace`
                    : `${people.length} people in this view`}
                </span>
                <span>
                  {(view === "projects" ? access.plan : access.administer)
                    ? `Click a ${view === "projects" ? "project" : "person"} to edit`
                    : "Read-only access"}
                </span>
              </>
            )}
          </footer>
        )}
        {help && (
          <div className="help-panel">
            <button
              className="icon-button"
              onClick={() => setHelp(false)}
              aria-label="Close help"
            >
              <X size={18} />
            </button>
            <h2>Keyboard shortcuts</h2>
            <p>
              <kbd>⌘ / Ctrl K</kbd> Find a person or project
            </p>
            <p>
              <kbd>N</kbd> Create in the current view
            </p>
            <p>
              <kbd>Enter</kbd> Edit a focused allocation
            </p>
            <p>
              <kbd>Alt + ← / →</kbd> Move an allocation one day
            </p>
            <p>
              <kbd>?</kbd> Toggle this guide
            </p>
            <hr />
            <p>
              Click a day or drag across empty days to plan work. Drag an
              allocation to move it across days or people; drag its right edge
              to resize. Escape cancels a drag. The editor offers the same
              actions with a keyboard.
            </p>
            <small>
              Capacity uses each person’s effective working calendar, time off,
              and workspace holidays. Tentative allocations do not consume
              capacity. Workspace roles control which changes you can make.
            </small>
          </div>
        )}
        {toast && (
          <div role="status" className="toast">
            <Check size={16} />
            {toast}
            {undo && (
              <button
                onClick={() => {
                  try {
                    saveWorkspace(undo);
                    setData(undo);
                    if (!undo.organizations.some((o) => o.id === orgId))
                      setOrgId(undo.organizations[0].id);
                    setUndo(null);
                    setToast("Change undone");
                  } catch {
                    setError("Could not undo. Browser storage is unavailable.");
                  }
                }}
              >
                <Undo2 size={14} />
                Undo
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {teamOpen && isRemote && access.administer && access.role && (
          <TeamDialog
            orgId={orgId}
            revision={data.access.find((a) => a.orgId === orgId)?.revision ?? 0}
            role={access.role}
            actorId={data.actorId}
            people={allPeople}
            onClose={() => setTeamOpen(false)}
            onChanged={refreshWorkspace}
          />
        )}
        {editor && (
          <Editor
            canFinance={access.finance}
            externalError={error}
            key={`${editor.kind}-${editor.value.id ?? "new"}`}
            editor={editor}
            data={data}
            orgId={orgId}
            onClose={() => setEditor(null)}
            onSave={save}
            onDelete={async (id) => {
              const current = [
                ...data.assignments,
                ...data.calendars,
                ...data.absences,
              ].find((r) => r.id === id);
              if (!current || current.version !== editor.value.version) {
                setError(
                  "This record changed while you were editing. Close and reopen it before deleting.",
                );
                return;
              }
              if (
                await update(
                  {
                    ...data,
                    [editor.kind === "calendar"
                      ? "calendars"
                      : editor.kind === "absence"
                        ? "absences"
                        : "assignments"]: data[
                      editor.kind === "calendar"
                        ? "calendars"
                        : editor.kind === "absence"
                          ? "absences"
                          : "assignments"
                    ].filter((a) => a.id !== id),
                  },
                  "Record deleted",
                )
              )
                setEditor(null);
            }}
          />
        )}
        {busy && (
          <div className="saving-overlay" role="status">
            Saving your change…
          </div>
        )}
      </main>
    </div>
  );
}
