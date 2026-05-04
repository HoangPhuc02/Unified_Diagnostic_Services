---
layout: default
title: "Advanced C++ – Phần 11: Data Types & Access Control trong Embedded"
description: "Kiểu dữ liệu cố định kích thước (cstdint), bit-field register map, constexpr, volatile, và phân chia public/private/protected cho embedded driver class."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-data-types-access/
tags: [cpp, data-types, cstdint, bit-field, constexpr, volatile, access-control, embedded]
---

# Advanced C++ – Phần 11: Data Types & Access Control trong Embedded

> **Mục tiêu bài này:** Chọn đúng kiểu dữ liệu để code portable trên mọi MCU, ánh xạ hardware register bằng bit-field struct, dùng `constexpr` tiết kiệm RAM, và phân chia trách nhiệm rõ ràng trong driver class.
>
> **Series kỹ thuật nền tảng Embedded C++:**  
> → [Phần 9: `unique_ptr` trong Embedded](/adaptive-cpp/cpp-unique-ptr-embedded/)  
> → [Phần 10: Template trong Embedded](/adaptive-cpp/cpp-template-embedded/)  
> → **Phần 11 (bài này): Data Types & Access Control**
>
> **Yêu cầu trước:** Quen với class, struct, và con trỏ trong C/C++.  
> **Compiler:** GCC-ARM ≥ 11, cờ `-std=c++17`

---

## 3.1 Kiểu dữ liệu trong Embedded – Tại sao `int` là nguy hiểm

```
Vấn đề: kích thước của int phụ thuộc vào platform!

┌────────────────┬──────────┬──────────┬──────────┬──────────┐
│    Platform    │  char    │  short   │   int    │   long   │
├────────────────┼──────────┼──────────┼──────────┼──────────┤
│  AVR (8-bit)   │  8-bit   │  16-bit  │  16-bit  │  32-bit  │
│  ARM Cortex-M  │  8-bit   │  16-bit  │  32-bit  │  32-bit  │
│  x86-64 Linux  │  8-bit   │  16-bit  │  32-bit  │  64-bit  │
└────────────────┴──────────┴──────────┴──────────┴──────────┘

Code dùng int để lưu ADC 12-bit (max 4095):
  → Trên AVR: int = 16-bit → ổn
  → Trên ARM: int = 32-bit → lãng phí 2 byte, tính sai nếu có shift/mask
```

**Giải pháp:** dùng `<cstdint>` – kiểu dữ liệu với kích thước cố định trên mọi platform:

```cpp
#include <cstdint>   // BẮT BUỘC trong mọi file embedded C++

// ─── Kiểu unsigned (không âm) – dùng cho: địa chỉ, size, flags ──
uint8_t  byte_val   = 255;      // 0 → 255           (8-bit,  1 byte)
uint16_t word_val   = 65535;    // 0 → 65535          (16-bit, 2 byte)
uint32_t dword_val  = 0xDEAD;   // 0 → 4,294,967,295  (32-bit, 4 byte)
uint64_t qword_val  = 0ULL;     // 0 → 18 quintillion (64-bit, 8 byte) – tránh trên MCU nhỏ

// ─── Kiểu signed (có âm) – dùng cho: nhiệt độ, tốc độ, offset ───
int8_t   temp_offset = -10;     // -128 → +127
int16_t  temperature = -4000;   // -32768 → +32767    (x10: -40.00°C)
int32_t  position    = -100000; // -2^31 → +2^31-1

// ─── Kiểu đặc biệt ────────────────────────────────────────────
bool     flag        = true;    // chỉ true/false (1 byte trên hầu hết ABI)
float    voltage     = 3.3f;    // 32-bit IEEE 754 – có sẵn FPU trên Cortex-M4/M7
// double voltage   = 3.3;      // 64-bit – Cortex-M4 không có FPU 64-bit → CHẬM!

// ─── Kiểu cho địa chỉ và offset ──────────────────────────────
// size_t: unsigned, đủ lớn để chứa kích thước bộ nhớ bất kỳ
std::size_t buf_size = sizeof(uint32_t) * 16;   // luôn đúng trên mọi platform

// ptrdiff_t: signed, dùng cho hiệu của 2 pointer
ptrdiff_t offset = ptr_end - ptr_start;
```

