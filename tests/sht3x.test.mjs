// SHT3x read back the way Sensirion's driver does: write a measure command, read 6 bytes, check
// each word's CRC-8, T = -45 + 175 * raw / 65535, RH = 100 * raw / 65535.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, docOf, image, sensirionCrc } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/sht3x.yaml");
const PAGE = docOf("sensors/i2c/sht3x.yaml").i2c.page;

function measure(img, cmd) {
  const b = img.subarray(cmd - PAGE, cmd - PAGE + 6);
  assert.equal(sensirionCrc([b[0], b[1]]), b[2], "temperature CRC");
  assert.equal(sensirionCrc([b[3], b[4]]), b[5], "humidity CRC");
  return { t: -45 + (175 * ((b[0] << 8) | b[1])) / 65535, rh: (100 * ((b[3] << 8) | b[4])) / 65535 };
}

test("single shot, all three repeatabilities", () => {
  for (const [t, rh] of [[-40, 0], [-10, 20], [25, 40], [60.5, 80.25], [125, 100]]) {
    const img = image(sd, def, { temperature_c: t, humidity_pct: rh });
    for (const cmd of [0x2400, 0x240b, 0x2416]) {
      const m = measure(img, cmd);
      assert.ok(Math.abs(m.t - t) <= 175 / 65535, `${t} C at 0x${cmd.toString(16)}`);
      assert.ok(Math.abs(m.rh - rh) <= 100 / 65535, `${rh} % at 0x${cmd.toString(16)}`);
    }
  }
});

test("measurement times as the datasheet, within the pod's 65.535 ms", () => {
  const r = sd.validate(def);
  const busy = Object.fromEntries(r.bus.commands.map((c) => [c.at, c.busy_us]));
  assert.deepEqual(busy, { 0x00: 15000, 0x0b: 6000, 0x16: 4000 });
  assert.equal(r.bus.addr_bits, 16);
});
