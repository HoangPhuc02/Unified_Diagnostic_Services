---
layout: default
title: "Advanced C++ – Phần 9: unique_ptr trong Embedded"
description: "Hiểu sâu unique_ptr – cơ chế ownership, custom deleter, move semantics – và ứng dụng thực tế quản lý tài nguyên trên MCU/RTOS không bị memory leak."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-unique-ptr-embedded/
tags: [cpp, unique-ptr, smart-pointer, raii, ownership, embedded, stm32]
---

# Advanced C++ – Phần 9: `unique_ptr` trong Embedded

> **Mục tiêu bài này:** Nắm vững cơ chế sở hữu độc quyền của `unique_ptr`, tránh memory leak trên MCU có RAM hạn chế, và biết dùng custom deleter cho tài nguyên phần cứng.
>
> **Series kỹ thuật nền tảng Embedded C++:**  
> → **Phần 9 (bài này): `unique_ptr`**  
> → [Phần 10: Template trong Embedded](/adaptive-cpp/cpp-template-embedded/)  
> → [Phần 11: Data Types & Access Control](/adaptive-cpp/cpp-data-types-access/)
>
> **Yêu cầu trước:** Quen với con trỏ C, class/struct C++ cơ bản, biết `new`/`delete`.  
> **Compiler:** GCC-ARM ≥ 11 hoặc AVR-GCC ≥ 12, cờ `-std=c++17`

---

## Toàn cảnh 3 bài trong series

```
┌──────────────────────────────────────────────────────────────┐
│         Embedded C++ – 3 kỹ thuật nền tảng                  │
├──────────────┬─────────────────────┬────────────────────────┤
│  unique_ptr  │      Template       │  Data Type & Access    │
│  (bài này)   │      (bài 10)       │       (bài 11)         │
│              │                     │                        │
│ Quản lý      │ Tái sử dụng code   │ Đúng kiểu → đúng size  │
│ tài nguyên   │ không copy-paste   │ Đúng access → an toàn  │
│ an toàn      │                     │                        │
│ Không heap   │ Compile-time poly   │ No padding waste       │
│ fragmentation│ morphism            │ Register-width aware   │
└──────────────┴─────────────────────┴────────────────────────┘
```

---

## 1.1 Vấn đề raw pointer trong Embedded

Trong firmware MCU, việc cấp phát động (`new`/`malloc`) tiềm ẩn nhiều rủi ro:

```cpp
// BAD – quản lý thủ công, dễ leak khi có exception / early return
void init_sensor() {
    auto* sensor = new TemperatureSensor(0x48);   // cấp phát trên heap

    if (!sensor->selfTest()) {
        // Quên delete → leak 8-16 byte mỗi lần gọi hàm này
        return;    // ← LEAK! sensor không bao giờ được giải phóng
    }

    sensor->start();
    // ... 30 dòng code sau ...
    delete sensor;   // chỉ đến đây mới giải phóng – và dễ bị thiếu
}
```

**Hậu quả trên MCU:**
- RAM bị "mòn" dần → hệ thống crash sau vài giờ/ngày
- Rất khó debug bằng `printf` hay debugger thông thường
- Safety-critical system không chấp nhận hành vi này

---

## 1.2 `unique_ptr` là gì – Mental Model

```
┌─────────────────────────────────────────────────────────────┐
│  unique_ptr<T>                                              │
│                                                             │
│  ┌────────────┐         ┌────────────────────────────────┐ │
│  │ unique_ptr │ owns ──▶│  T object trên heap            │ │
│  │ (stack)    │         │  (hoặc custom allocator)       │ │
│  └────────────┘         └────────────────────────────────┘ │
│        │                                                    │
│        │ khi ra khỏi scope:                                 │
│        ▼                                                    │
│  destructor gọi → delete object tự động                    │
│                                                             │
│  KHÔNG THỂ copy (unique = duy nhất một chủ sở hữu)        │
│  CÓ THỂ move (chuyển quyền sở hữu)                        │
└─────────────────────────────────────────────────────────────┘
```

**3 quy tắc vàng của `unique_ptr`:**
1. **Unique**: tại mỗi thời điểm, chỉ đúng 1 `unique_ptr` trỏ đến object
2. **Automatic**: khi `unique_ptr` bị huỷ → object bị `delete` ngay lập tức
3. **Zero-cost**: kích thước = 1 raw pointer, không overhead runtime

---

## 1.3 Cú pháp cơ bản – Giải thích từng dòng

