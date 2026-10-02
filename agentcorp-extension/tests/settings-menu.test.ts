import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { SettingsControls, SettingsMenu } from "../src/settings-menu";

const props = {
  preferences: { motion: "system" as const, autoOpen: true, chatBubbles: true },
  dark: true, reduced: false, saving: false, error: "", onSave: () => {},
};

test("settings renders exactly the four requested labeled toggles with effective values", () => {
  const html = renderToStaticMarkup(createElement(SettingsControls, props));
  const labels = [...html.matchAll(/<label><span>([^<]+)<\/span>(<input[^>]+>)/g)];
  assert.deepEqual(labels.map(match => match[1]), ["Dark Mode", "Reduced Motion", "Auto Start", "Chat Bubbles"]);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 4);
  assert.deepEqual(labels.map(match => match[2].includes("checked")), [true, false, true, true]);
  assert.doesNotMatch(html, /<select|<option|Office motion/);
});

test("unknown load and pending save states disable controls rather than overwriting unknown values", () => {
  const unknown = renderToStaticMarkup(createElement(SettingsControls, { ...props, preferences: null, error: "Read failed" }));
  assert.equal((unknown.match(/disabled=""/g) ?? []).length, 4);
  assert.match(unknown, /role="alert">Read failed/);
  assert.doesNotMatch(unknown, /Loading saved settings/);
  const loading = renderToStaticMarkup(createElement(SettingsControls, { ...props, preferences: null }));
  assert.match(loading, /Loading saved settings/);
  const saving = renderToStaticMarkup(createElement(SettingsControls, { ...props, saving: true }));
  assert.equal((saving.match(/disabled=""/g) ?? []).length, 4);
  assert.match(saving, /role="status">Saving preference/);
});

test("gear menu exposes expansion/dialog semantics and replaces the old header/sidebar controls", async () => {
  const html = renderToStaticMarkup(createElement(SettingsMenu, { ...props, open: false, onOpenChange: () => {} }));
  assert.match(html, /aria-label="Office settings"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="office-settings"/);
  assert.match(html, /<svg/);
  const office = await readFile(new URL("../src/observe.tsx", import.meta.url), "utf8");
  assert.equal((office.match(/<SettingsMenu /g) ?? []).length, 1);
  assert.doesNotMatch(office, /<select|className="motion-control"|className="auto-open-control"|onClick=\{toggleTheme\}/);
  assert.doesNotMatch(office, /<strong>Office preferences<\/strong>|Open automatically in new sessions/);
  const css = await readFile(new URL("../live.css", import.meta.url), "utf8");
  assert.match(css, /\.live-shell,\s*\.office-settings-popover\s*\{/);
  assert.match(css, /:root\[data-office-theme="dark"\] \.office-settings-popover\s*\{/);
});
