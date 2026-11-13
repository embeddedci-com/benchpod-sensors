#!/usr/bin/env node
// Check sensor definitions and stimuli with the pod's own engine (tools/engine).
//
//   node tools/validate.mjs                      # everything under sensors/ and stimuli/
//   node tools/validate.mjs my_sensor.yaml ...   # the files given (YAML or JSON)
//
// Each file: the engine's validate (or stimulus_validate), a first run at its defaults, and the
// pod limits the engine does not check (8N1 UART, no SPI data-ready, at most four busy times of
// at most 65.535 ms per I2C sensor, no `excitation: adc`). Exit 1 on any error.
// Needs Node 22 or later and python3 (YAML is read by tools/yaml2json.py).
import { resolve } from "node:path";
import { loadEngine, jsonOf, filesUnder, podLimits } from "../tests/engine.mjs";

const sd = await loadEngine();
const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => resolve(f))
  : [...filesUnder("sensors"), ...filesUnder("stimuli")];
let failed = 0;
for (const path of files) {
  let text;
  try {
    text = jsonOf(path);
  } catch (e) {
    console.log(`FAIL ${path}: ${String(e.stderr || e.message).trim()}`);
    failed++;
    continue;
  }
  const doc = JSON.parse(text);
  if (doc.kind === "stimulus") {
    const r = sd.stimulusValidate(text);
    if (!r.ok) { console.log(`FAIL ${path}: ${r.error}`); failed++; continue; }
    console.log(`ok   ${path}: stimulus, ${r.signals.length} signal(s), ${r.duration_s} s, ${r.faults.length} fault(s)`);
    continue;
  }
  const r = sd.validate(text);
  if (!r.ok) { console.log(`FAIL ${path}: ${r.error}`); failed++; continue; }
  const p = sd.preview(text, null, { tMs: 1000 });
  if (!p.ok) { console.log(`FAIL ${path}: at its defaults: ${p.error}`); failed++; continue; }
  const limits = podLimits(doc, r);
  const errors = limits.filter((x) => x.level === "error");
  console.log(`${errors.length ? "FAIL" : "ok  "} ${path}: ${r.kind}, ${r.params.length} param(s), ${r.program_bytes} bytes compiled`);
  for (const x of limits) console.log(`     ${x.level}: ${x.message}`);
  if (errors.length) failed++;
}
console.log(failed ? `${failed} of ${files.length} file(s) failed` : `all ${files.length} file(s) ok`);
process.exit(failed ? 1 : 0);
