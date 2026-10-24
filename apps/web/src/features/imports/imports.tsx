"use client";
import { useState } from "react";
import { ArrowRight, FileSpreadsheet, Upload } from "lucide-react";
import type { WorkspaceData } from "@/lib/model";
import { useResource } from "@/lib/use-resource";
import { permissions } from "@/features/tenancy/permissions";
import { uploadWorkbook } from "./storage";
import { ImportDetails } from "./import-details";
import { providerNames } from "./model";
import type { Provider, Registry } from "./model";
import "./imports.css";
export function Imports({
  orgId,
  data,
  onChanged,
}: {
  orgId: string;
  data: WorkspaceData;
  onChanged: () => Promise<void>;
}) {
  const revision = data.access.find((a) => a.orgId === orgId)?.revision ?? 0;
  const resource = useResource<Registry>(
    `/api/organizations/${orgId}/imports`,
    revision,
  );
  const access = permissions(data, orgId, true);
  const [selected, setSelected] = useState<string | null>(null),
    [source, setSource] = useState<string | null>(null),
    [provider, setProvider] = useState<Provider>("manual"),
    [consent, setConsent] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const item = await uploadWorkbook(orgId, file, provider, consent, source);
      setFile(null);
      setSelected(item.id);
      setSource(null);
      await resource.refresh();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload did not finish");
    } finally {
      setBusy(false);
    }
  }
  if (selected)
    return (
      <ImportDetails
        key={`${orgId}:${selected}`}
        id={selected}
        orgId={orgId}
        data={data}
        administer={access.administer}
        onChanged={onChanged}
        onBack={() => {
          setSelected(null);
          void resource.refresh().catch(() => {});
        }}
        onRefresh={(id) => {
          setSource(id);
          setSelected(null);
          setFile(null);
          setError("");
        }}
      />
    );
  return (
    <div className="imports">
      <div className="feature-subheading">
        <div>
          <h2>Bring your plan into Kivo</h2>
          <span>
            Review a spreadsheet, reconcile your team’s capacity, and publish a
            shared schedule.
          </span>
        </div>
      </div>
      {(error || resource.error) && (
        <p className="error" role="alert">
          {error || resource.error}
        </p>
      )}
      <form
        className="import-upload"
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <label className="import-drop">
          <FileSpreadsheet size={26} strokeWidth={1.25} />
          <span>{file ? file.name : "Choose a workbook"}</span>
          <small>CSV or XLSX · up to 10 MiB</small>
          <input
            aria-label="Workbook file"
            type="file"
            accept=".csv,.xlsx"
            required
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="import-upload-options">
          <label>
            Source
            <select
              value={source ?? ""}
              disabled={busy}
              onChange={(e) => setSource(e.target.value || null)}
            >
              <option value="">New plan source</option>
              {Array.from(
                new Map(
                  resource.data?.imports
                    .filter((i) => i.status === "published")
                    .map((i) => [i.sourceId, i]) ?? [],
                ).values(),
              ).map((i) => (
                <option key={i.sourceId} value={i.sourceId}>
                  Refresh · {i.filename}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mapping assistance
            <select
              value={provider}
              disabled={busy}
              onChange={(e) => {
                setProvider(e.target.value as Provider);
                setConsent(false);
              }}
            >
              {(resource.data?.providers ?? ["manual"]).map((p) => (
                <option value={p} key={p}>
                  {providerNames[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {provider !== "manual" && (
          <label className="import-check">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Send worksheet headers and up to three sample rows per sheet to{" "}
            {providerNames[provider]} for mapping suggestions. The original file
            stays in private storage.
          </label>
        )}
        <div className="import-footer">
          <span>
            Allocation rows or weekly hours. Your schedule changes only after
            review.
          </span>
          <button
            className="primary"
            disabled={
              busy ||
              !file ||
              !resource.data ||
              (provider !== "manual" && !consent)
            }
          >
            <Upload size={14} />
            {busy
              ? "Uploading…"
              : source
                ? "Review refreshed file"
                : "Review workbook"}
          </button>
        </div>
      </form>
      <details className="import-format">
        <summary>See supported workbook formats</summary>
        <p>
          Allocation rows use Person, Project, Start, End and Effort columns.
          Weekly matrices use Person, Project and dated Monday columns
          containing total hours. Use YYYY-MM-DD dates, unique names and
          quarter-hour effort. A stable row ID column helps track allocations
          when dates change. Macros and merged cells need a values-only,
          unmerged copy.
        </p>
        <a href="/import-examples/allocations.csv" download>
          Allocation example
        </a>
        <a href="/import-examples/weekly.csv" download>
          Weekly example
        </a>
      </details>
      <div className="feature-subheading">
        <div>
          <h2>Saved imports</h2>
          <span>
            Staged work survives a closed tab. Refresh a published source to
            compare another file.
          </span>
        </div>
      </div>
      <div className="import-history">
        {resource.data?.imports.map((item) => (
          <button
            className="import-history-row"
            key={item.id}
            onClick={() => setSelected(item.id)}
          >
            <FileSpreadsheet size={16} />
            <span>
              <strong>{item.filename}</strong>
              <small>
                Source version {item.sourceVersion} ·{" "}
                {providerNames[item.provider]}
              </small>
            </span>
            <span className="import-status">{item.status}</span>
            <ArrowRight size={14} />
          </button>
        ))}
        {resource.data && !resource.data.imports.length && (
          <p className="muted">Your first workbook will appear here.</p>
        )}
      </div>
    </div>
  );
}
