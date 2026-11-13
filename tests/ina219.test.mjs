// INA219 read back the way Adafruit's driver does: setCalibration_* writes CALIBRATION and
// CONFIGURATION, getShuntVoltage_mV = SHUNT * 0.01, getBusVoltage_V = (BUS >> 3) * 4 mV,
// getCurrent_mA = CURRENT / currentDivider, getPower_mW = POWER * powerMultiplier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, image, imageAfterWrites, word, wordWrite } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/i2c/ina219.yaml");
const s16 = (w) => (w >= 0x8000 ? w - 0x10000 : w);

const calibrated = (cal, config, values) => imageAfterWrites(sd, def, [...wordWrite(0x05, cal), ...wordWrite(0x00, config)], values);
const shuntMv = (img) => s16(word(img, 0x01)) * 0.01;
const busV = (img) => ((word(img, 0x02) >> 3) * 4) / 1000;
const currentMa = (img, divider) => s16(word(img, 0x04)) / divider;
const powerMw = (img, mult) => word(img, 0x03) * mult;

test("word registers on the bus", () => {
  assert.equal(sd.validate(def).bus.register_bytes, 2);
});

test("power on: CONFIGURATION 0x399F, no current or power before a calibration", () => {
  const img = image(sd, def, { current_a: 1, bus_v: 12 });
  assert.equal(word(img, 0x00), 0x399f);
  assert.equal(s16(word(img, 0x04)), 0);
  assert.equal(word(img, 0x03), 0);
  assert.equal(word(img, 0x05), 0);
  assert.equal(busV(img), 12);
  assert.equal(shuntMv(img), 100, "1 A through 0.1 ohm");
});

test("32 V, 2 A calibration (cal 4096, 0.1 mA and 2 mW per bit)", () => {
  for (const [a, v] of [[0.5, 12], [1.234, 24.5], [-0.25, 5], [0, 3.3]]) {
    const img = calibrated(4096, 0x399f, { current_a: a, bus_v: v, shunt_ohm: 0.1 });
    assert.ok(Math.abs(busV(img) - v) <= 0.002 + 1e-9, `${v} V`);
    assert.ok(Math.abs(currentMa(img, 10) - a * 1000) <= 0.1 + 1e-9, `${a} A`);
    assert.ok(Math.abs(shuntMv(img) - a * 100) <= 0.01 + 1e-9, "shunt voltage");
    assert.ok(Math.abs(powerMw(img, 2) - Math.abs(a) * v * 1000) <= 2 + Math.abs(a) * 2, `power at ${a} A, ${v} V: ${powerMw(img, 2)}`);
    assert.equal(word(img, 0x02) & 0x03, 0x02, "CNVR set, OVF clear");
    assert.equal(word(img, 0x05), 4096, "CALIBRATION reads back");
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
  assert.equal(shuntMv(img), 40);
  assert.equal(busV(img), 16);
});

test("calibration bit 0 is ignored, as on the part", () => {
  const img = calibrated(4097, 0x399f, { current_a: 0.5, shunt_ohm: 0.1 });
  assert.equal(currentMa(img, 10), 500);
});

test("CURRENT overflow sets OVF", () => {
  const img = calibrated(0xfffe, 0x399f, { current_a: 3, shunt_ohm: 0.1 });
  assert.equal(word(img, 0x02) & 0x01, 1);
});
