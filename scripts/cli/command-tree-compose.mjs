export function composeCommandNodes({ definitions, executionPresets }) {
  const nodes = {};
  for (const definition of [...definitions].sort((a, b) => (a.path || []).length - (b.path || []).length)) {
    insertDefinition({ nodes, definition, executionPresets });
  }
  return nodes;
}

function insertDefinition({ nodes, definition, executionPresets }) {
  const path = definition.path || [];
  if (path.length === 0) throw new Error(`command definition missing path: ${definition.title || "(untitled)"}`);
  const key = path.at(-1);
  const parent = ensureParent({ nodes, path: path.slice(0, -1) });
  if (parent[key]) throw new Error(`duplicate CLI definition: ${path.join(" ")}`);
  parent[key] = normalizeDefinition({ definition, executionPresets });
}

function ensureParent({ nodes, path }) {
  return path.reduce((children, token) => {
    if (!children[token]) throw new Error(`missing namespace definition for: ${token}`);
    children[token].children ||= {};
    return children[token].children;
  }, nodes);
}

function normalizeDefinition({ definition, executionPresets }) {
  const { path: _path, children: _children, ...node } = definition;
  return {
    ...node,
    ...(node.execution ? { execution: expandExecution({ execution: node.execution, executionPresets }) } : {}),
  };
}

function expandExecution({ execution, executionPresets }) {
  if (!execution.preset) return execution;
  return { ...executionPresets[execution.preset], ...execution };
}
