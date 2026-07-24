export function findNode({ nodes, path }) {
  return path.reduce(({ current, tokens }, token) => {
    const node = current[token];
    if (!node) throw new Error(`configured command path not found: ${path.join(" ")}`);
    return { current: node.children || {}, node, tokens: [...tokens, token] };
  }, { current: nodes, node: null, tokens: [] });
}

export function commandNodes({ nodes }) {
  return Object.values(nodes || {}).flatMap((node) => [
    ...(node.execution ? [node] : []),
    ...commandNodes({ nodes: node.children }),
  ]);
}
