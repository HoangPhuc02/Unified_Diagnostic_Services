---
layout: default
title: "ESP32-S3 - How to Use Built-in JTAG Debugger"
nav_exclude: true
module: true
category: esp32s3
tags: [esp32, jtag, platformio, debugging, embedded]
description: "Step-by-step guide to set up the ESP32-S3 built-in JTAG debugger with PlatformIO on Windows using Zadig driver installation."
permalink: /esp32s3/esp32s3-jtag/
---

# ESP32-S3 -- How to Use the Built-in JTAG Debugger

> Connect the **native USB** port of the ESP32-S3 to your PC. All flashing and debugging traffic goes through this port.

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| [Zadig](https://zadig.akeo.ie/) | USB driver installer |
| [PlatformIO](https://platformio.org/) | IDE / build system |
| Windows Device Manager | Verify COM port assignments |

---

## Step 1 -- Install CDC Driver for Interface 0

Open **Zadig** and follow:

1. Go to **Options -> List All Devices**
2. Select **USB JTAG/serial debug unit (Interface 0)**
3. Change the driver to **USB Serial (CDC)**
4. Click **Update Driver**

<div style="display:flex; flex-wrap:wrap; gap:12px; margin:1rem 0;">
  <img src="{{ '/assets/images/esp32s3/Select_JTAG_device.png' | relative_url }}" alt="Select JTAG device in Zadig" style="max-width:100%; border:1px solid var(--line); border-radius:8px;">
  <img src="{{ '/assets/images/esp32s3/Change_interface0_to_usbCDC.png' | relative_url }}" alt="Change Interface 0 to USB Serial CDC" style="max-width:100%; border:1px solid var(--line); border-radius:8px;">
</div>

---

## Step 2 -- Install WinUSB Driver for Interface 2

Still in **Zadig**:

1. Select **USB JTAG/serial debug unit (Interface 2)**
2. Change the driver to **WinUSB**
3. Click **Update Driver**

<img src="{{ '/assets/images/esp32s3/Change_interface2_to_WinUsb.png' | relative_url }}" alt="Change Interface 2 to WinUSB" style="max-width:100%; border:1px solid var(--line); border-radius:8px; margin:0.5rem 0;">

---

## Step 3 -- Find the COM Ports in Device Manager

Open **Windows Device Manager** and locate the two ports:

| Port | Device name | Role |
|------|-------------|------|
| e.g. COM18 | USB-JTAG/serial debug unit (Interface 0) | JTAG debugger / flash |
| e.g. COM21 | USB-Enhanced-SERIAL CH343 | Serial monitor |

> The exact COM numbers will differ on your machine -- use whatever Device Manager shows.

<img src="{{ '/assets/images/esp32s3/COM_example.png' | relative_url }}" alt="COM port assignments in Windows Device Manager" style="max-width:100%; border:1px solid var(--line); border-radius:8px; margin:0.5rem 0;">

---

## Step 4 -- Configure platformio.ini

Replace the COM port numbers below with the ones you found in Step 3:

```ini
[env:esp32-s3-devkitc-1]
platform  = https://github.com/platformio/platform-espressif32.git  ; latest ESP32 support
board     = esp32-s3-devkitc-1
framework = arduino

; Upload & monitor
upload_speed = 2000000        ; max speed for ESP32-S3 USB-Serial
upload_port  = COM18          ; JTAG interface port (Interface 0)
monitor_speed = 115200
monitor_port  = COM21         ; serial monitor port

; Debugger
debug_tool        = esp-builtin
debug_init_break  = break setup
build_type        = debug
```

> **Tip:** Flashing is done through the JTAG port (`upload_port`), not the serial port.

---

## References

- [PlatformIO Community -- ESP32-S3 built-in JTAG](https://community.platformio.org/t/how-to-use-jtag-built-in-debugger-of-the-esp32-s3-in-platformio/36042)