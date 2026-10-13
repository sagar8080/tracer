export type Totals = {
  plannedMinutes: number;
  recordedMinutes: number;
  approvedMinutes: number;
  billableMinutes: number;
  capacityMinutes: number;
};
export type PersonReport = Totals & { id: string; name: string };
export type ProjectReport = Totals & {
  id: string;
  name: string;
  color: string;
  budgetMinutes: number;
  lifetimeApprovedMinutes: number;
};
export type DayReport = Totals & { date: string };
export type Report = {
  start: string;
  end: string;
  totals: Totals;
  people: PersonReport[];
  projects: ProjectReport[];
  days: DayReport[];
};
export function utilization(minutes: number, capacity: number) {
  return capacity ? `${Math.round((minutes / capacity) * 100)}%` : "—";
}
