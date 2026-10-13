export type LeaveRequest = {
  id: string;
  userId: string;
  personId: string;
  personName: string;
  title: string;
  start: string;
  end: string;
  dailyMinutes: number | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  version: number;
  reviewNote: string;
  absenceId: string | null;
};
export type LeaveSnapshot = {
  canRequest: boolean;
  canReview: boolean;
  personId: string | null;
  requests: LeaveRequest[];
};
export const leavePath = (orgId: string) => `/api/organizations/${orgId}/leave`;
