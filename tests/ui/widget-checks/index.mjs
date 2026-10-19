// Loads every per-widget check module in this folder, so a widget unit only adds its own file.
// A module exports `id` and optionally:
//   prepare(state, { now })  mutates the synthetic /api/state fixture so the widget has content;
//   selectors                extra meaningful-descendant selectors for the clipping check;
//   family({ page, widget, size, density, viewport, state })  per-family assertions;
//   sweep({ page, viewport, state, base, now })  once per viewport after the family sweep, for checks
//                            beyond the families (for example custom spans); may return a summary line.
// A module whose `id` is not a widget id only contributes its sweep.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(directory).filter(file => file.endsWith('.mjs') && file !== 'index.mjs').sort();
const modules = await Promise.all(files.map(file => import(pathToFileURL(join(directory, file)).href)));

/** @type {Record<string, { id: string, prepare?: Function, selectors?: string[], family?: Function, sweep?: Function }>} */
export const WIDGET_CHECKS = Object.fromEntries(modules.map(module => [module.id, module]));
