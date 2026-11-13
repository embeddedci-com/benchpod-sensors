// TMP117 read back the way TI's, SparkFun's and Adafruit's drivers do: 16-bit big-endian
// registers, the result as int16 x 7.8125 m°C, CONFIGURATION's Data_Ready flag, the device ID at
// 0x0F, the offset register at 0x07.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, image, imageAfterWrites, word, wordWrite } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/tmp117.yaml");
const toC = (w) => (w >= 0x8000 ? w - 0x10000 : w) * 0.0078125;

test("word registers on the bus", () => {
  const r = sd.validate(def);
  assert.equal(r.bus.register_bytes, 2);
  assert.equal(r.bus.addr_bits, 8);
});

test("device ID and the power-on registers, each its own word", () => {
  const img = image(sd, def);
  assert.equal(word(img, 0x0f), 0x0117);
  assert.equal(word(img, 0x01), 0x2220, "CONFIGURATION: 0x0220 with Data_Ready");
  assert.equal(word(img, 0x02), 0x6000);
  assert.equal(word(img, 0x03), 0x8000);
  assert.equal(word(img, 0x07), 0x0000);
});

test("Data_Ready is set, so a driver that waits for it goes on", () => {
  assert.ok(word(image(sd, def), 0x01) & 0x2000);
});

test("temperature result over the range", () => {
  for (const t of [-55, -40, -10.5, 0, 0.0078125, 25, 37.25, 85, 100.123, 150]) {
    const img = image(sd, def, { temperature_c: t });
    assert.ok(Math.abs(toC(word(img, 0x00)) - t) <= 0.0078125 / 2 + 1e-12, `${t} C`);
  }
});

test("the offset the DUT writes is added", () => {
  for (const [off, w] of [[1.5, 0x00c0], [-2, 0xff00]]) {
    const img = imageAfterWrites(sd, def, wordWrite(0x07, w), { temperature_c: 30 });
    assert.equal(word(img, 0x07), w, "offset reads back");
    assert.ok(Math.abs(toC(word(img, 0x00)) - (30 + off)) < 1e-9);
  }
});

test("a CONFIGURATION write does not disturb its neighbors", () => {
  const img = imageAfterWrites(sd, def, wordWrite(0x01, 0x0c20), { temperature_c: 21.5 });
  assert.equal(toC(word(img, 0x00)), 21.5);
  assert.equal(word(img, 0x02), 0x6000);
  assert.equal(word(img, 0x01), 0x0c20, "stored (the pod's rule then sets Data_Ready again)");
});

test("TEMP_RESULT and DEVICE_ID are read-only", () => {
  const ro = new Set(sd.validate(def).read_only);
  for (const b of [0x00, 0x01, 0x1e, 0x1f]) assert.ok(ro.has(b), `image byte ${b}`);
});
