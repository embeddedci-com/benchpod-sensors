// SCD4x read back the way Sensirion's embedded-i2c-scd4x driver does: a command, then words each
// with a CRC-8; read_measurement's integer conversions in m°C and m%RH; settings set and read
// back. Commands go through the gateware's command map (any high byte).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, image, imageAfterWrites, commandBytes, commandWrite, sensirionCrc } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/scd4x.yaml");

function words(img, cmd, n) {
  const b = commandBytes(img, cmd, 3 * n), w = [];
  for (let i = 0; i < n; i++) {
    assert.equal(sensirionCrc([b[3 * i], b[3 * i + 1]]), b[3 * i + 2], `0x${cmd.toString(16)} word ${i} CRC`);
    w.push((b[3 * i] << 8) | b[3 * i + 1]);
  }
  return w;
}
const withCrc = (w) => [w >> 8, w & 0xff, sensirionCrc([w >> 8, w & 0xff])];

test("read_measurement", () => {
  for (const [co2, t, rh] of [[400, 20, 30], [600, 25, 40], [1234, -10, 0], [5000, 59.9, 99.9], [40000, 0, 55]]) {
    const [c, wt, wrh] = words(image(sd, def, { co2_ppm: co2, temperature_c: t, humidity_pct: rh }), 0xec05, 3);
    assert.equal(c, co2);
    const tMilliC = ((21875 * wt) >> 13) - 45000, rhMilli = (12500 * wrh) >> 13;   // scd4x_read_measurement
    assert.ok(Math.abs(tMilliC - t * 1000) <= 3, `${t} C reads ${tMilliC} m°C`);
    assert.ok(Math.abs(rhMilli - rh * 1000) <= 2, `${rh} % reads ${rhMilli} m%`);
  }
});

test("data ready, serial number, self test, forced recalibration", () => {
  const img = image(sd, def);
  assert.ok(words(img, 0xe4b8, 1)[0] & 0x07ff, "data ready (low 11 bits not 0)");
  assert.equal(words(img, 0x3682, 3).length, 3);
  assert.deepEqual(words(img, 0x3639, 1), [0], "self test passed");
  assert.deepEqual(words(img, 0x362f, 1), [0x8000], "no correction");
});

test("settings read back what the DUT sets", () => {
  let img = image(sd, def);
  assert.equal((21875 * words(img, 0x2318, 1)[0]) >> 13, 4000, "power-on temperature offset 4 °C");
  assert.deepEqual(words(img, 0x2322, 1), [0], "altitude");
  assert.deepEqual(words(img, 0xe000, 1), [1013], "ambient pressure, hPa");
  assert.deepEqual(words(img, 0x2313, 1), [1], "automatic self-calibration on");
  const writes = [
    ...commandWrite(img, 0x241d, withCrc(Math.round((2.5 * 65536) / 175))),   // set_temperature_offset 2.5 °C
    ...commandWrite(img, 0x2427, withCrc(350)),                               // set_sensor_altitude 350 m
    ...commandWrite(img, 0xe000, withCrc(987)),                               // set_ambient_pressure
    ...commandWrite(img, 0x2416, withCrc(0)),                                 // self-calibration off
    ...commandWrite(img, 0x362f, withCrc(420)),                               // forced recalibration to 420 ppm
  ];
  img = imageAfterWrites(sd, def, writes);
  assert.ok(Math.abs(((21875 * words(img, 0x2318, 1)[0]) >> 13) - 2500) <= 3, "temperature offset 2.5 °C");
  assert.deepEqual(words(img, 0x2322, 1), [350]);
  assert.deepEqual(words(img, 0xe000, 1), [987]);
  assert.deepEqual(words(img, 0x2313, 1), [0]);
  assert.deepEqual(words(img, 0x362f, 1), [0x8000], "the correction does not take the DUT's bytes (the pod restores them)");
});

test("1 ms execution time for the reads, within the pod's 65.535 ms", () => {
  const r = sd.validate(def);
  assert.equal(r.bus.command_map, true);
  const busy = Object.fromEntries(r.bus.commands.filter((c) => c.busy_us).map((c) => [c.command, c.busy_us]));
  assert.equal(busy[0xec05], 1000);
  assert.equal(busy[0x2318], 1000);
});
