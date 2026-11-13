// LIS3DH read back the way ST's lis3dh-pid driver does: SPI address byte = reg | 0x80 (read) |
// 0x40 (increment), a 6-byte burst from OUT_X_L, int16 words, lis3dh_from_fsX_Y_to_mg().
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf, docOf, image, imageAfterWrites } from "./engine.mjs";

const sd = await loadEngine();
const direct = jsonOf("sensors/spi/lis3dh.yaml");
const fifoPath = "sensors/spi/lis3dh_fifo.yaml";
const withFifo = jsonOf(fifoPath);

const OUT_X_L = 0x28, CTRL_REG1 = 0x20, CTRL_REG4 = 0x23, CTRL_REG5 = 0x24, FIFO_CTRL_REG = 0x2e;

// What the pod's SPI target does with the address byte (read bit 7, increment bit 6, mask 0x3F).
function burst(info, img, addrByte, n) {
  const b = info.bus;
  assert.equal((addrByte >> b.read_bit) & 1, b.read_val, "a read");
  const inc = b.inc_bit === null || ((addrByte >> b.inc_bit) & 1) === b.inc_val;
  const a = addrByte & b.address_mask;
  return Array.from({ length: n }, (_, i) => img[inc ? a + i : a]);
}
const int16 = (lo, hi) => { const v = lo | (hi << 8); return v >= 0x8000 ? v - 0x10000 : v; };

// lis3dh_from_fs*_*_to_mg: the word shifted down to its resolution, times the sensitivity.
const TO_MG = {
  hr: { shift: 16, sens: [1, 2, 4, 12] },
  nm: { shift: 64, sens: [4, 8, 16, 48] },
  lp: { shift: 256, sens: [16, 32, 64, 192] },
};
const toMg = (raw, mode, fs) => (raw / TO_MG[mode].shift) * TO_MG[mode].sens[fs];

function setup(def, { odr = 5, mode = "hr", fs = 0, ble = 0, axes = 7, ctrl5 = 0, fifoCtrl = 0 }, values) {
  const ctrl1 = (odr << 4) | (mode === "lp" ? 0x08 : 0) | axes;
  const ctrl4 = (ble << 6) | (fs << 4) | (mode === "hr" ? 0x08 : 0);
  return imageAfterWrites(sd, def, [[CTRL_REG1, ctrl1], [CTRL_REG4, ctrl4], [CTRL_REG5, ctrl5], [FIFO_CTRL_REG, fifoCtrl]], values);
}

const info = sd.validate(direct);

test("SPI mode 3, WHO_AM_I 0x33, power-on CTRL_REG1 0x07", () => {
  assert.equal(info.bus.spi_mode, 3);
  const img = image(sd, direct);
  assert.deepEqual(burst(info, img, 0x80 | 0x0f, 1), [0x33]);
  assert.deepEqual(burst(info, img, 0x80 | CTRL_REG1, 1), [0x07]);
});

test("every mode and full scale decodes to the set acceleration", () => {
  const values = { accel_x_g: 0.5, accel_y_g: -0.25, accel_z_g: 1 };
  for (const mode of ["hr", "nm", "lp"]) {
    for (const fs of [0, 1, 2, 3]) {
      const img = setup(direct, { mode, fs }, values);
      const b = burst(info, img, 0x80 | 0x40 | OUT_X_L, 6);
      const step = TO_MG[mode].sens[fs];
      const mg = [int16(b[0], b[1]), int16(b[2], b[3]), int16(b[4], b[5])].map((w) => toMg(w, mode, fs));
      assert.ok(Math.abs(mg[0] - 500) <= step / 2, `${mode} fs${fs} X ${mg[0]}`);
      assert.ok(Math.abs(mg[1] + 250) <= step / 2, `${mode} fs${fs} Y ${mg[1]}`);
      assert.ok(Math.abs(mg[2] - 1000) <= step / 2, `${mode} fs${fs} Z ${mg[2]}`);
      assert.deepEqual(burst(info, img, 0x80 | 0x27, 1), [0x0f], "STATUS_REG ZYXDA");
    }
  }
});

test("the output saturates at the full scale", () => {
  const img = setup(direct, { mode: "hr", fs: 0 }, { accel_x_g: 3, accel_y_g: -3 });
  const b = burst(info, img, 0xe8, 4);
  assert.equal(toMg(int16(b[0], b[1]), "hr", 0), 2047);
  assert.equal(toMg(int16(b[2], b[3]), "hr", 0), -2048);
});

test("BLE swaps the byte order", () => {
  const img = setup(direct, { ble: 1 }, { accel_x_g: 0.5 });
  const b = burst(info, img, 0xe8, 2);
  assert.equal(toMg(int16(b[1], b[0]), "hr", 0), 500);
});

