import type { Assignment, Person, Project } from "@/lib/model";
export type Provider = "manual" | "openai" | "claude" | "gemini";
export type Cell = { reference: string; value: string; formula: boolean };
export type Finding = {
  severity: "block" | "warning";
  code: string;
  message: string;
  cell: string | null;
};
export type Columns = {
  sheet: number;
  layout: "tabular" | "weekly";
  person: number;
  project: number;
  start: number | null;
  end: number | null;
  effort: number | null;
  rowKey: number | null;
  weeks: number[];
  unit: "hoursPerDay" | "totalHours" | "minutesPerDay";
  dateOrder: "iso" | "mdy" | "dmy";
};
export type Mapping = {
  columns: Columns;
  acceptCachedFormulas: boolean;
  acceptCalendarDefaults: boolean;
};
export type Review = {
  version: number;
  mapping: Mapping;
  people: {
    label: string;
    id: string | null;
    weeklyMinutes: number[] | null;
  }[];
  projects: { label: string; id: string | null }[];
};
export type Preview = {
  capacity: {
    personId: string;
    name: string;
    date: string;
    availableMinutes: number;
    plannedMinutes: number;
    calendarEffectiveFrom: string | null;
    absenceIds: string[];
  }[];
  orgRevision: number;
  sourceVersion: number;
  people: { person: Person }[];
  projects: Project[];
  additions: Assignment[];
  updates: Assignment[];
  removals: Assignment[];
  findings: Finding[];
  totalMinutes: number;
  links: {
    assignment: Assignment;
    personName: string;
    projectName: string;
    cells: string[];
    key: string;
  }[];
};
export type Import = {
  id: string;
  sourceId: string;
  fileId: string;
  filename: string;
  version: number;
  sourceVersion: number;
  status: string;
  provider: Provider;
  workbook: {
    sheets: { name: string; headers: Cell[]; rows: Cell[][] }[];
    findings: Finding[];
    suggestion: Columns | null;
    suggestionProvider: Provider;
  } | null;
  review: Review | null;
  preview: Preview | null;
  exportFileId: string | null;
  exportStatus: string | null;
  publishedRevision: number | null;
  errorCode: string | null;
};
export type Registry = { imports: Import[]; providers: Provider[] };
export const providerNames: Record<Provider, string> = {
  manual: "Manual mapping",
  openai: "OpenAI",
  claude: "Claude",
  gemini: "Gemini",
};
export function initialMapping(item: Import): Mapping {
  return (
    item.review?.mapping ?? {
      columns: item.workbook?.suggestion ?? {
        sheet: 0,
        layout: "tabular",
        person: 0,
        project: 1,
        start: null,
        end: null,
        effort: null,
        rowKey: null,
        weeks: [],
        unit: "hoursPerDay",
        dateOrder: "iso",
      },
      acceptCachedFormulas: false,
      acceptCalendarDefaults: false,
    }
  );
}
export function labels(
  item: Import,
  mapping: Mapping,
  field: "person" | "project",
) {
  const sheet = item.workbook?.sheets[mapping.columns.sheet];
  return Array.from(
    new Set(
      sheet?.rows
        .map((r) => r[mapping.columns[field]]?.value.trim() ?? "")
        .filter(Boolean) ?? [],
    ),
  ).sort();
}