```cpp
#include <memory>   // header chứa unique_ptr, make_unique

// ─── Cách tạo unique_ptr ──────────────────────────────────────
// make_unique<T>(args...) – cách ĐƯỢC KHUYẾN NGHỊ
//   - Không dùng new trực tiếp → không bao giờ có "new" lơ lửng
//   - Exception-safe: nếu constructor throw, bộ nhớ được giải phóng ngay
auto ptr1 = std::make_unique<int>(42);
//   ↑ ptr1 kiểu unique_ptr<int>, trỏ đến int có giá trị 42

// ─── Dereference – lấy giá trị ───────────────────────────────
*ptr1 = 100;              // giống raw pointer: *ptr để access value
std::cout << *ptr1;       // in ra 100

// ─── Truy cập member của object ──────────────────────────────
auto sensor = std::make_unique<TemperatureSensor>(0x48);
sensor->start();          // operator-> như raw pointer
sensor->read();

// ─── get() – lấy raw pointer (KHÔNG chuyển ownership) ────────
// Dùng khi API C-style cần raw pointer
uint8_t* raw = ptr1.get();   // raw chỉ "mượn", ptr1 vẫn là chủ sở hữu
// KHÔNG delete raw!

// ─── reset() – huỷ object hiện tại, optionally gán mới ────────
ptr1.reset();             // delete object cũ, ptr1 = nullptr
ptr1.reset(new int(99));  // delete object cũ, trỏ đến object mới

// ─── release() – từ bỏ ownership, trả về raw pointer ─────────
int* raw2 = ptr1.release();  // ptr1 = nullptr, raw2 là chủ sở hữu
// Bây giờ PHẢI tự delete raw2!
delete raw2;
```

---

## 1.4 Ownership – Chuyển quyền sở hữu bằng `move`

```cpp
// unique_ptr KHÔNG thể copy – biên dịch sẽ báo lỗi ngay:
auto p1 = std::make_unique<int>(10);
// auto p2 = p1;   ← LỖI BIÊN DỊCH: copy constructor bị xóa (deleted)
// Lỗi: call to deleted constructor of 'std::unique_ptr<int>'

// Nhưng CÓ THỂ MOVE – chuyển toàn bộ ownership:
auto p2 = std::move(p1);
// Sau move:
//   p2 → trỏ đến object (là chủ sở hữu mới)
//   p1 → nullptr (đã từ bỏ ownership)

// Ý nghĩa: "di chuyển nhà" thay vì "sao chép nhà"
// Compiler bắt buộc bạn phải explicit dùng std::move
// → Không bao giờ vô tình có 2 chủ sở hữu cho 1 object
```

---

## 1.5 Ứng dụng Embedded – Driver quản lý UART với `unique_ptr`

**Tình huống:** MCU STM32 có 3 UART. Mỗi UART được quản lý bởi một driver object. Cần khởi tạo, dùng và tự động dọn dẹp khi scope kết thúc.

```cpp
// ─── uart_driver.hpp ─────────────────────────────────────────
#include <cstdint>

// Đại diện cho một UART peripheral trên MCU
class UartDriver {
public:
    // Constructor: cấu hình UART với baud rate và số hiệu cổng
    // port_num: 1, 2, 3 (USART1, USART2, USART3 trên STM32)
    UartDriver(uint8_t port_num, uint32_t baud_rate);

    // Destructor: tắt clock UART, giải phóng DMA channel nếu có
    ~UartDriver();

    // Gửi dữ liệu – trả về số byte đã gửi thực sự
    uint16_t transmit(const uint8_t* data, uint16_t len);

    // Nhận dữ liệu vào buffer – non-blocking
    uint16_t receive(uint8_t* buffer, uint16_t max_len);

private:
    uint8_t  port_num_;    // số UART (1-3)
    uint32_t baud_rate_;   // baud rate: 9600, 115200...
    bool     initialized_; // trạng thái khởi tạo
};
```

```cpp
// ─── main.cpp ────────────────────────────────────────────────
#include <memory>
#include "uart_driver.hpp"

// Hàm khởi tạo và test UART1 – không cần lo giải phóng memory
bool setup_uart1_communication() {
    // make_unique gọi constructor UartDriver(1, 115200)
    // Object được tạo trên HEAP của MCU (FreeRTOS heap hoặc system heap)
    auto uart1 = std::make_unique<UartDriver>(1, 115200);
    //  ↑ uart1 kiểu: unique_ptr<UartDriver>

    // Giả sử selfTest() kiểm tra loopback nội bộ
    // Nếu false → hàm return false, uart1 bị huỷ tự động
    if (!uart1->selfTest()) {
        return false;   // ← KHÔNG LEAK: destructor UartDriver chạy ngay đây
    }

    // Chuẩn bị frame handshake
    const uint8_t handshake[] = {0xAA, 0x55, 0x01, 0x00};
    uart1->transmit(handshake, sizeof(handshake));

    uint8_t response[4] = {};
    const uint16_t rx_count = uart1->receive(response, 4);

    if (rx_count != 4 || response[0] != 0xAA) {
        return false;   // ← KHÔNG LEAK: destructor chạy tại đây
    }

    return true;
    // ← uart1 ra khỏi scope → destructor ~UartDriver() chạy TỰ ĐỘNG
    //   Peripheral UART1 được tắt clock, DMA được giải phóng
}
```

