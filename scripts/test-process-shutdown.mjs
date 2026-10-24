import assert from "node:assert/strict";

// Check a successful process exit, not just release of its port after SIGTERM.
export async function verifyShutdown(child, timeoutMs = 10000) {
  assert.equal(
    child.exitCode,
    null,
    "Process exited before the shutdown check",
  );
  let timer;
  const exited = new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    timer = setTimeout(
      () => reject(Error("SIGTERM shutdown timed out")),
      timeoutMs,
    );
  });
  child.kill("SIGTERM");
  try {
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally {
    clearTimeout(timer);
  }
}
