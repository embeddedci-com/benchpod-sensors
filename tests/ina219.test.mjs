// INA219 read back the way Adafruit's driver does: setCalibration_* writes CALIBRATION and
// CONFIGURATION, getBusVoltage_V = (BUS >> 3) * 4 mV, getCurrent_mA = CURRENT / currentDivider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, image, imageAfterWrites, u16be, s16be } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/ina219.yaml");

// The DUT writes CALIBRATION at pointer 0x05 and CONFIGURATION at 0x00. The definition's on_write
// rule copies CALIBRATION's high byte to 0xF5 (the engine's WASM build does not run rules), so the
// test applies that copy itself.
function calibrated(cal, config, values) {
  return imageAfterWrites(sd, def, [
    [0x05, cal >> 8], [0x06, cal & 0xff], [0xf5, cal >> 8],
    [0x00, config >> 8], [0x01, config & 0xff],
  ], values);
}
const busV = (img) => ((u16be(img, 0x02) >> 3) * 4) / 1000;
const currentMa = (img, divider) => s16be(img, 0x04) / divider;

test("power on: CONFIGURATION 0x399F, no current before a calibration", () => {
  const img = image(sd, def, { current_a: 1, bus_v: 12 });
  assert.equal(u16be(img, 0x00), 0x399f);
  assert.equal(s16be(img, 0x04), 0);
  assert.equal(busV(img), 12);
});

test("32 V, 2 A calibration (cal 4096, 0.1 mA per bit)", () => {
  for (const [a, v] of [[0.5, 12], [1.234, 24.5], [-0.25, 5], [0, 3.3]]) {
    const img = calibrated(4096, 0x399f, { current_a: a, bus_v: v, shunt_ohm: 0.1 });
    assert.ok(Math.abs(busV(img) - v) <= 0.002 + 1e-9, `${v} V`);
    assert.ok(Math.abs(currentMa(img, 10) - a * 1000) <= 0.1 + 1e-9, `${a} A`);
    assert.equal(u16be(img, 0x02) & 0x03, 0x02, "CNVR set, OVF clear");
  }
});

test("32 V, 1 A calibration (cal 10240, 40 uA per bit)", () => {
  const img = calibrated(10240, 0x399f, { current_a: 0.8, bus_v: 20, shunt_ohm: 0.1 });
  assert.equal(currentMa(img, 25), 800);
});

test("16 V, 400 mA calibration (cal 8192, PGA 40 mV)", () => {
  let img = calibrated(8192, 0x019f, { current_a: 0.3, bus_v: 5, shunt_ohm: 0.1 });
  assert.equal(currentMa(img, 20), 300);
  assert.equal(busV(img), 5);
  // 100 mV across the shunt saturates the 40 mV range; 20 V saturates the 16 V range.
  img = calibrated(8192, 0x019f, { current_a: 1, bus_v: 20, shunt_ohm: 0.1 });
  assert.equal(currentMa(img, 20), 400);
  assert.equal(busV(img), 16);
});

test("calibration bit 0 is ignored, as on the part", () => {
  const img = calibrated(4097, 0x399f, { current_a: 0.5, shunt_ohm: 0.1 });
  assert.equal(currentMa(img, 10), 500);
});

test("CURRENT overflow sets OVF", () => {
  const img = calibrated(0xfffe, 0x399f, { current_a: 3, shunt_ohm: 0.1 });
  assert.equal(u16be(img, 0x02) & 0x01, 1);
});
