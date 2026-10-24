import assert from "node:assert/strict";
import test from "node:test";
import { apiOrigin } from "./api-origin";

test("API tokens require HTTPS, loopback or the exact configured private origin", () => {
  assert.equal(
    apiOrigin("https://api.example.com").origin,
    "https://api.example.com",
  );
  assert.equal(apiOrigin("http://127.0.0.1:4000").port, "4000");
  assert.equal(apiOrigin("http://api:4000", "http://api:4000").hostname, "api");
  for (const [url, trusted] of [
    ["http://api:4000", undefined],
    ["http://other:4000", "http://api:4000"],
    ["https://user:password@api.example.com", undefined],
    ["https://api.example.com/v1", undefined],
    ["https://api.example.com?host=elsewhere", undefined],
    ["https://api.example.com#fragment", undefined],
    ["ftp://api:4000", "ftp://api:4000"],
  ])
    assert.throws(() => apiOrigin(url!, trusted));
});
