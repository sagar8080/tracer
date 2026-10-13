"use client";
import { useState } from "react";
import type { Person } from "@/lib/model";
import { request } from "@/lib/http";
export function MemberEnrollment({
  orgId,
  userId,
  version,
  email,
  personId,
  people,
  linkedIds,
  onChanged,
}: {
  orgId: string;
  userId: string;
  version: number;
  email: string;
  personId: string | null;
  people: Person[];
  linkedIds: Set<string>;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create");
  const [name, setName] = useState("");
  const [hours, setHours] = useState(8);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const person = people.find((p) => p.id === personId);
  async function save(unlink = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/organizations/${orgId}/enrollment`, {
        userId,
        membershipVersion: version,
        enrollment: unlink
          ? { kind: "unlink" }
          : mode === "create"
            ? {
                kind: "create",
                profile: { name: name.trim(), dailyMinutes: hours * 60 },
              }
            : { kind: "link", personId: mode },
      });
      await onChanged();
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update scheduling profile",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="member-enrollment">
      <div className="enrollment-summary">
        <span>
          {personId
            ? `On schedule · ${person?.name ?? "Linked profile"}`
            : "Not on the schedule"}
        </span>
        <button
          className="text-button"
          disabled={busy}
          aria-expanded={open}
          aria-label={`${personId ? "Manage scheduling profile" : "Add to schedule"} for ${email}`}
          onClick={() => setOpen(!open)}
        >
          {personId ? "Manage" : "Add to schedule"}
        </button>
      </div>
      {open &&
        (personId ? (
          <div className="enrollment-form">
            <p>
              Unlinking keeps this person’s schedule and workspace access
              intact.
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Unlink profile
            </button>
          </div>
        ) : (
          <form
            className="enrollment-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              Scheduling profile
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={busy}
              >
                <option value="create">Create a new person</option>
                {people
                  .filter((p) => !linkedIds.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {mode === "create" && (
              <>
                <label>
                  Name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  Hours per weekday
                  <input
                    type="number"
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                    min={1}
                    max={24}
                    step={0.25}
                    required
                    disabled={busy}
                  />
                </label>
              </>
            )}
            <div className="enrollment-actions">
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : mode === "create"
                    ? "Add to schedule"
                    : "Link person"}
              </button>
            </div>
          </form>
        ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
