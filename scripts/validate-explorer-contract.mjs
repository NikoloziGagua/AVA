const [{ EXPLORER_CAPABILITIES }, { capabilityIdsForTool }] =
  await Promise.all([
    import("../web/dist/explorer/registry.js"),
    import("../server/dist/explorer/registry.js"),
  ]);

const canonicalIds = new Set(
  EXPLORER_CAPABILITIES.map((capability) => capability.id),
);
const declaringCapabilities = new Map();

for (const capability of EXPLORER_CAPABILITIES) {
  for (const tool of capability.runtime?.toolNames ?? []) {
    const ids = declaringCapabilities.get(tool) ?? new Set();
    ids.add(capability.id);
    declaringCapabilities.set(tool, ids);
  }
}

const failures = [];
for (const [tool, declaredBy] of declaringCapabilities) {
  const emittedIds = capabilityIdsForTool(tool);
  if (!emittedIds.length) {
    failures.push(`${tool}: no task capability mapping`);
    continue;
  }
  for (const id of emittedIds) {
    if (!canonicalIds.has(id)) {
      failures.push(`${tool}: emits unknown Atlas capability ${id}`);
    }
  }
  if (!emittedIds.some((id) => declaredBy.has(id))) {
    failures.push(
      `${tool}: mapping [${emittedIds.join(", ")}] does not include a capability that declares the tool`,
    );
  }
}

if (failures.length) {
  throw new Error(
    `Explorer server/web capability contract failed:\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `Explorer contract valid: ${canonicalIds.size} capabilities, ` +
    `${declaringCapabilities.size} tool mappings.`,
);