> **💡 Điểm mấu chốt:** `unique_ptr` biến "nhớ gọi `delete`" thành vấn đề của **compiler**, không phải của lập trình viên. Trên MCU có RAM hạn chế (16–512 KB), đây là sự khác biệt giữa firmware ổn định và firmware crash sau 6 giờ.

---

## 1.6 `unique_ptr` với Custom Deleter – Giải phóng tài nguyên không phải heap

Trong embedded, không phải tài nguyên nào cũng giải phóng bằng `delete`. Có thể là: tắt peripheral, giải phóng DMA, xóa mutex handle của RTOS...

```cpp
// ─── Tình huống: I2C handle của FreeRTOS/HAL ─────────────────

// HAL_I2C_Handle_t* phải được giải phóng bằng HAL_I2C_DeInit()
// KHÔNG phải delete thông thường

// Định nghĩa custom deleter dưới dạng lambda
// [](HAL_I2C_Handle_t* h) { ... } là hàm huỷ tùy chỉnh
auto i2c_deleter = [](HAL_I2C_Handle_t* h) {
    if (h) {
        HAL_I2C_DeInit(h);   // tắt I2C peripheral, disable clock
        HAL_Free(h);         // HAL-specific free (không phải delete C++)
    }
};

// Khai báo unique_ptr với custom deleter:
// decltype(i2c_deleter) → kiểu của lambda (unique với mỗi lambda)
std::unique_ptr<HAL_I2C_Handle_t, decltype(i2c_deleter)>
    i2c_handle(HAL_I2C_Init(I2C1_BASE), i2c_deleter);
//              ↑ raw pointer từ HAL init  ↑ deleter sẽ gọi khi huỷ

// Dùng handle như bình thường
if (i2c_handle) {   // kiểm tra != nullptr
    HAL_I2C_Transmit(i2c_handle.get(), 0x48, data, len, 100);
    //                             ↑ .get() lấy raw pointer cho C API
}

// Khi i2c_handle ra khỏi scope → i2c_deleter được gọi tự động
// → HAL_I2C_DeInit + HAL_Free được gọi đúng cách
```

> **⚠️ Cạm bẫy phổ biến:** Gọi `.get()` để lấy raw pointer rồi `delete` thủ công. Kết quả: double-free → undefined behavior → hard fault trên MCU.

---

## 1.7 `unique_ptr` cho mảng – Quản lý buffer động

```cpp
// Cú pháp đặc biệt cho array: unique_ptr<T[]>
// Khi huỷ sẽ gọi delete[] thay vì delete

// Cấp phát buffer 256 byte cho DMA receive
auto rx_buffer = std::make_unique<uint8_t[]>(256);
//  ↑ gọi new uint8_t[256] nội bộ

// Truy cập phần tử bằng []
rx_buffer[0] = 0xAA;
rx_buffer[1] = 0x55;

// Truyền cho DMA (cần raw pointer)
DMA_Config(DMA1_CH1, rx_buffer.get(), 256);
//                              ↑ .get() trả uint8_t*

// Khi ra khỏi scope → delete[] tự động (không dùng delete thường)
```

---

## Bảng tóm tắt

| Kỹ thuật | Vấn đề giải quyết | Bối cảnh sử dụng |
|---|---|---|
| `unique_ptr<T>` | Memory leak khi quản lý tài nguyên heap | Driver object, buffer động, RTOS handle |
| `unique_ptr<T[]>` | Leak khi dùng `new[]` cho mảng | DMA buffer, RX/TX buffer động |
| Custom deleter | Giải phóng tài nguyên không phải heap | HAL handle, file descriptor, mutex |
| `std::move()` | Chuyển quyền sở hữu an toàn | Truyền driver vào class container |

---

> **Tiếp theo:** [Phần 10 – Template trong Embedded](/adaptive-cpp/cpp-template-embedded/) – tái sử dụng code không copy-paste với function template, class template (NTTP) và specialization.
