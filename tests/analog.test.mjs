// The analog sensors read back the way a DUT's firmware decodes them: the NTC through the Beta
// equation from the divider voltage, the 4-20 mA transmitter as a linear span.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf } from "./engine.mjs";

const sd = await loadEngine();
const ntc = jsonOf("sensors/analog/ntc_10k_divider.yaml");
const ptx = jsonOf("sensors/analog/pressure_4_20ma.yaml");
const out = (def, values) => {
  const r = sd.preview(def, values);
  assert.ok(r.ok, r.error);
  return r;
};

test("NTC divider: the DUT's Beta equation gives the temperature back", () => {
  const VREF = 3.3, R_FIXED = 10000, R25 = 10000, BETA = 3950;
  for (const t of [-40, -20, 0, 10, 25, 37, 50, 85, 100, 125]) {
    const r = out(ntc, { temperature_c: t });
    assert.equal(r.unit, "V");
    const v = r.value;
    const rNtc = (R_FIXED * v) / (VREF - v);
    const back = 1 / (1 / 298.15 + Math.log(rNtc / R25) / BETA) - 273.15;
    assert.ok(Math.abs(back - t) < 0.001, `${t} C reads ${back}`);
  }
  assert.ok(Math.abs(out(ntc, { temperature_c: 25 }).value - 1.65) < 1e-9, "half the supply at 25 C");
});

test("4-20 mA transmitter: linear over the span", () => {
  for (const p of [0, 1, 2.5, 5, 7.75, 10]) {
    const r = out(ptx, { pressure_bar: p });
    assert.equal(r.unit, "mA");
    const back = ((r.value - 4) / 16) * 10;
    assert.ok(Math.abs(back - p) < 1e-9, `${p} bar reads ${back}`);
  }
});

test("4-20 mA transmitter: NAMUR NE 43 saturation outside the span", () => {
  assert.equal(out(ptx, { pressure_bar: -1 }).value, 3.8);
  assert.equal(out(ptx, { pressure_bar: 12 }).value, 20.5);
  const r = sd.validate(ptx);
  assert.deepEqual([r.analog.output, r.analog.min, r.analog.max], ["current", 0, 22]);
});