---

## 3.2 Bit-fields và Struct Packing – Tối ưu bộ nhớ cho Register Map

```cpp
#pragma pack(push, 1)   // yêu cầu compiler KHÔNG thêm padding byte

// Struct ánh xạ trực tiếp lên Control Register của peripheral
// Mỗi bit/group bit tương ứng với một field trong hardware datasheet
struct __attribute__((packed)) UartControlReg {
    // Bit 0: UART Enable (1 = enable, 0 = disable)
    uint8_t enable        : 1;   // chiếm 1 bit

    // Bit 1: Parity Enable
    uint8_t parity_enable : 1;   // chiếm 1 bit

    // Bit 2: Parity Select (0 = even, 1 = odd)
    uint8_t parity_odd    : 1;   // chiếm 1 bit

    // Bit 3-4: Stop bits (00=1stop, 01=1.5stop, 10=2stop)
    uint8_t stop_bits     : 2;   // chiếm 2 bit

    // Bit 5-6: Word length (00=5, 01=6, 10=7, 11=8)
    uint8_t word_length   : 2;   // chiếm 2 bit

    // Bit 7: Reserved
    uint8_t reserved      : 1;   // chiếm 1 bit

    // Tổng: 8 bit = 1 byte ← compact, không padding
};

#pragma pack(pop)

// ─── Cách dùng: đọc/ghi register thông qua struct ─────────────
// volatile: báo compiler "giá trị có thể thay đổi ngoài tầm nhìn của code"
// UART1_CR là địa chỉ physical của control register trên MCU
volatile UartControlReg* uart1_cr =
    reinterpret_cast<volatile UartControlReg*>(0x40011000);
//  ↑ cast địa chỉ physical thành pointer đến struct

// Cấu hình UART1: enable, 8N1 (8-bit data, no parity, 1 stop bit)
uart1_cr->enable        = 1;   // bật UART
uart1_cr->parity_enable = 0;   // không parity
uart1_cr->stop_bits     = 0;   // 1 stop bit
uart1_cr->word_length   = 3;   // 8-bit data (11 binary = 3)

// Đọc trạng thái
if (uart1_cr->enable) {
    // UART đang hoạt động
}
```

> **⚠️ Cạm bẫy phổ biến:** Quên `volatile` khi trỏ vào hardware register. Compiler có thể cache giá trị vào register CPU và không đọc lại từ bộ nhớ → code đọc giá trị cũ mãi mãi.

---

## 3.3 Access Control trong Class – Ứng dụng cho Embedded Driver

**Quy tắc thiết kế driver:**

```
┌─────────────────────────────────────────────────────────────┐
│  Phân chia trách nhiệm trong Embedded Driver Class          │
│                                                             │
│  PUBLIC  → Giao diện dành cho application layer            │
│            (init, read, write, reset)                       │
│            Ổn định, ít thay đổi                             │
│                                                             │
│  PRIVATE → Implementation details                           │
│            (register addresses, internal state,             │
│            hardware-specific helpers)                       │
│            Có thể thay đổi thoải mái                        │
│                                                             │
│  PROTECTED → Extension points cho derived driver            │
│              (base class driver → specialized variant)      │
└─────────────────────────────────────────────────────────────┘
```

