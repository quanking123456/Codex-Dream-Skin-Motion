import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const decorationSelector = ':is(.app-shell-main-content-top-fade, [class*="_MainContentTopFade_"])';

test("top-fade contract excludes the Codex 26.928 conversation wrapper", async () => {
  const contract = JSON.parse(await fs.readFile(new URL("tools/selectors.json", root), "utf8"));
  const selector = contract.selectors.find(({ key }) => key === "main-content-top-fade")?.selector;
  // In 26.928 this data attribute belongs to the flex parent containing both
  // the conversation and composer, rather than to the gradient decoration.
  assert.equal(selector, decorationSelector);
  assert.doesNotMatch(selector, /data-app-shell-main-content-top-fade/);
});

for (const platform of ["windows", "macos"]) {
  test(`${platform} generated CSS hides the gradient without hiding its content parent`, async () => {
    const css = (await fs.readFile(new URL(`${platform}/assets/dream-skin.css`, root), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }));
    const taskVeils = rules.filter(({ selector, declarations }) =>
      selector.endsWith('main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"]):not(:has([role="main"]))') &&
      /background:\s*linear-gradient/.test(declarations));
    assert.equal(taskVeils.length, 2);
    for (const { selector } of taskVeils) {
      assert.doesNotMatch(selector, /:not\(:has\(main:/,
        "A retained hidden Home shell must not suppress another shell's task veil.");
    }
    const nativeRoot = rules.find(({ selector }) => selector.includes('body > div:has(main:is('));
    assert.ok(nativeRoot, "The current id-less native root must remain above the video stage.");
    assert.match(nativeRoot.declarations, /z-index:\s*10\s*!important/);
    assert.match(nativeRoot.declarations, /isolation:\s*isolate/);
    const fadeHideRules = rules.filter(({ selector, declarations }) =>
      /MainContentTopFade_|app-shell-main-content-top-fade/.test(selector) &&
      /display\s*:\s*none\s*!important\s*;/.test(declarations));
    assert.equal(fadeHideRules.length, 1, "The wide-art gradient suppression must remain present.");
    assert.ok(fadeHideRules[0].selector.endsWith(decorationSelector),
      "Only the legacy gradient class or CSS Module gradient may be hidden.");
    for (const { selector, declarations } of rules) {
      if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\s*[;!]/.test(declarations)) {
        assert.doesNotMatch(selector, /\[data-app-shell-main-content-top-fade(?:[\]=\s])/,
          "A content-parent attribute must never be used to hide the conversation and composer.");
      }
    }
  });
}
