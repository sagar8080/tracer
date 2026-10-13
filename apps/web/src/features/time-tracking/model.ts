export type Entry = {
  id: string;
  sheetId: string;
  projectId: string;
  date: string;
  minutes: number;
  billable: boolean;
  note: string;
  version: number;
};
export type Sheet = {
  id: string;
  userId: string;
  personId: string;
  personName: string;
  week: string;
  status: "draft" | "submitted" | "approved";
  version: number;
  reviewNote: string;
  entries: Entry[];
};
export type TimeSnapshot = {
  personId: string | null;
  canRecord: boolean;
  canReview: boolean;
  own: Sheet | null;
  reviews: Sheet[];
};
export const timePath = (orgId: string) => `/api/organizations/${orgId}/time`;
