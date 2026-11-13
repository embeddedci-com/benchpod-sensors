// Every definition and stimulus in the library loads in the pod's engine, within the pod's limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, dirname } from "node:path";
import { loadEngine, jsonOf, docOf, filesUnder, podLimits } from "./engine.mjs";

const sd = await loadEngine();
const sensors = filesUnder("sensors");
const stimuli = filesUnder("stimuli");

for (const path of sensors) {
  test(`${path} validates`, () => {
    const doc = docOf(path);
    const r = sd.validate(jsonOf(path));
    assert.ok(r.ok, r.error);
    assert.equal(r.name, basename(path, ".yaml"), "name matches the file name");
    assert.equal(r.kind, basename(dirname(path)), "kind matches the directory");
    assert.ok(doc.label, "has a label");
    assert.ok(doc.description, "has a description");
    assert.ok(doc.datasheet, "has a datasheet link");
    const errors = podLimits(doc, r).filter((x) => x.level === "error");
    assert.deepEqual(errors, [], "within the pod's limits");
    const p = sd.preview(jsonOf(path), null, { tMs: 1000 });
    assert.ok(p.ok, p.error);
  });
}

for (const path of stimuli) {
  test(`${path} validates`, () => {
    const doc = docOf(path);
    const r = sd.stimulusValidate(jsonOf(path));
    assert.ok(r.ok, r.error);
    assert.equal(r.name, basename(path, ".yaml"), "name matches the file name");
    assert.ok(doc.label && doc.description, "has a label and a description");
  });
}

test("names are unique", () => {
  const names = [...sensors, ...stimuli].map((p) => basename(p, ".yaml"));
  assert.equal(new Set(names).size, names.length);
});
