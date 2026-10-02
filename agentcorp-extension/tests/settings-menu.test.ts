import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { SettingsControls, SettingsMenu, SettingsPopover, settingsPosition } from "../src/settings-menu";

const props = {
  preferences: { motion: "system" as const, autoOpen: true, chatBubbles: true },
  dark: true, reduced: false, saving: false, error: "", onSave: () => {},
};

test("settings renders exactly the four requested labeled toggles with effective values", () => {
  const html = renderToStaticMarkup(createElement(SettingsControls, props));
  const labels = [...html.matchAll(/<label\b[^>]*><span class="settings-switch-label">([^<]+)<\/span>.*?(<input[^>]+>).*?<\/label>/g)];
  assert.deepEqual(labels.map(match => match[1]), ["Dark Mode", "Reduced Motion", "Auto Start", "Chat Bubbles"]);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 4);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 4);
  assert.equal((html.match(/class="settings-switch-track" aria-hidden="true"/g) ?? []).length, 4);
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
  assert.doesNotMatch(html, /transform=/);
  const points = [...html.matchAll(/points="([^"]+)"/g)][0][1].split(" ").map(pair => pair.split(",").map(Number));
  for (const axis of [0, 1]) assert.equal((Math.min(...points.map(p => p[axis])) + Math.max(...points.map(p => p[axis]))) / 2, 12);
});

test("switch content carries effective motion state in both themes and the popover fits narrow viewports", () => {
  for (const dark of [false, true]) for (const reduced of [false, true]) {
    const html = renderToStaticMarkup(createElement(SettingsPopover, {
      dark, reduced, children: createElement(SettingsControls, { ...props, dark, reduced }),
    }));
    assert.match(html, new RegExp(`data-reduced-motion="${reduced}"`));
    assert.match(html, new RegExp(`data-office-theme="${dark ? "dark" : "light"}"`));
  }
  for (const width of [320, 380, 1024]) {
    const panel = { width: Math.min(280, width - 16), height: 280 };
    for (const anchor of [{ right: 40, bottom: 40 }, { right: width - 10, bottom: 580 }]) {
      const position = settingsPosition(anchor, panel, { width, height: 600 });
      assert.ok(position.left >= 8 && position.left + panel.width <= width - 8);
      assert.ok(position.top >= 8 && position.top + panel.height <= 592);
    }
  }
});