```cpp
// ─── i2c_sensor.hpp – I2C Sensor Driver với access control ────
#include <cstdint>

class I2CSensorDriver {
public:
    // ═══════════════════════════════════════════════════════
    // PUBLIC INTERFACE – Application layer chỉ dùng các hàm này
    // ═══════════════════════════════════════════════════════

    // Constructor: địa chỉ I2C 7-bit của sensor
    explicit I2CSensorDriver(uint8_t i2c_addr);

    // Destructor: giải phóng mutex, reset hardware
    ~I2CSensorDriver();

    // Khởi tạo sensor: verify WHO_AM_I register, cấu hình ODR
    // Trả true nếu sensor phản hồi đúng
    bool init();

    // Đọc nhiệt độ, trả về giá trị x100 (tránh float)
    // Ví dụ: 2573 = 25.73°C
    int16_t read_temperature_x100();

    // Đọc độ ẩm, trả về x100
    // Ví dụ: 6050 = 60.50%RH
    uint16_t read_humidity_x100();

    // Trigger measurement thủ công (nếu sensor ở one-shot mode)
    void trigger_measurement();

protected:
    // ═══════════════════════════════════════════════════════
    // PROTECTED – Dành cho derived class (ví dụ: sensor có heat compensation)
    // ═══════════════════════════════════════════════════════

    // Đọc raw ADC value trực tiếp từ register (chưa convert)
    // Derived class có thể override để thêm calibration
    virtual int32_t read_raw_temperature();
    virtual int32_t read_raw_humidity();

    uint8_t  i2c_addr_;   // địa chỉ I2C – derived class cần biết

private:
    // ═══════════════════════════════════════════════════════
    // PRIVATE – Application layer KHÔNG được biết chi tiết này
    // ═══════════════════════════════════════════════════════

    // Đọc/ghi register I2C (low-level, blocking)
    bool write_register(uint8_t reg_addr, uint8_t value);
    bool read_register (uint8_t reg_addr, uint8_t& out_value);

    // Đọc nhiều byte liên tiếp (burst read) – tối ưu cho dữ liệu 16-bit
    bool read_registers(uint8_t start_reg, uint8_t* buf, uint8_t len);

    // Địa chỉ các register (từ datasheet sensor, chỉ valid cho chip này)
    static constexpr uint8_t REG_WHO_AM_I = 0x0F;   // ID register
    static constexpr uint8_t REG_CTRL1    = 0x20;   // control register 1
    static constexpr uint8_t REG_TEMP_L   = 0x2A;   // temperature LSB
    static constexpr uint8_t REG_TEMP_H   = 0x2B;   // temperature MSB
    static constexpr uint8_t EXPECTED_WHO = 0xBC;   // giá trị mong đợi WHO_AM_I

    // Trạng thái nội bộ
    bool initialized_ {false};  // true sau khi init() thành công
    bool measuring_   {false};  // true khi đang có measurement in-progress

    // Calibration offset (tính bằng 0.01°C)
    // Được tính khi init() dựa trên trimming register của chip
    int16_t temp_offset_x100_ {0};
};
```

```cpp
// ─── i2c_sensor.cpp – Implementation ─────────────────────────
bool I2CSensorDriver::init() {
    // Kiểm tra WHO_AM_I register – verify đúng chip được gắn
    uint8_t who_am_i = 0;
    if (!read_register(REG_WHO_AM_I, who_am_i)) {
        return false;   // I2C timeout → sensor không phản hồi
    }
    if (who_am_i != EXPECTED_WHO) {
        return false;   // sai chip (địa chỉ I2C nhầm, hoặc chip khác)
    }

    // Cấu hình CTRL1: ODR=1Hz, block data update = true
    if (!write_register(REG_CTRL1, 0x87)) {
        return false;
    }

    initialized_ = true;
    return true;
}

int16_t I2CSensorDriver::read_temperature_x100() {
    if (!initialized_) return INT16_MIN;  // sentinel: chưa init

    // Đọc 2 byte liên tiếp (LSB trước, MSB sau)
    uint8_t raw[2] = {};
    read_registers(REG_TEMP_L, raw, 2);

    // Ghép 2 byte thành int16_t (two's complement)
    int16_t raw_temp = static_cast<int16_t>((raw[1] << 8) | raw[0]);

    // Convert: raw_temp / 16 = °C, nhân 100 để tránh float
    // raw_temp = 409 → 409/16 = 25.5625°C → trả về 2556 (25.56°C)
    int16_t celsius_x100 = static_cast<int16_t>((raw_temp * 100) / 16);

    return celsius_x100 + temp_offset_x100_;  // áp dụng calibration
}

// private helper – KHÔNG expose ra ngoài
bool I2CSensorDriver::write_register(uint8_t reg_addr, uint8_t value) {
    // Tạo I2C transaction: [start][addr+W][reg][value][stop]
    uint8_t buf[2] = {reg_addr, value};
    return HAL_I2C_Master_Transmit(&hi2c1, i2c_addr_ << 1, buf, 2, 10) == HAL_OK;
    //                                                       ↑ 7-bit addr → 8-bit
    //                                                              ↑ timeout 10ms
}
```

