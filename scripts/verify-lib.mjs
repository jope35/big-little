// Shared agent-shape assertions for scripts/verify-fixture.sh.
// Mirrors src/index.ts BULK_READER_PERMISSIONS / CODE_WRITER_PERMISSIONS.
// strict=true (Docker clean room): exact match on every field.
// strict=false (host run): presence + mode + permission subset, because global
// file-based agents may override scalar fields (system, request.body).

const BULK_READER_PERMISSIONS = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "webfetch", resource: "*", effect: "allow" },
  { action: "websearch", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
  { action: "shell", resource: "*", effect: "deny" },
  { action: "shell", resource: "ls *", effect: "allow" },
  { action: "shell", resource: "git log *", effect: "allow" },
  { action: "shell", resource: "git status *", effect: "allow" },
  { action: "shell", resource: "git diff *", effect: "allow" },
  { action: "shell", resource: "grep *", effect: "allow" },
  { action: "shell", resource: "rg *", effect: "allow" },
  { action: "shell", resource: "wc *", effect: "allow" },
];

const CODE_WRITER_PERMISSIONS = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "shell", resource: "*", effect: "deny" },
  { action: "webfetch", resource: "*", effect: "deny" },
  { action: "websearch", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
];

function hasPerm(perms, action, resource, effect) {
  return perms.some((p) => p.action === action && p.resource === resource && p.effect === effect);
}

export function checkAgents(agents, { strict }) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const br = byId.get("bulk-reader");
  const cw = byId.get("code-writer");
  if (!br) throw new Error("bulk-reader missing (plugin upsert did not materialize it)");
  if (!cw) throw new Error("code-writer missing (plugin upsert did not materialize it)");
  if (br.mode !== "subagent") throw new Error("bulk-reader mode is not subagent");
  if (cw.mode !== "subagent") throw new Error("code-writer mode is not subagent");

  const required = [
    [br, "shell", "*", "deny"],
    [br, "shell", "ls *", "allow"],
    [br, "shell", "git log *", "allow"],
    [br, "shell", "git status *", "allow"],
    [br, "shell", "git diff *", "allow"],
    [br, "shell", "grep *", "allow"],
    [br, "shell", "rg *", "allow"],
    [br, "shell", "wc *", "allow"],
    [br, "read", "*", "allow"],
    [br, "edit", "*", "deny"],
    [br, "subagent", "*", "deny"],
    [cw, "edit", "*", "allow"],
    [cw, "shell", "*", "deny"],
    [cw, "webfetch", "*", "deny"],
    [cw, "websearch", "*", "deny"],
    [cw, "subagent", "*", "deny"],
  ];
  for (const [agent, action, resource, effect] of required) {
    if (!hasPerm(agent.permissions ?? [], action, resource, effect)) {
      throw new Error(`${agent.id} lacks ${action} ${resource} -> ${effect}`);
    }
  }
  const noRemovedActions = (agent) => {
    const actions = new Set((agent.permissions ?? []).map((p) => p.action));
    for (const bad of ["bash", "task", "list"]) {
      if (actions.has(bad)) throw new Error(`${agent.id} has removed action ${bad}`);
    }
  };
  noRemovedActions(br);
  noRemovedActions(cw);

  if (strict) {
    const eq = (a, b, what) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} mismatch: ${JSON.stringify(a)}`);
    };
    eq(br.permissions, BULK_READER_PERMISSIONS, "bulk-reader permissions");
    eq(cw.permissions, CODE_WRITER_PERMISSIONS, "code-writer permissions");
    if (!br.system?.includes("Shell:")) throw new Error("bulk-reader system must say Shell (V2 tool)");
    if (br.system?.includes("Bash:")) throw new Error("bulk-reader system must not say Bash (old tool name)");
    if (Object.keys(br.request?.body ?? {}).length !== 0) {
      throw new Error("bulk-reader request.body must be empty (temperature dropped)");
    }
    if (Object.keys(cw.request?.body ?? {}).length !== 0) {
      throw new Error("code-writer request.body must be empty (temperature dropped)");
    }
    if ("model" in br) throw new Error("bulk-reader model must be absent when unset");
    if ("model" in cw) throw new Error("code-writer model must be absent when unset");
  }
}
