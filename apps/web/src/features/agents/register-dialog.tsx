"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import type { Project } from "@/lib/model";
import type { Agent, Capability } from "./model";
export function RegisterDialog({
  projects,
  agents,
  busy,
  error,
  onSave,
  onClose,
}: {
  projects: Project[];
  agents: Agent[];
  busy: boolean;
  error: string;
  onSave: (body: object) => Promise<void>;
  onClose: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [mode, setMode] = useState<"observe" | "propose">("observe");
  const [capacity, setCapacity] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [parent, setParent] = useState("");
  const [days, setDays] = useState(7);
  const nameInput = useRef<HTMLInputElement>(null);
  const parentAgent = agents.find((a) => a.id === parent);
  const choices = projects.filter(
    (p) => !parentAgent || parentAgent.scope.projectIds.includes(p.id),
  );
  async function submit() {
    const caps: Capability[] =
      mode === "propose"
        ? ["readSchedule", "readCapacity", "proposeMove", "readProposal"]
        : capacity
          ? ["readSchedule", "readCapacity"]
          : ["readSchedule"];
    const expires = Math.min(
      Date.now() + days * 86400000,
      parentAgent ? Date.parse(parentAgent.expiresAt) : Infinity,
    );
    await onSave({
      kind: "register",
      id,
      name,
      purpose,
      parentId: parent || null,
      expiresAt: new Date(expires).toISOString(),
      scope: { projectIds: selected, capabilities: caps, mode },
    });
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="editor feature-composer"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            nameInput.current?.focus();
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.querySelector("form")?.requestSubmit();
            }
          }}
        >
          <div className="team-heading">
            <div>
              <Dialog.Title>Register agent</Dialog.Title>
              <Dialog.Description>
                Give an agent access to specific planning work.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="icon-button"
              disabled={busy}
              aria-label="Close"
            >
              <X size={17} />
            </Dialog.Close>
          </div>
          <form
            className="feature-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="feature-field">
              Name
              <input
                ref={nameInput}
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Weekly planning agent"
              />
            </label>
            <label className="feature-field">
              Purpose
              <textarea
                required
                maxLength={500}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Watch capacity and suggest changes after a delay"
              />
            </label>
            <div className="agent-property">
              <label htmlFor="agent-parent">Delegation</label>
              <select
                id="agent-parent"
                value={parent}
                onChange={(e) => {
                  const value = e.target.value;
                  setParent(value);
                  setSelected([]);
                  setMode("observe");
                  setCapacity(false);
                }}
              >
                <option value="">Direct workspace delegation</option>
                {agents
                  .filter((a) => a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="agent-property">
              <label htmlFor="agent-mode">Authority</label>
              <select
                id="agent-mode"
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as "observe" | "propose")
                }
              >
                <option value="observe">Read schedules</option>
                <option
                  value="propose"
                  disabled={
                    !!parentAgent &&
                    !parentAgent.scope.capabilities.includes("proposeMove")
                  }
                >
                  Read and propose moves
                </option>
              </select>
            </div>
            <div className="agent-property">
              <label htmlFor="agent-expiry">Expires after</label>
              <select
                id="agent-expiry"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[1, 7, 30, 90].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "day" : "days"}
                  </option>
                ))}
              </select>
            </div>
            {mode === "observe" &&
              (!parentAgent ||
                parentAgent.scope.capabilities.includes("readCapacity")) && (
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={capacity}
                    onChange={(e) => setCapacity(e.target.checked)}
                  />
                  Read aggregate capacity
                </label>
              )}
            {(capacity || mode === "propose") && (
              <p className="report-note">
                Capacity access includes total workload from other projects,
                without their names or notes.
              </p>
            )}
            <fieldset className="agent-projects">
              <legend>Projects</legend>
              {choices.length ? (
                choices.map((p) => (
                  <label className="agent-check" key={p.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, p.id]
                            : selected.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))
              ) : (
                <p className="report-note">
                  Add a project before registering an agent.
                </p>
              )}
            </fieldset>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="feature-actions">
              <button
                type="button"
                className="secondary"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy || !selected.length}>
                {busy ? "Registering…" : "Register agent"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