---

## 3.4 `const` và `constexpr` – Compile-time Constants trong Embedded

```cpp
// ─── Sự khác biệt quan trọng ─────────────────────────────────

// #define – không có kiểu, không có scope, không thể debug
#define MAX_SENSORS 8          // BAD in C++: preprocessor replace trước khi compile

// const – có kiểu, có scope, nhưng có thể ở RAM hoặc Flash
const uint8_t kMaxSensors = 8; // có thể bị đặt vào RAM nếu compiler không optimize

// constexpr – CHẮC CHẮN tính tại compile-time, vào Flash (read-only)
constexpr uint8_t  kMaxSensors    = 8;
constexpr uint32_t kSystemClockHz = 168'000'000; // 168 MHz (C++14: digit separator)
constexpr float    kVref          = 3.3f;         // reference voltage

// ─── constexpr function – tính giá trị tại compile-time ──────
// Nếu argument là compile-time constant → kết quả cũng là compile-time constant
constexpr uint32_t ms_to_ticks(uint32_t ms) {
    // SysTick = 1ms per tick (phổ biến trong FreeRTOS)
    return ms * (kSystemClockHz / 1000);
}

// Sử dụng:
constexpr uint32_t kWatchdogTimeout = ms_to_ticks(5000);  // 5 giây
// kWatchdogTimeout được tính tại COMPILE-TIME: 840'000'000
// Không có phép tính nào tại runtime!

// ─── Array size từ constexpr ──────────────────────────────────
constexpr std::size_t kRxBufSize = 256;
uint8_t rx_buffer[kRxBufSize];  // OK: kích thước biết lúc compile
// Compiler biết chính xác 256 byte stack cần cấp phát → stack analysis đúng
```

> **💡 Điểm mấu chốt:** Trong embedded, **Flash thường nhiều hơn RAM** (ví dụ: STM32F4 có 1MB Flash, 192KB RAM). `constexpr` đảm bảo hằng số nằm trong Flash (read-only section), không tiêu tốn RAM quý giá.

---

## 3.5 Tổng hợp: Class kết hợp `unique_ptr` + Template + Data Types

```cpp
// ─── sensor_manager.hpp – Quản lý nhiều sensor bằng 3 kỹ thuật ─
#include <memory>
#include <cstdint>
#include <array>    // std::array – wrapper an toàn cho C array

// Template: SensorT là loại sensor, MAX_N là số lượng tối đa
template<typename SensorT, std::size_t MAX_N>
class SensorManager {
public:
    // Kiểu trả về: index của sensor vừa thêm, hoặc INVALID_IDX nếu đầy
    static constexpr uint8_t INVALID_IDX = 0xFF;

    // Thêm sensor mới: forward arguments đến constructor của SensorT
    // Trả về index (0-based) hoặc INVALID_IDX
    template<typename... Args>
    uint8_t add_sensor(Args&&... args) {
        if (count_ >= MAX_N) return INVALID_IDX;   // đã đầy

        // make_unique: tạo SensorT với arguments truyền vào
        // std::forward: perfect forwarding – giữ nguyên value category
        sensors_[count_] = std::make_unique<SensorT>(
            std::forward<Args>(args)...
        );

        return static_cast<uint8_t>(count_++);
    }

    // Đọc dữ liệu từ sensor theo index – type-safe
    bool read(uint8_t idx, int16_t& out_value) const {
        if (idx >= count_ || !sensors_[idx]) return false;

        // Gọi read_value() – đây là virtual call nếu SensorT có vtable
        out_value = sensors_[idx]->read_value();
        return true;
    }

    // Khởi tạo tất cả sensor
    bool init_all() {
        for (std::size_t i = 0; i < count_; ++i) {
            if (sensors_[i] && !sensors_[i]->init()) {
                return false;   // một sensor fail → báo lỗi
            }
        }
        return true;
    }

    uint8_t sensor_count() const { return static_cast<uint8_t>(count_); }

private:
    // std::array: kích thước cố định tại compile-time, không heap
    // unique_ptr: quản lý lifetime tự động, nullptr nếu chưa được thêm
    std::array<std::unique_ptr<SensorT>, MAX_N> sensors_;
    std::size_t count_ {0};  // số sensor hiện có
};
```

