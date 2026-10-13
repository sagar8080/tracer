import type { Assignment } from "@/lib/model";
export type Capability =
  "readSchedule" | "readCapacity" | "proposeMove" | "readProposal";
export type Agent = {
  id: string;
  principalId: string;
  orgId: string;
  name: string;
  purpose: string;
  ownerId: string;
  parentId: string | null;
  scope: {
    projectIds: string[];
    capabilities: Capability[];
    mode: "observe" | "propose";
  };
  expiresAt: string;
  revoked: boolean;
  active: boolean;
  version: number;
};
export type Registry = { agents: Agent[] };
export type Issued = { agent: Agent; credential: string | null };
export type Day = {
  date: string;
  capacityMinutes: number;
  plannedMinutes: number;
  overloadMinutes: number;
};
export type Proposal = {
  id: string;
  agentId: string | null;
  agentName: string | null;
  principalId: string;
  orgId: string;
  status: "pending" | "reviewed" | "rejected" | "cancelled";
  version: number;
  contentHash: string;
  request: {
    assignmentId: string;
    expectedVersion: number;
    sourceRevision: number;
    personId: string;
    start: string;
    end: string;
    reason: string;
  };
  preview: {
    original: Assignment;
    proposed: Assignment;
    impacts: { personId: string; before: Day[]; after: Day[] }[];
    sourceFingerprint: string;
  };
  reviewNote: string;
};
export type Proposals = { proposals: Proposal[]; nextCursor: string | null };
