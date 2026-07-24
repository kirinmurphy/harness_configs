import { renderHelp } from "./help-renderer.mjs";
import { selectMenu } from "./skill-lib.mjs";
import { resolveInteractiveArgs } from "./interactive-args.mjs";
import { menuItems, menuTitle } from "./interactive-menu-items.mjs";

export async function runInteractiveMenu({ catalog, node = null, tokens = [], dispatchCommand }) {
  for (;;) {
    const choice = await selectMenu(menuTitle(catalog, node, tokens), menuItems(catalog, node, tokens));
    if (choice === null || choice.action === "exit") return;
    if (choice.action === "back") return;
    if (choice.action === "help") {
      console.log("");
      console.log(renderHelp(catalog, node, tokens));
      console.log("");
      continue;
    }
    if (choice.action === "namespace") {
      await runInteractiveMenu({ catalog, node: choice.node, tokens: choice.tokens, dispatchCommand });
      continue;
    }
    if (choice.action === "command") {
      const args = await resolveInteractiveArgs(choice.node);
      if (args === null) continue;
      await dispatchCommand(choice.node, choice.tokens, [...(choice.node.interactiveArgs || []), ...args]);
    }
  }
}
