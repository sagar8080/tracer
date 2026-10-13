export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
// Retrying uses the original key and body. The server authorizes each attempt
// and atomically matches the receipt before allowing a repeated mutation.
export async function request<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const key = body !== undefined ? crypto.randomUUID() : undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new ApiError(
          result.error ?? "The request could not be completed",
          response.status,
        );
      }
      return response.status === 204 ? (null as T) : await response.json();
    } catch (e) {
      if (attempt === 0 && (!(e instanceof ApiError) || e.status === 503))
        continue;
      throw e;
    }
  }
}
