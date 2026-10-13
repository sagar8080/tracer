"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { today } from "@/lib/scheduling";
export function LeaveDialog({
  timezone,
  onClose,
  onSave,
  busy,
  error,
}: {
  timezone?: string;
  onClose: () => void;
  onSave: (body: object) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const titleInput = useRef<HTMLInputElement>(null);
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(""),
    [start, setStart] = useState(today(timezone)),
    [end, setEnd] = useState(today(timezone)),
    [duration, setDuration] = useState("");
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
            titleInput.current?.focus();
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
              <Dialog.Title>Request time off</Dialog.Title>
              <Dialog.Description>
                Your administrator will review this request before it changes
                capacity.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="icon-button"
              disabled={busy}
              aria-label="Close leave request"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <form
            className="feature-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave({
                kind: "request",
                id,
                title,
                start,
                end,
                dailyMinutes: duration
                  ? Math.round(Number(duration) * 60)
                  : null,
              });
            }}
          >
            <label>
              Title
              <input
                ref={titleInput}
                value={title}
                maxLength={100}
                required
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              From
              <input
                type="date"
                value={start}
                required
                onChange={(e) => {
                  setStart(e.target.value);
                  if (e.target.value > end) setEnd(e.target.value);
                }}
                disabled={busy}
              />
            </label>
            <label>
              To
              <input
                type="date"
                min={start}
                value={end}
                required
                onChange={(e) => setEnd(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Hours off per day
              <input
                type="number"
                min={0.25}
                max={24}
                step={0.25}
                placeholder="Leave empty for full days"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
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
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Requesting…" : "Send request"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
