// Реестр команд: используется горячими клавишами, командной палитрой и голосом.
import { t } from '../core/i18n.js';

const commands = new Map();

/**
 * cmd = { id, title: () => string | string, category, keys?: string, run: () => void, hidden?: boolean }
 */
export function registerCommand(cmd) {
  commands.set(cmd.id, cmd);
  return cmd;
}

export function registerCommands(list) {
  list.forEach(registerCommand);
}

export function getCommands() {
  return Array.from(commands.values()).filter((c) => !c.hidden);
}

export function runCommand(id, ...args) {
  const cmd = commands.get(id);
  if (!cmd) return false;
  try {
    cmd.run(...args);
  } catch (err) {
    console.error(`command ${id} failed`, err);
  }
  return true;
}

export function commandTitle(cmd) {
  return typeof cmd.title === 'function' ? cmd.title() : t(cmd.title);
}

export function commandCategory(cmd) {
  return cmd.category ? t(`cat.${cmd.category}`) : '';
}
