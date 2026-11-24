import assert from "node:assert/strict";
import puppeteer from "puppeteer";
let browserProject;
import { draftInput } from "../local-draft-input.mjs";
import { searchDrafts } from "../local-drafts.mjs";
import { rectangle } from "../cloud/planning-input.mjs";
import { validate } from "../cloud/planning-geometry.mjs";

for (const scale of [1, 0.001]) {
  for (const reverse of [false, true]) {
    const points = rectangle(4 / scale, 15 / scale, 8 / scale, 30 / scale);
    if (reverse) points.reverse();
    const project = {
      version: 3,
      metersPerUnit: scale,
      items: [],
      planning: {
        regions: [{ id: "hall", points }],
        noZones: true,
        entrances: [{ center: { x: 4 / scale, y: 0 } }],
        exits: [{ center: { x: 4 / scale, y: 30 / scale } }],
        demands: [
          {
            id: "d",
            cat: "衣物",
            style: "tent",
            width: 2,
            depth: 2,
            min: 20,
            max: 24,
          },
        ],
        aisles: { min: 2, max: 4 },
      },
    };
    if (scale === 1 && !reverse) browserProject = project;
    const s = draftInput(project);
    const result = searchDrafts(s, () => {});
    assert.ok(result.candidates.length, result.error);
    for (const d of result.candidates) {
      assert.ok(validate({ ...s, presets: d.presets }, d).ok);
      assert.equal(d.metrics.missing, 0);
      let left = 0,
        right = 0;
      for (const i of d.items) {
        assert.ok(i.wallBack, "narrow hall needs boundary rows only");
        const x = (i.wx + i.ww / 2) * scale;
        const inwardX = -Math.sin((i.angle * Math.PI) / 180) * i.frontSide;
        if (Math.abs(x - 1) < 1e-6) {
          left++;
          assert.ok(inwardX > 0.99);
        } else {
          assert.ok(
            Math.abs(x - 7) < 1e-6,
            JSON.stringify({ i, x, metrics: d.metrics }),
          );
          right++;
          assert.ok(inwardX < -0.99);
        }
      }
      assert.ok(left && right, "both side walls must be used");
      assert.ok(
        Math.abs(left - right) <= 1,
        "do not exhaust demand on one wall",
      );
      assert.ok(Math.abs(d.metrics.gap - 4) < 1e-6);
      console.log(
        JSON.stringify({
          scale,
          reverse,
          total: d.items.length,
          left,
          right,
          gap: d.metrics.gap,
        }),
      );
    }
  }
}
console.log(
  "PASS boundary rows, inward fronts, balanced sides, aisle width, winding and CAD scale",
);

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto("http://127.0.0.1:3005");
  await page.waitForFunction(() => window.plannerUI && window.environmentUI);
  browserProject.environment = {
    schema: "needflea-environment/1",
    objects: [],
    sitePlan: {
      schema: "needflea-site-plan/1",
      points: rectangle(4, 15, 8, 30),
    },
  };
  await page.evaluate((p) => projectIO.load(p), browserProject);
  await page.click("#btn-planner");
  await page.click("#plan-generate");
  await page.waitForFunction(
    () => !document.querySelector("#plan-generate").disabled,
  );
  assert.ok(
    await page.$("#plan-cards article"),
    await page.$eval("#plan-status", (e) => e.textContent),
  );
  await page.screenshot({ path: "/tmp/needflea-wall-layout.png" });
  console.log("PASS browser wall-layout preview");
} finally {
  await browser.close();
}
