// The example stimuli sample the way a chart draws them (stimulus_sample), hit their key values
// and fault windows, and stay inside the params of the sensors they drive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, jsonOf } from "./engine.mjs";

const sd = await loadEngine();
const STEP = 0.5;

function sample(path) {
  const stim = jsonOf(path);
  const info = sd.stimulusValidate(stim);
  assert.ok(info.ok, info.error);
  const s = sd.stimulusSample(stim, 0, info.duration_s, STEP);
  assert.ok(s.ok, s.error);
  // chart-friendly: one point per step, ascending, every value a finite number
  assert.equal(s.t.length, Math.floor(info.duration_s / STEP) + 1);
  s.t.forEach((t, i) => assert.equal(t, i * STEP));
  for (const sig of s.signals) {
    assert.equal(sig.values.length, s.t.length);
    assert.ok(sig.values.every(Number.isFinite), `${sig.name}: finite values`);
  }
  const at = (name, t) => s.signals.find((x) => x.name === name).values[Math.round(t / STEP)];
  return { info, s, at, windows: s.faults.map((f) => [f.type, f.windows]) };
}

// Every signal is a param of `sensor`, and every sampled value is inside its range.
function drives(s, sensorPath) {
  const params = Object.fromEntries(sd.validate(jsonOf(sensorPath)).params.map((p) => [p.key, p]));
  for (const sig of s.signals) {
    const p = params[sig.param];
    assert.ok(p, `${sig.param} is a param of ${sensorPath}`);
    assert.ok(sig.values.every((v) => v >= p.min && v <= p.max), `${sig.param} inside ${p.min}..${p.max}`);
  }
}
const valuesAt = (s, i) => Object.fromEntries(s.signals.map((x) => [x.param, x.values[i]]));

test("temperature_ramp_fault", () => {
  const { s, at, windows } = sample("stimuli/temperature_ramp_fault.yaml");
  assert.equal(at("temperature_c", 0), 22);
  assert.equal(at("temperature_c", 10), 22);
  assert.equal(at("temperature_c", 40), 41);
  assert.equal(at("temperature_c", 70), 60);
  assert.equal(at("temperature_c", 100), 60);
  assert.equal(at("temperature_c", 150), 22);
  assert.deepEqual(windows, [["stuck", [[50, 60]]], ["no_response", [[120, 123]]]]);
  for (const sensor of ["sensors/i2c/tmp117.yaml", "sensors/i2c/sht3x.yaml", "sensors/analog/ntc_10k_divider.yaml"])
    drives(s, sensor);
});

test("gps_drive", () => {
  const { s, at, windows } = sample("stimuli/gps_drive.yaml");
  assert.equal(at("speed_kmh", 5), 0);
  assert.equal(at("speed_kmh", 25), 50);
  assert.equal(at("speed_kmh", 50), 90);
  assert.equal(at("speed_kmh", 110), 0);
  assert.equal(at("course_deg", 30), 0);
  assert.equal(at("course_deg", 40), 90);
  assert.equal(at("fix", 59.5), 1);
  assert.equal(at("fix", 60), 0);
  assert.equal(at("fix", 74.5), 0);
  assert.equal(at("fix", 75), 1);
  assert.equal(at("lat_deg", 100), 37.7749);
  assert.deepEqual(windows, [["drop", [[55, 60]]]]);
  drives(s, "sensors/uart/gps_nmea.yaml");
  // the GPS sentences follow: no fix in the tunnel, a fix and 90 km/h after it
  const gps = jsonOf("sensors/uart/gps_nmea.yaml");
  const rmc = (t) => sd.preview(gps, { ...valuesAt(s, t / STEP), sentences: 1 }, { tMs: 1000 }).text;
  assert.match(rmc(65), /^\$GPRMC,[0-9.]+,V,/);
  assert.match(rmc(80), /^\$GPRMC,[0-9.]+,A,.*,48\.596,90\.00,/);
});

test("pressure_drop", () => {
  const { s, at, windows } = sample("stimuli/pressure_drop.yaml");
  for (let t = 0; t < 30; t += STEP) assert.ok(Math.abs(at("pressure_bar", t) - 6) < 0.1, `noise at ${t} s`);
  assert.equal(at("pressure_bar", 33), 1.5);
  assert.equal(at("pressure_bar", 49.5), 1.5);
  assert.equal(at("pressure_bar", 60), 3.75);
  assert.equal(at("pressure_bar", 90), 6);
  assert.deepEqual(windows, [["open", [[80, 85]]]]);
  const tx = "sensors/analog/pressure_4_20ma.yaml";
  drives(s, tx);
  const mA = sd.preview(jsonOf(tx), valuesAt(s, 40 / STEP)).value;
  assert.ok(Math.abs(mA - 6.4) < 1e-9, "1.5 bar is 6.4 mA");
});
