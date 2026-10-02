import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import postcss from "postcss";

const canonical = (selector: string) => selector.replace(/["']/g, "").replace(/::(before|after)/g, ":$1")
  .replace(/\s+/g, " ").replace(/\s*([+>~])\s*/g, "$1").trim();
function declarations(css: string, selector: string) {
  const values: Record<string, string> = {};
  postcss.parse(css).walkRules(rule => {
    if (!rule.selectors.some(candidate => canonical(candidate) === canonical(selector))) return;
    rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
  });
  return values;
}
function resolveColor(value: string, variables: Record<string, string>): string {
  const variable = value.match(/^var\((--[\w-]+),\s*(#[\da-f]+)\)$/i);
  if (variable) return resolveColor(variables[variable[1]] ?? variable[2], variables);
  assert.match(value, /^#[\da-f]{3}$|^#[\da-f]{6}$/i, `Expected an opaque color, not ${value}`);
  return value;
}
function luminance(color: string) {
  const hex = color.length === 4 ? color.slice(1).split("").map(digit => digit + digit).join("") : color.slice(1);
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  return (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
}

const source = (await Promise.all(["app/styles.css", "live.css", "observe.css"].map(path =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8")))).join("\n");
const html = await readFile(new URL("../../.github/extensions/agentcorp-extension/viewer/observe.html", import.meta.url), "utf8");
const cssPath = html.match(/href="(\/assets\/[^"]+\.css)"/)![1];
const packaged = await readFile(new URL(`../../.github/extensions/agentcorp-extension/viewer${cssPath}`, import.meta.url), "utf8");

for (const [name, css] of [["source import order", source], ["actual packaged stylesheet", packaged]]) {
  test(`${name}: opaque panel and measured text/boundary/focus contrast in both office themes`, () => {
    const panel = declarations(css, ".office-settings-popover");
    assert.equal(panel.position, "fixed");
    assert.ok(panel["max-height"].includes("100dvh"));
    assert.ok(panel.width.includes("100vw"));
    assert.equal(panel["overflow-y"], "auto");
    const local = declarations(css, ".office-settings-popover .settings-popover-content");
    // Repeat without inherited/local custom properties: critical colors must still resolve, not inherit app purple.
    for (const variables of [local, {}]) {
      const background = resolveColor(panel.background, variables);
      const row = declarations(css, ".office-settings-popover .settings-switch-row");
      const foreground = resolveColor(row.color, variables);
      const hover = resolveColor(declarations(css, ".office-settings-popover .settings-switch-row:hover").background, variables);
      const helper = resolveColor(declarations(css, ".office-settings-popover p").color, variables);
      const disabled = resolveColor(declarations(css, '.office-settings-popover .settings-switch-row[data-disabled="true"]').color, variables);
      const error = resolveColor(declarations(css, '.office-settings-popover [role="alert"]').color, variables);
      for (const text of [foreground, helper, disabled, error]) {
        for (const surface of [background, hover]) assert.ok(contrast(text, surface) >= 4.5, `${text} on ${surface}: ${contrast(text, surface)}`);
      }
      const border = resolveColor(panel.border.split(" ").at(-1)!, variables);
      for (const theme of ["light", "dark"]) {
        const outside = declarations(css, theme === "dark" ? ':root[data-office-theme="dark"]' : ":root")["--office-canvas-bg"];
        assert.ok(contrast(border, outside) >= 3, `Panel boundary in ${theme}`);
        assert.ok(contrast(border, background) >= 3);
      }
      const track = declarations(css, ".office-settings-popover .settings-switch-track");
      const off = resolveColor(track.background, variables);
      const on = resolveColor(declarations(css, ".office-settings-popover .settings-switch-input:checked + .settings-switch-track").background, variables);
      const offThumb = resolveColor(declarations(css, ".office-settings-popover .settings-switch-track::after").background, variables);
      const onThumb = resolveColor(declarations(css, ".office-settings-popover .settings-switch-input:checked + .settings-switch-track::after").background, variables);
      assert.ok(contrast(offThumb, off) >= 3);
      assert.ok(contrast(onThumb, on) >= 3);
      assert.ok(contrast(on, hover) >= 3);
      const focus = declarations(css, ".office-settings-popover .settings-switch-input:focus-visible + .settings-switch-track");
      const focusColor = resolveColor(focus.outline.match(/var\(.*\)/)![0], variables);
      assert.ok(contrast(focusColor, hover) >= 3);
      assert.ok(contrast(focusColor, background) >= 3);
      assert.equal(focus["outline-offset"], "3px");
    }
  });

  test(`${name}: native squares are visually replaced, switch state uses position, and reduced motion disables sliding`, () => {
    const input = declarations(css, ".office-settings-popover .settings-switch-input");
    assert.equal(input.opacity, "0");
    assert.equal(input.appearance, "none");
    assert.equal(input["-webkit-appearance"], "none");
    assert.equal(input.position, "absolute");
    assert.notEqual(input.display, "none");
    const off = declarations(css, ".office-settings-popover .settings-switch-track::after");
    const on = declarations(css, ".office-settings-popover .settings-switch-input:checked + .settings-switch-track::after");
    assert.notEqual(off.transform, on.transform);
    assert.match(off.transition, /transform/);
    assert.equal(declarations(css, '.office-settings-popover [data-reduced-motion="true"] .settings-switch-track').transition, "none");
    assert.equal(declarations(css, '.office-settings-popover [data-reduced-motion="true"] .settings-switch-track::after').transition, "none");
    assert.equal(declarations(css, ".office-settings-popover .settings-switch-input:disabled + .settings-switch-track")["border-style"], "dashed");
    const button = declarations(css, ".observer-shell .settings-toggle");
    const svg = declarations(css, ".observer-shell .settings-toggle svg");
    assert.equal(button.padding, "0");
    assert.equal(button["place-items"], "center");
    assert.equal(button.display, "grid");
    assert.equal(svg.display, "block");
    assert.ok(parseFloat(svg.width) <= parseFloat(button.width) - 2, "Icon must fit the actual bordered content box");
  });
}
