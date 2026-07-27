import { argvStrategies } from "./command-config/argv-strategies.mjs";

export function buildCallArgs({ tokens, args, execution }) {
  const routedArgs = args.slice(execution.stripLeadingArgs || 0);
  const argv = [...(execution.prependArgs || []), ...routedArgs];
  const strategy = argvStrategies[execution.argv || "array"];
  if (!strategy) throw new Error(`unknown argv strategy: ${execution.argv}`);
  return strategy({ argv, args: routedArgs, tokens, execution });
}