test("power-down and disabled axes read 0", () => {
  let b = burst(info, setup(direct, { odr: 0 }, { accel_x_g: 1 }), 0xe8, 6);
  assert.deepEqual(b, [0, 0, 0, 0, 0, 0]);
  b = burst(info, setup(direct, { axes: 0b101 }, { accel_x_g: 1, accel_y_g: 1, accel_z_g: 1 }), 0xe8, 6);
  assert.equal(int16(b[2], b[3]), 0, "Y disabled");
  assert.notEqual(int16(b[0], b[1]), 0);
});

test("without increment the pointer stays", () => {
  const img = setup(direct, {}, { accel_x_g: 0.5 });
  const b = burst(info, img, 0x80 | 0x29, 3);
  assert.equal(new Set(b).size, 1);
});

// ---- lis3dh_fifo ----
// The engine's WASM build does not pop FIFO frames, so the frame, rate and enable expressions are
// placed in spare registers of a copy of the definition, where the same engine evaluates them.
function probe(levelExprs = {}) {
  const doc = docOf(fifoPath);
  const src = doc.registers.find((r) => r.name === "FIFO_SRC_REG").u8;
  doc.registers.push({ at: 0x30, bytes: doc.fifo.frame });
  doc.registers.push({ at: 0x36, u16be: doc.fifo.rate_hz });
  doc.registers.push({ at: 0x38, u8: `(${doc.fifo.enabled}) ? 1 : 0` });
  let at = 0x39;
  for (const lvl of Object.values(levelExprs)) doc.registers.push({ at: at++, u8: src.replaceAll("fifo_level", String(lvl)) });
  return JSON.stringify(doc);
}

test("FIFO: 32 frames of 6 bytes popped at OUT_X_L", () => {
  const r = sd.validate(withFifo);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.bus.fifo, { at: OUT_X_L, frame_len: 6, depth: 32, drop: "oldest" });
});

test("FIFO: a frame is the X, Y, Z sample in the data-register format", () => {
  const def = probe();
  const values = { accel_x_g: -0.75, accel_y_g: 0.125, accel_z_g: 1.5 };
  for (const mode of ["hr", "nm", "lp"]) {
    for (const ble of [0, 1]) {
      const img = setup(def, { mode, fs: 1, ble, ctrl5: 0x40, fifoCtrl: 0x80 }, values);
      const f = Array.from(img.subarray(0x30, 0x36));
      // the frame equals the data registers read directly with lis3dh
      const d = burst(info, setup(direct, { mode, fs: 1, ble }, values), 0xe8, 6);
      assert.deepEqual(f, d, `${mode} ble ${ble}`);
      const w = ble ? [int16(f[1], f[0]), int16(f[3], f[2]), int16(f[5], f[4])] : [int16(f[0], f[1]), int16(f[2], f[3]), int16(f[4], f[5])];
      const step = TO_MG[mode].sens[1];
      assert.ok(Math.abs(toMg(w[0], mode, 1) + 750) <= step / 2);
      assert.ok(Math.abs(toMg(w[2], mode, 1) - 1500) <= step / 2);
    }
  }
});

test("FIFO: on with FIFO_EN and a FIFO mode, at the output data rate", () => {
  const def = probe();
  const rate = (img) => (img[0x36] << 8) | img[0x37];
  let img = setup(def, { odr: 5, ctrl5: 0x40, fifoCtrl: 0x80 });       // 100 Hz, stream mode
  assert.deepEqual([img[0x38], rate(img)], [1, 100]);
  img = setup(def, { odr: 9, mode: "lp", ctrl5: 0x40, fifoCtrl: 0x40 }); // 5.376 kHz, FIFO mode
  assert.deepEqual([img[0x38], rate(img)], [1, 5376]);
  img = setup(def, { odr: 9, mode: "nm", ctrl5: 0x40, fifoCtrl: 0x40 });
  assert.equal(rate(img), 1344);
  img = setup(def, { odr: 5, ctrl5: 0x00, fifoCtrl: 0x80 });             // FIFO_EN off
  assert.equal(img[0x38], 0);
  img = setup(def, { odr: 5, ctrl5: 0x40, fifoCtrl: 0x00 });             // bypass mode
  assert.equal(img[0x38], 0);
});

test("FIFO: FIFO_SRC_REG level, EMPTY, watermark and overrun", () => {
  const levels = { empty: 0, some: 5, above_wtm: 16, full: 32 };
  const img = setup(probe(levels), { ctrl5: 0x40, fifoCtrl: 0x80 | 15 }); // FTH 15
  const [empty, some, wtm, full] = Array.from(img.subarray(0x39, 0x3d));
  assert.equal(empty, 0x20);
  assert.equal(some, 5);
  assert.equal(wtm, 0x80 | 16);
  assert.equal(full, 0x80 | 0x40 | 31);
  assert.equal(image(sd, withFifo)[0x2f], 0x20, "EMPTY at power on");
});
