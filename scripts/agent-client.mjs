// Minimal external MCP client. Secrets stay in the process environment.
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = new URL(process.env.KIVO_AGENT_API_URL ?? "http://127.0.0.1:4000");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
if (
  (base.protocol !== "https:" && !(base.protocol === "http:" && local)) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== "/"
) {
  throw new Error(
    "Use an HTTPS API origin, or HTTP on loopback for development",
  );
}
const org = process.env.KIVO_AGENT_ORG_ID;
const credential = process.env.KIVO_AGENT_CREDENTIAL;
const start = process.env.KIVO_AGENT_START;
const end = process.env.KIVO_AGENT_END;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (
  !uuid.test(org ?? "") ||
  !credential?.startsWith("kivo_agent_") ||
  !/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") ||
  !/^\d{4}-\d{2}-\d{2}$/.test(end ?? "")
) {
  throw new Error(
    "Set KIVO_AGENT_ORG_ID, KIVO_AGENT_CREDENTIAL, KIVO_AGENT_START and KIVO_AGENT_END",
  );
}

async function run() {
  const response = await fetch(new URL("/v1/agent-sessions", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Credential exchange failed (${response.status})`);
  const session = await response.json();
  const client = new Client({ name: "kivo-example", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`/v1/organizations/${org}/mcp`, base),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          },
        },
      ),
    );
    const catalog = await client.listTools();
    console.log(
      "Granted tools:",
      catalog.tools.map((tool) => tool.name).join(", "),
    );
    const result = await client.callTool({
      name: "kivo_schedule",
      arguments: { start, end },
    });
    if (result.isError)
      throw new Error(
        "Schedule query was rejected; check the delegation and date window",
      );
    const schedule = result.structuredContent;
    if (!schedule || !Array.isArray(schedule.assignments))
      throw new Error("Invalid schedule response");
    // Print counts only; workload content is private business data.
    console.log(
      `Revision ${schedule.revision}: ${schedule.people.length} people, ${schedule.assignments.length} assignments; another page: ${Boolean(schedule.nextCursor)}`,
    );

    // Optional explicitly supplied proposal; this never applies a live change.
    const move = process.env.KIVO_AGENT_MOVE_JSON;
    if (move) {
      const request = JSON.parse(move);
      const id = process.env.KIVO_AGENT_PROPOSAL_ID ?? randomUUID();
      if (!uuid.test(id))
        throw new Error("KIVO_AGENT_PROPOSAL_ID must be a UUID");
      const proposal = await client.callTool({
        name: "kivo_propose_move",
        arguments: { id, request },
      });
      if (proposal.isError)
        throw new Error(
          "Proposal rejected; fetch current versions and check scope",
        );
      console.log(
        `Proposal ${proposal.structuredContent.id}: ${proposal.structuredContent.status}`,
      );
    }
  } finally {
    await client.close();
  }
}
run().catch((error) => {
  // Avoid transport error objects, which can contain credentials or requests.
  console.error(
    error instanceof SyntaxError
      ? "Invalid proposal JSON"
      : "Agent client failed; check configuration, access and API availability",
  );
  process.exitCode = 1;
});
