import { request } from "@/lib/http";
import type { Import, Provider } from "./model";
type Signed = { url: string; method: string; headers: Record<string, string> };
export async function uploadWorkbook(
  org: string,
  file: File,
  provider: Provider,
  consent: boolean,
  sourceId: string | null,
) {
  if (
    !/\.(csv|xlsx)$/i.test(file.name) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("Choose a CSV or XLSX file up to 10 MiB.");
  const contentType = /\.xlsx$/i.test(file.name)
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
  const base = `/api/organizations/${org}/files`;
  const reservation = await request<{ fileId: string; upload: Signed }>(base, {
    filename: file.name,
    contentType,
    sizeBytes: file.size,
  });
  const uploaded = await fetch(reservation.upload.url, {
    method: reservation.upload.method,
    headers: reservation.upload.headers,
    body: file,
    signal: AbortSignal.timeout(60000),
  });
  if (!uploaded.ok)
    throw new Error(
      "The private upload did not complete. Check storage connectivity and upload CORS, then retry.",
    );
  await request(`${base}/${reservation.fileId}/complete`, {});
  return request<Import>(`/api/organizations/${org}/imports`, {
    fileId: reservation.fileId,
    provider,
    consent,
    sourceId,
  });
}
export async function downloadFile(org: string, id: string) {
  const result = await request<{ download: Signed }>(
    `/api/organizations/${org}/files/${id}/download`,
    {},
  );
  const link = document.createElement("a");
  link.href = result.download.url;
  link.rel = "noopener";
  link.click();
}
