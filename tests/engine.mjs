// Shared helpers for the library tests and tools/validate.mjs: the vendored engine, YAML to JSON
// through tools/yaml2json.py, and the pod limits the engine itself does not check.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSensorDef } from "../tools/engine/sensor_def.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let engine = null;
/** The engine, loaded once. */
export async function loadEngine() {
  if (!engine) engine = await loadSensorDef(readFileSync(join(ROOT, "tools/engine/sensor_def.wasm")));
  return engine;
}

const cache = new Map();
/** A YAML (or JSON) file as the JSON text a pod receives. */
export function jsonOf(path) {
  const abs = path.startsWith("/") ? path : join(ROOT, path);
  if (abs.endsWith(".json")) return readFileSync(abs, "utf8");
  if (!cache.has(abs)) {
    const python = process.env.PYTHON || "python3";
    cache.set(abs, execFileSync(python, [join(ROOT, "tools/yaml2json.py"), abs], { encoding: "utf8" }));
  }
  return cache.get(abs);
}

/** The parsed definition or stimulus. */
export function docOf(path) {
  return JSON.parse(jsonOf(path));
}

/** Every .yaml under dir, relative to the repo root, sorted. */
export function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".yaml")) out.push(relative(ROOT, p));
    }
  };
  if (existsSync(join(ROOT, dir))) walk(join(ROOT, dir));
  return out;
}

// ---- register image helpers ----
export const u16be = (img, a) => (img[a] << 8) | img[a + 1];
export const s16be = (img, a) => { const v = u16be(img, a); return v >= 0x8000 ? v - 0x10000 : v; };
export const s16le = (img, a) => { const v = img[a] | (img[a + 1] << 8); return v >= 0x8000 ? v - 0x10000 : v; };

/** Word registers (i2c.register_bytes: 2): register p as the DUT reads it, image bytes 2p, 2p + 1. */
export const word = (img, p) => u16be(img, 2 * (p & 0x7f));
/** The image bytes a DUT's write of word w to register p lands on, for imageAfterWrites. */
export const wordWrite = (p, w) => [[2 * (p & 0x7f), (w >> 8) & 0xff], [2 * (p & 0x7f) + 1, w & 0xff]];

/**
 * Command map (register_address_bits: 16 without page): the n bytes a DUT reads after command
 * cmd, through the gateware's lookup (the pointer becomes image[cmd >> 8] ^ (cmd & 0xFF)).
 */
export function commandBytes(img, cmd, n) {
  const at = img[cmd >> 8] ^ (cmd & 0xff);
  return Array.from({ length: n }, (_, k) => img[(at + k) & 0xff]);
}
/** The image bytes a DUT's command cmd with data bytes lands on, for imageAfterWrites. */
export function commandWrite(img, cmd, bytes) {
  const at = img[cmd >> 8] ^ (cmd & 0xff);
  return bytes.map((b, k) => [(at + k) & 0xff, b]);
}

/** Sensirion CRC-8 (poly 0x31, init 0xFF), written out as the vendor drivers do. */
export function sensirionCrc(bytes) {
  let crc = 0xff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** The image after power on and a rebuild, failing loudly on an engine error. */
export function image(sd, def, values = null, opts = {}) {
  const r = sd.preview(def, values, opts);
  if (!r.ok) throw new Error(`preview: ${r.error}`);
  return r.image;
}

/**
 * The image a DUT sees after it wrote `writes` ([[addr, byte], ...]) on top of the power-on image:
 * the written bytes go into the live image, then the engine rebuilds it. (The pod also runs the
 * definition's on_write rules here; the engine's WASM build does not expose them, so a test that
 * depends on a rule applies the rule's effect itself and says so.)
 */
export function imageAfterWrites(sd, def, writes, values = null, opts = {}) {
  const live = new Uint8Array(image(sd, def, values, opts));
  for (const [a, b] of writes) live[a] = b;
  return image(sd, def, values, { ...opts, liveRegs: live });
}

/**
 * Pod limits that come from the gateware and the sensor manager, not from the format. Returns a
 * list of {level: "error" | "note", message}.
 */
export function podLimits(doc, info) {
  const out = [];
  const err = (m) => out.push({ level: "error", message: m });
  const note = (m) => out.push({ level: "note", message: m });
  if (doc.kind === "uart") {
    const u = info.uart;
    if (u.data_bits !== 8 || u.parity !== "N" || u.stop_bits !== 1)
      err(`the pod's UART is 8N1 only (this is ${u.data_bits}${u.parity}${u.stop_bits})`);
  }
  if (doc.kind === "analog" && info.analog.excitation && info.analog.excitation !== "none")
    err("excitation: adc is not supported by the pod");
  if (doc.kind === "spi") {
    if (doc.data_ready) err("the pod's SPI target has no data-ready pin");
    if (doc.conversion) err("the pod's SPI target has no conversions (only FIFO and read-only registers)");
    if (doc.commands) err("the pod's SPI target has no commands (only FIFO and read-only registers)");
  }
  if (doc.kind === "i2c") {
    const times = [];
    const conv = info.bus.conversion;
    if (conv) times.push(conv.us);
    for (const c of info.bus.commands) if (c.busy_us) times.push(c.busy_us);
    for (const us of new Set(times))
      if (us > 65535) note(`a busy time of ${us} us; the pod clamps it to 65535 us`);
    const distinct = new Set(times.map((us) => Math.min(us, 65535)));
    if (distinct.size > 4)
      err(`${distinct.size} distinct conversion/command times; the pod has 4 per I2C sensor`);
  }
  return out;
}
