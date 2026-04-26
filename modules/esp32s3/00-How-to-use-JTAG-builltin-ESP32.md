---
layout: default
title: "ESP32-S3 – How to use Built-in JTAG Debugger"
nav_exclude: true
module: true
category: esp32s3
tags: [esp32s3, jtag, platformio, debug]
description: "Hướng dẫn cấu hình JTAG built-in của ESP32-S3 với PlatformIO và Zadig trên Windows."
permalink: /esp32s3-jtag/
---

# ESP32-S3 – How to use Built-in JTAG Debugger

> Hướng dẫn cấu hình JTAG debugger tích hợp sẵn trên ESP32-S3 với PlatformIO và Zadig (Windows).

Connect the cable to the native USB of the ESP32-S3, it is through this port that the ESP recording and debugging will be done.


### **Step 1:**
Download and open ZADIG, Options, List All Devices, Select “USB Jtag/serial debug unit (interface 0)”, change the current driver to “USB Serial (CDC)” and install by clicking the “Update Driver” button on the Zadig.****

![Select_device](/assets/images/esp32s3/Select_JTAG_device.png)


![Change_interface0_to_usbCDC](/assets/images/esp32s3/Change_interface0_to_usbCDC.png)

### **Step 2:**
Still in ZADIG, select “USB Jtag/serial debug unit (interface 2)”, change the current driver to “WinUSB” and install by clicking the “Update Driver” button in Zadig.

![Change_interface2_to_WinUsb](/assets/images/esp32s3/Change_interface2_to_WinUsb.png)

### **Step 3:**
Open the Windows device manager to find out which ports to configure, in my case COM18 is JTAG(“USB-JTAG/serial debug unit(Interface 0)”) and COM21 is the standard serial of the ESP32 board- S3(“USB-Enhanced-SERIAL CH323”)
![alt text](/assets/images/esp32s3/COM_example.png)

### **Step 4:**
In Platformio, configure the Platformio.ini file. In the attached file, there is the port COM14(or the same port that appears in the Windows device manager as “USB-JTAG/serial debug unit(Interface 0)” for the JTAG Debugger, and COM10(or the same port that in Windows device manager appears as “USB-Enhanced-SERIAL CH323”) for the serial monitor. It is through the debugger that the code is also uploaded. This way, the Platformio.ini file would be configured as follows:

```c
[env:esp32-s3-devkitc-1]
platform = https://github.com/platformio/platform-espressif32.git   ;Fech lastest support for ESP32
;platform = espressif32
board = esp32-s3-devkitc-1    ;ESP32-S3
framework = arduino
upload_speed = 2000000     ;ESP32S3 USB-Serial Converter maximum 2000000bps
upload_port = COM14
monitor_speed = 115200
monitor_port = COM10
debug_tool = esp-builtin
debug_init_break = break setup
build_type = debug      ;build in debug mode instead of release mode
```

https://community.platformio.org/t/how-to-use-jtag-built-in-debugger-of-the-esp32-s3-in-platformio/36042