// TMP117 read back the way TI's and SparkFun's drivers do: 16-bit big-endian words, the result
// as int16 x 7.8125 m°C, the device ID at 0x0F, the offset register at 0x07.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, image, imageAfterWrites, u16be } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/tmp117.yaml");

// A 2-byte register read at pointer p: bytes p and p + 1.
const readWord = (img, p) => u16be(img, p);
const toC = (w) => (w >= 0x8000 ? w - 0x10000 : w) * 0.0078125;

test("device ID", () => {
  assert.equal(readWord(image(sd, def), 0x0f), 0x0117);
});

test("temperature result over the range", () => {
  for (const t of [-55, -40, -10.5, 0, 0.0078125, 25, 37.25, 85, 100.123, 150]) {
    const img = image(sd, def, { temperature_c: t });
    assert.ok(Math.abs(toC(readWord(img, 0x00)) - t) <= 0.0078125 / 2 + 1e-12, `${t} C`);
  }
});

test("the offset the DUT writes is added", () => {
  for (const [off, word] of [[1.5, 0x00c0], [-2, 0xff00]]) {
    const img = imageAfterWrites(sd, def, [[0x07, word >> 8], [0x08, word & 0xff]], { temperature_c: 30 });
    assert.equal(readWord(img, 0x07), word, "offset reads back");
    assert.ok(Math.abs(toC(readWord(img, 0x00)) - (30 + off)) < 1e-9);
  }
});

test("a CONFIG write does not disturb the result", () => {
  // CONFIG 0x0220 written at pointer 0x01: its high byte lands on the result's low byte.
  const img = imageAfterWrites(sd, def, [[0x01, 0x02], [0x02, 0x20]], { temperature_c: 21.5 });
  assert.equal(toC(readWord(img, 0x00)), 21.5);
  assert.equal(img[0x02], 0x20);
});