```cpp
// ─── main.cpp – Sử dụng SensorManager ────────────────────────
#include "sensor_manager.hpp"
#include "i2c_sensor.hpp"

int main() {
    // SensorManager cho I2CSensorDriver, tối đa 4 sensor
    // Toàn bộ nằm trên stack/BSS: array<unique_ptr<I2CSensorDriver>, 4>
    SensorManager<I2CSensorDriver, 4> manager;

    // Thêm sensor: arguments forwarded đến I2CSensorDriver(uint8_t i2c_addr)
    uint8_t idx0 = manager.add_sensor(0x44);  // sensor 1 tại địa chỉ 0x44
    uint8_t idx1 = manager.add_sensor(0x45);  // sensor 2 tại địa chỉ 0x45

    // Khởi tạo tất cả
    if (!manager.init_all()) {
        // Xử lý lỗi: bật LED lỗi, ghi vào fault log
        fault_handler(FAULT_SENSOR_INIT);
        return -1;
    }

    // Vòng lặp chính: đọc dữ liệu
    while (true) {
        int16_t temp_x100;

        if (manager.read(idx0, temp_x100)) {
            // temp_x100 = 2573 → 25.73°C
            uint16_t display_val = static_cast<uint16_t>(temp_x100);
            send_to_dashboard(CAN_ID_TEMP_SENSOR1, display_val);
        }

        vTaskDelay(pdMS_TO_TICKS(100));  // FreeRTOS: đợi 100ms
    }

    // Khi main() kết thúc (reboot/shutdown):
    // manager bị huỷ → unique_ptr trong array bị huỷ
    // → destructor ~I2CSensorDriver() chạy cho từng sensor
    // → I2C peripheral được release đúng cách
}
```

---

## Bảng tóm tắt toàn series (Phần 9 – 11)

| Kỹ thuật | Vấn đề giải quyết | Bối cảnh sử dụng |
|---|---|---|
| `unique_ptr<T>` | Memory leak khi quản lý tài nguyên heap | Driver object, buffer động, RTOS handle |
| `unique_ptr<T[]>` | Leak khi dùng `new[]` cho mảng | DMA buffer, RX/TX buffer động |
| Custom deleter | Giải phóng tài nguyên không phải heap | HAL handle, file descriptor, mutex |
| `std::move()` | Chuyển quyền sở hữu an toàn | Truyền driver vào class container |
| Function template | Tái sử dụng logic cho nhiều kiểu số | `clamp`, `map`, `serialize`, math helpers |
| Class template (NTTP) | Container kích thước cố định, không heap | Ring buffer, queue, stack cho ISR |
| Template specialization | Xử lý kiểu đặc biệt không dùng được generic | `bool`, `float` serialization |
| `static_assert` | Bắt lỗi kiểu sai tại compile-time | Validate template arguments |
| `uint8_t`/`uint16_t`/... | Size độc lập với platform | Mọi biến lưu giá trị MCU register/ADC |
| Bit-field struct | Ánh xạ chính xác lên hardware register | Control/status register, CAN frame, PDU |
| `constexpr` | Đưa tính toán về compile-time, vào Flash | Timeout, baud rate, buffer size, LUT |
| `public`/`private` | Ẩn implementation, ổn định API | Mọi class driver trong embedded |
| `protected` | Extension point cho derived driver | Base sensor class → specialized variant |
| `volatile` | Ngăn compiler cache giá trị hardware register | MMIO register, biến dùng trong ISR |
