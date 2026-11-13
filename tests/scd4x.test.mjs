// SCD4x read back the way Sensirion's embedded-i2c-scd4x driver does: read_measurement (0xEC05),
// three words each with a CRC-8, integer conversions in m°C and m%RH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, image, sensirionCrc } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/scd4x.yaml");

function readMeasurement(img) {
  const at = 0xec05 - 0xec00;
  const w = [];
  for (let i = 0; i < 3; i++) {
    const b = img.subarray(at + i * 3, at + i * 3 + 3);
    assert.equal(sensirionCrc([b[0], b[1]]), b[2], `word ${i} CRC`);
    w.push((b[0] << 8) | b[1]);
  }
  return {
    co2: w[0],
    tMilliC: ((21875 * w[1]) >> 13) - 45000,     // scd4x_read_measurement
    rhMilli: (12500 * w[2]) >> 13,
  };
}

test("read_measurement", () => {
  for (const [co2, t, rh] of [[400, 20, 30], [600, 25, 40], [1234, -10, 0], [5000, 59.9, 99.9], [40000, 0, 55]]) {
    const m = readMeasurement(image(sd, def, { co2_ppm: co2, temperature_c: t, humidity_pct: rh }));
    assert.equal(m.co2, co2);
    assert.ok(Math.abs(m.tMilliC - t * 1000) <= 3, `${t} C reads ${m.tMilliC} m°C`);
    assert.ok(Math.abs(m.rhMilli - rh * 1000) <= 2, `${rh} % reads ${m.rhMilli} m%`);
  }
});

test("1 ms execution time, within the pod's 65.535 ms", () => {
  const r = sd.validate(def);
  assert.deepEqual(r.bus.commands, [{ at: 0x05, busy_us: 1000 }]);
});
