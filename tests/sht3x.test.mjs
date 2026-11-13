// SHT3x read back the way Sensirion's driver does: write a command, read 6 bytes, check each
// word's CRC-8, T = -45 + 175 * raw / 65535, RH = 100 * raw / 65535. Commands go through the
// gateware's command map (any high byte).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, image, commandBytes, sensirionCrc } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/sht3x.yaml");

function words(img, cmd, n) {
  const b = commandBytes(img, cmd, 3 * n), w = [];
  for (let i = 0; i < n; i++) {
    assert.equal(sensirionCrc([b[3 * i], b[3 * i + 1]]), b[3 * i + 2], `0x${cmd.toString(16)} word ${i} CRC`);
    w.push((b[3 * i] << 8) | b[3 * i + 1]);
  }
  return w;
}
const measure = (img, cmd) => { const [t, rh] = words(img, cmd, 2); return { t: -45 + (175 * t) / 65535, rh: (100 * rh) / 65535 }; };

test("single shot (with and without clock stretching) and fetch data", () => {
  for (const [t, rh] of [[-40, 0], [-10, 20], [25, 40], [60.5, 80.25], [125, 100]]) {
    const img = image(sd, def, { temperature_c: t, humidity_pct: rh });
    for (const cmd of [0x2400, 0x240b, 0x2416, 0x2c06, 0x2c0d, 0x2c10, 0xe000]) {
      const m = measure(img, cmd);
      assert.ok(Math.abs(m.t - t) <= 175 / 65535, `${t} C at 0x${cmd.toString(16)}`);
      assert.ok(Math.abs(m.rh - rh) <= 100 / 65535, `${rh} % at 0x${cmd.toString(16)}`);
    }
  }
});

test("status register and serial number", () => {
  const img = image(sd, def);
  assert.deepEqual(words(img, 0xf32d, 1), [0x8010]);
  assert.deepEqual(words(img, 0x3780, 2), [0x1a2b, 0x3c4d]);
  assert.deepEqual(words(img, 0x3682, 2), [0x1a2b, 0x3c4d]);
});

test("measurement times as the datasheet, within the pod's 65.535 ms", () => {
  const r = sd.validate(def);
  assert.equal(r.bus.command_map, true);
  const busy = Object.fromEntries(r.bus.commands.filter((c) => c.busy_us).map((c) => [c.command, c.busy_us]));
  assert.deepEqual(busy, { 0x2400: 15000, 0x240b: 6000, 0x2416: 4000 });
});
