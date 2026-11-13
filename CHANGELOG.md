# Changelog

The library's releases, tagged `vX.Y.Z`. A sensor's own `version` changes when its behavior does.

## 0.1.1

- Sensors: `tmp117`, `ina219` (I2C word registers), `sht3x` and `scd4x` (16-bit commands in any
  high byte), each with a test that reads it back the way the vendor's driver does. They need
  firmware 3.10.2 or later.
- `tools/engine` from benchpod-firmware e95ff6a (word registers and the command map).

## 0.1.0

The first release, for format 1.

- Sensors: `bme280`, `bmp280`, `mpu6050`, `sht4x` and `gps_nmea` (the pod's former built-in
  models, now definitions), and new `lis3dh` and `lis3dh_fifo` (SPI), `mhz19b` (UART),
  `ntc_10k_divider` and `pressure_4_20ma` (analog).
- Stimuli: `temperature_ramp_fault`, `gps_drive`, `pressure_drop`.
- A test per new sensor that reads it back the way the vendor's driver does, and checks of every
  file with the pod's engine (`tools/engine`, from benchpod-firmware 6eb0d64).
- `library.json`, the index clients read.
