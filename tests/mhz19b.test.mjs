// MH-Z19B read back the way the datasheet's example code does: send the 9-byte read command,
// check the answer's checksum with getCheckSum, CO2 = HIGH * 256 + LOW.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf } from "./engine.mjs";

const sd = await loadEngine();
const def = jsonOf("sensors/uart/mhz19b.yaml");
const READ = Uint8Array.from([0xff, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79]);

function getCheckSum(packet) {   // datasheet: 0xFF - sum(packet[1..7]) + 1
  let checksum = 0;
  for (let i = 1; i < 8; i++) checksum = (checksum + packet[i]) & 0xff;
  return (0xff - checksum + 1) & 0xff;
}

test("the read command's own checksum is the datasheet's", () => {
  assert.equal(getCheckSum(READ), READ[8]);
});

test("read CO2 concentration", () => {
  for (const [co2, t] of [[0, 25], [400, 20], [600, 25], [1999, -5], [5000, 50], [10000, 85]]) {
    const r = sd.uartAnswer(def, { co2_ppm: co2, temperature_c: t }, READ);
    assert.ok(r.ok, r.error);
    assert.equal(r.answers.length, 1);
    const a = r.answers[0];
    assert.equal(a.after_byte, 8, "answers after the last request byte");
    const b = a.bytes;
    assert.equal(b.length, 9);
    assert.equal(b[0], 0xff);
    assert.equal(b[1], 0x86);
    assert.equal(getCheckSum(b), b[8], "checksum");
    assert.equal(b[2] * 256 + b[3], co2);
    assert.equal(b[4] - 40, t);
  }
});

test("calibration commands get no answer", () => {
  const zero = Uint8Array.from([0xff, 0x01, 0x87, 0x00, 0x00, 0x00, 0x00, 0x00, 0x78]);
  const r = sd.uartAnswer(def, null, zero);
  assert.ok(r.ok, r.error);
  assert.equal(r.answers.length, 0);
});

test("9600 8N1", () => {
  const r = sd.validate(def);
  assert.deepEqual([r.uart.baud, r.uart.data_bits, r.uart.parity, r.uart.stop_bits], [9600, 8, "N", 1]);
});
