export const argvStrategies = {
  array: ({ argv }) => [argv],
  set: ({ argv, tokens, execution }) => [new Set(argv), execution.commandName || tokens.join(" ")],
  object: ({ argv, execution }) => [objectArgs({ argv, objectFlags: execution.objectFlags || [] })],
  tokensTail: ({ args, tokens, execution }) => [[...tokens.slice(execution.tailFrom || 0), ...args]],
  argsAndOptions: ({ argv, execution }) => [argv, execution.options || {}],
};

function objectArgs({ argv, objectFlags }) {
  return Object.fromEntries(objectFlags.map((flag) => [flag.name, argv.includes(flag.arg)]));
}
