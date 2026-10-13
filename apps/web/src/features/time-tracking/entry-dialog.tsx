"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { Project } from "@/lib/model";
import { addDays } from "@/lib/scheduling";
import type { Entry } from "./model";
export function EntryDialog({
  entry,
  week,
  projects,
  onClose,
  onSave,
  busy,
  error,
}: {
  entry?: Entry;
  week: string;
  projects: Project[];
  onClose: () => void;
  onSave: (body: object) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const projectInput = useRef<HTMLSelectElement>(null);
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [project, setProject] = useState(
    entry?.projectId ?? projects[0]?.id ?? "",
  );
  const [date, setDate] = useState(entry?.date ?? week);
  const [duration, setDuration] = useState((entry?.minutes ?? 60) / 60);
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [note, setNote] = useState(entry?.note ?? "");
  async function submit() {
    await onSave({
      kind: "save",
      id,
      date,
      projectId: project,
      minutes: Math.round(duration * 60),
      billable,
      note,
      version: (entry?.version ?? 0) + 1,
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
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            projectInput.current?.focus();
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
              <Dialog.Title>{entry ? "Edit time" : "Record time"}</Dialog.Title>
              <Dialog.Description>
                Record the work you did on a project.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="icon-button"
              disabled={busy}
              aria-label="Close time entry"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="feature-form"
          >
            <label>
              Project
              <select
                ref={projectInput}
                value={project}
                onChange={(e) => setProject(e.target.value)}
                required
                disabled={busy}
              >
                <option value="" disabled>
                  Choose a project
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                min={week}
                max={addDays(week, 6)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label>
              Hours
              <input
                type="number"
                min={1 / 60}
                max={24}
                step="any"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                required
                disabled={busy}
              />
            </label>
            <label className="feature-check">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                disabled={busy}
              />
              Billable time
            </label>
            <label>
              Note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={busy}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="feature-actions">
              <button
                type="button"
                className="text-button"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy || !project}>
                {busy ? "Saving…" : "Save time"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
