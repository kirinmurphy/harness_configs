import { executionAdapters } from "./command-config/execution-adapters.mjs";
import { commandNodes } from "./command-node-lookup.mjs";

export async function executeCommand({ catalog, node, tokens, args }) {
  const { execution } = node;
  if (!execution?.adapter) throw new Error(`missing execution adapter: ${tokens.join(" ")}`);
  const adapter = executionAdapters[execution.adapter];
  if (!adapter) throw new Error(`unknown execution adapter: ${execution.adapter}`);
  return adapter({ catalog, node, tokens, args, execution });
}

export function validateExecutions({ catalog }) {
  const invalid = commandNodes({ nodes: catalog.nodes })
    .filter((node) => !executionAdapters[node.execution?.adapter])
    .map((node) => node.title || "(untitled)");
  if (invalid.length) throw new Error(`invalid CLI execution adapters: ${invalid.join(", ")}`);
}
