import { runBooleanExitModule, runConfigApply, runModule, runRepoScript, runUpdateReport } from "../command-runner.mjs";

export const executionAdapters = {
  module: runModule,
  repoScript: runRepoScript,
  updateReport: runUpdateReport,
  configApply: runConfigApply,
  booleanExitModule: runBooleanExitModule,
};
