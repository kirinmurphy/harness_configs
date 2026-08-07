import { renderHelp } from "./help-renderer.mjs";
import { selectMenu, waitForAnyKey, waitForEnter } from "./skill-lib.mjs";
import { resolveInteractiveArgs } from "./interactive-args.mjs";
import { menuItems, menuTitle } from "./interactive-menu-items.mjs";
import { repoRoot } from "./paths.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAIN_PATH = path.join(repoRoot, "scripts", "cli", "main.mjs");

export async function runInteractiveMenu({ catalog, node = null, tokens = [], dispatchCommand }) {
  let notice = null;
  for (;;) {
    clearInteractiveScreen();
    const choice = await selectMenu(menuTitle(catalog, node, tokens, notice), menuItems(catalog, node, tokens));
    notice = null;
    if (choice === null || choice.action === "exit") return;
    if (choice.action === "back") return;
    if (choice.action === "help") {
      clearInteractiveScreen();
      console.log(renderHelp(catalog, node, tokens));
      console.log("");
      await waitForAnyKey("Press any key to return to menu");
      continue;
    }
    if (choice.action === "namespace") {
      clearInteractiveScreen();
      const result = await runInteractiveMenu({ catalog, node: choice.node, tokens: choice.tokens, dispatchCommand });
      if (result?.action === "returnToRoot") continue;
      continue;
    }
    if (choice.action === "command") {
      clearInteractiveScreen();
      const args = await resolveInteractiveArgs(choice.node);
      if (args === null) continue;
      const result = await runInteractiveCommand(choice.node, choice.tokens, [...(choice.node.interactiveArgs || []), ...args]);
      if (result?.notice) notice = result.notice;
      if (result?.action === "returnToRoot") {
        if (tokens.length === 0) continue;
        return result;
      }
      if (result?.action === "exit") return;
    }
  }
}

function clearInteractiveScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[H\x1b[J");
}

async function runInteractiveCommand(node, tokens, args) {
  const completion = node.onComplete || "returnToSubmenu";
  if (node.interactiveStdio) {
    const resultFile = path.join(os.tmpdir(), `roborepo-interactive-${process.pid}-${Date.now()}.json`);
    const result = await runInheritedInteractiveCommand(tokens, args, { resultFile });
    const childResult = readInteractiveResult(resultFile);
    if (result.status !== 0) {
      console.log(`command exited with ${result.status}`);
      await waitForContinue(node);
    }
    return {
      action: completion === "returnToMenu" ? "returnToRoot" : completion === "returnToSubmenu" ? "returnToSubmenu" : "exit",
      notice: childResult.notice || (node.noticeOnComplete !== false && result.status === 0 && completion !== "exit"
        ? { text: `${node.title || tokens.join(" ")} complete`, level: "success" }
        : null),
    };
  }
  if (completion === "exit") {
    await runDirectInteractiveCommand(tokens, args);
    return { action: "exit" };
  }

  clearInteractiveScreen();
  const result = await runWithSpinner({
    args: [...tokens, ...args],
    message: node.loadingMessage || `Running ${tokens.join(" ")}...`,
  });

  clearInteractiveScreen();
  const shortNotice = noticeForShortOutput(result, tokens);
  if (shortNotice) {
    return { action: completion === "returnToMenu" ? "returnToRoot" : "returnToSubmenu", notice: shortNotice };
  }
  await showCommandResult({ node, tokens, result });
  const notice = noticeForResult(result, tokens);
  if (completion === "returnToMenu") return { action: "returnToRoot", notice };
  return { action: "returnToSubmenu", notice };
}

async function showCommandResult({ node, tokens, result }) {
  const title = `${node.title || tokens.join(" ")} result`;
  process.stdout.write(`\x1b[1m${title}\x1b[0m\n\n`);
  if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  const stderr = cleanInteractiveStderr(result.stderr);
  if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
  if (result.status !== 0) process.stdout.write(`\ncommand exited with ${result.status}\n`);
  await waitForContinue(node);
}

async function waitForContinue(node) {
  const prompt = node.continuePrompt || "Press any key to return to menu";
  if (node.continueKey === "enter") return waitForEnter(prompt);
  return waitForAnyKey(prompt);
}

function cleanInteractiveStderr(stderr) {
  const lines = stderr.split(/\r?\n/);
  if (!lines.some((line) => /^\s+at\s/.test(line))) return stderr;
  return lines.filter((line) => line.trim() && !/^\s+at\s/.test(line)).join("\n");
}

async function runDirectInteractiveCommand(tokens, args) {
  const result = spawn(process.execPath, [MAIN_PATH, ...tokens, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  return new Promise((resolve) => result.on("exit", (status) => {
    process.exit(status ?? 1);
    resolve();
  }));
}

async function runInheritedInteractiveCommand(tokens, args, { resultFile } = {}) {
  const result = spawn(process.execPath, [MAIN_PATH, ...tokens, ...args], {
    cwd: process.cwd(),
    env: resultFile ? { ...process.env, ROBOREPO_INTERACTIVE_RESULT_FILE: resultFile } : process.env,
    stdio: "inherit",
  });
  return new Promise((resolve) => result.on("exit", (status) => {
    resolve({ status: status ?? 1 });
  }));
}

function readInteractiveResult(resultFile) {
  try {
    const text = fs.readFileSync(resultFile, "utf8");
    fs.rmSync(resultFile, { force: true });
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function runWithSpinner({ args, message }) {
  const child = spawn(process.execPath, [MAIN_PATH, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const frames = ["-", "\\", "|", "/"];
  let frame = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r\x1b[2K${frames[frame % frames.length]} ${message}`);
    frame += 1;
  }, 120);
  process.stdout.write(`${frames[0]} ${message}`);

  return new Promise((resolve) => {
    child.on("exit", (status) => {
      clearInterval(timer);
      process.stdout.write("\r\x1b[2K");
      resolve({ status: status ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearInterval(timer);
      process.stdout.write("\r\x1b[2K");
      resolve({ status: 1, stdout, stderr: `${stderr}${err.message}\n` });
    });
  });
}

function noticeForShortOutput(result, tokens) {
  if (result.status !== 0 || result.stderr.trim()) return null;
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { text: `${tokens.join(" ")} completed`, level: "success" };
  if (lines.length > 2) return null;
  return { text: lines.join("  "), level: "success" };
}

function noticeForResult(result, tokens) {
  if (result.status !== 0) return { text: `${tokens.join(" ")} failed (${result.status})`, level: "error" };
  if (result.stderr.trim()) return { text: `${tokens.join(" ")} completed with warnings`, level: "warning" };
  return { text: `${tokens.join(" ")} completed`, level: "success" };
}
