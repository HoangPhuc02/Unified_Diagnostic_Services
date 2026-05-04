---
layout: default
title: "Advanced C++ – Phần 9: unique_ptr, Template & Data Types trong Embedded"
description: "Giải thích chi tiết unique_ptr, function/class template, và kiểu dữ liệu/kiểm soát truy cập – ứng dụng thực tế trong lập trình nhúng (Embedded C++)."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-unique-ptr-template-types/
tags: [cpp, unique-ptr, smart-pointer, template, data-types, embedded, raii, ownership]
---

# Advanced C++ – Phần 9: `unique_ptr`, Template & Data Types trong Embedded

> **Mục tiêu bài này:** Hiểu rõ cơ chế `unique_ptr`, cách viết template tái sử dụng, và lựa chọn kiểu dữ liệu + kiểm soát truy cập đúng cách trong lập trình nhúng (MCU/RTOS/AUTOSAR).
>
> **Yêu cầu trước:** Quen với con trỏ C, class/struct C++ cơ bản, biết `new`/`delete`.  
> **Compiler:** GCC-ARM ≥ 11 hoặc AVR-GCC ≥ 12, cờ `-std=c++17`

---

## Toàn cảnh 3 chủ đề

```
┌──────────────────────────────────────────────────────────────┐
│         Embedded C++ – 3 kỹ thuật nền tảng                  │
├──────────────┬─────────────────────┬────────────────────────┤
│  unique_ptr  │      Template       │  Data Type & Access    │
│              │                     │                        │
│ Quản lý      │ Tái sử dụng code   │ Đúng kiểu → đúng size  │
│ tài nguyên   │ không copy-paste   │ Đúng access → an toàn  │
│ an toàn      │                     │                        │
│ Không heap   │ Compile-time poly   │ No padding waste       │
│ fragmentation│ morphism            │ Register-width aware   │
└──────────────┴─────────────────────┴────────────────────────┘
```

---

## Phần 1 – `unique_ptr`: Con trỏ thông minh sở hữu độc quyền

### 1.1 Vấn đề raw pointer trong Embedded

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

### 1.2 `unique_ptr` là gì – Mental Model

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

### 1.3 Cú pháp cơ bản – Giải thích từng dòng

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

### 1.4 Ownership – Chuyển quyền sở hữu bằng `move`

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

### 1.5 Ứng dụng Embedded – Driver quản lý UART với `unique_ptr`

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
    uint8_t  port_num_;   // số UART (1-3)
    uint32_t baud_rate_;  // baud rate: 9600, 115200...
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

### 1.6 `unique_ptr` với Custom Deleter – Giải phóng tài nguyên không phải heap

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

### 1.7 `unique_ptr` cho mảng – Quản lý buffer động

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

## Phần 2 – Template: Tái sử dụng code không copy-paste

### 2.1 Vấn đề không có Template

```cpp
// BAD – viết cùng logic cho mỗi kiểu dữ liệu → lặp code
uint8_t  clamp_u8 (uint8_t  v, uint8_t  lo, uint8_t  hi) { return v<lo?lo:v>hi?hi:v; }
uint16_t clamp_u16(uint16_t v, uint16_t lo, uint16_t hi) { return v<lo?lo:v>hi?hi:v; }
int16_t  clamp_i16(int16_t  v, int16_t  lo, int16_t  hi) { return v<lo?lo:v>hi?hi:v; }
float    clamp_f32(float    v, float    lo, float    hi)  { return v<lo?lo:v>hi?hi:v; }
// 4 hàm, logic giống hệt nhau → bug fix phải sửa 4 chỗ!
```

**Template giải quyết:** viết một lần, compiler sinh code cho từng kiểu cụ thể tại **compile-time** (không có overhead runtime).

---

### 2.2 Function Template – Giải thích chi tiết

```cpp
// ─── Cú pháp function template ───────────────────────────────
// template<typename T> → "T là kiểu bất kỳ, sẽ xác định lúc gọi"
// T sẽ được compiler SUY LUẬN (type deduction) từ kiểu argument

template<typename T>
T clamp(T value, T low, T high) {
    // Ý nghĩa: nếu value < low → trả low
    //          nếu value > high → trả high
    //          ngược lại → trả value
    // Operator < và > phải được T hỗ trợ
    if (value < low)  return low;
    if (value > high) return high;
    return value;
}

// ─── Cách compiler xử lý ─────────────────────────────────────
uint8_t adc_raw = 127;
// Gọi: clamp(adc_raw, (uint8_t)0, (uint8_t)255)
// Compiler thấy T = uint8_t → sinh hàm:
//   uint8_t clamp(uint8_t value, uint8_t low, uint8_t high) { ... }

float temperature = 25.7f;
// Gọi: clamp(temperature, -40.0f, 125.0f)
// Compiler thấy T = float → sinh hàm:
//   float clamp(float value, float low, float high) { ... }

int16_t speed_rpm = 3500;
// Gọi: clamp(speed_rpm, (int16_t)0, (int16_t)6000)
// T = int16_t → sinh thêm một hàm nữa

// Tất cả 3 hàm được sinh tại COMPILE-TIME
// Binary output: giống như bạn tự viết 3 hàm riêng
// Runtime cost: ZERO so với template version
```

---

### 2.3 Template với ràng buộc `static_assert` – An toàn hơn trong Embedded

```cpp
#include <type_traits>  // std::is_arithmetic, std::is_integral

// Phiên bản an toàn hơn: chặn các kiểu không hợp lệ tại compile-time
template<typename T>
T safe_clamp(T value, T low, T high) {
    // static_assert chạy lúc BIÊN DỊCH, không phải runtime
    // Nếu T không phải kiểu số → báo lỗi ngay khi build
    static_assert(std::is_arithmetic<T>::value,
                  "safe_clamp chỉ dùng được với kiểu số (int, float, double...)");

    // __builtin_expect: gợi ý cho GCC branch predictor
    // Trường hợp phổ biến nhất: value nằm trong [low, high]
    if (__builtin_expect(value < low, 0))  return low;
    if (__builtin_expect(value > high, 0)) return high;
    return value;
}

// Ví dụ sử dụng trong firmware:
void process_adc_reading() {
    uint16_t raw_adc = ADC_Read(ADC_CHANNEL_3);  // 0–4095 (12-bit ADC)

    // Clamp về dải hợp lệ của cảm biến nhiệt độ: 200–3800 (tránh noise đầu dải)
    uint16_t valid_adc = safe_clamp(raw_adc, (uint16_t)200, (uint16_t)3800);

    // Chuyển đổi ADC → nhiệt độ (linear mapping)
    float temp_celsius = (valid_adc / 4096.0f) * 165.0f - 40.0f;

    // Clamp nhiệt độ về dải hiển thị
    float display_temp = safe_clamp(temp_celsius, -40.0f, 125.0f);
}

// Ví dụ lỗi tại compile-time:
// safe_clamp("hello", "abc", "xyz");  // LỖI: T = const char* không phải số
// Error: static assertion failed: safe_clamp chỉ dùng được với kiểu số
```

---

### 2.4 Class Template – Container tĩnh không dùng heap

**Tình huống:** MCU không có RTOS và cấm heap allocation. Cần một queue kích thước cố định cho ISR (Interrupt Service Routine).

```cpp
// ─── static_queue.hpp ─────────────────────────────────────────
#include <cstdint>
#include <cstddef>  // size_t

// Template class: T = kiểu phần tử, N = số phần tử tối đa
// N là Non-Type Template Parameter (NTTP) – xác định lúc compile
template<typename T, std::size_t N>
class StaticQueue {
    // Mảng nằm trực tiếp trong struct → trên stack hoặc BSS
    // KHÔNG dùng new/malloc → hoàn toàn deterministic
    T           buffer_[N];         // N phần tử kiểu T
    std::size_t head_  {0};         // chỉ số đọc tiếp theo
    std::size_t tail_  {0};         // chỉ số ghi tiếp theo
    std::size_t count_ {0};         // số phần tử hiện có

public:
    // push: thêm phần tử vào cuối queue
    // Trả false nếu queue đầy (caller phải xử lý)
    bool push(const T& item) {
        if (count_ >= N) return false;   // full → từ chối
        buffer_[tail_] = item;           // ghi vào vị trí tail
        tail_ = (tail_ + 1) % N;         // wrap around (circular buffer)
        ++count_;
        return true;
    }

    // pop: lấy phần tử từ đầu queue, ghi vào out
    // Trả false nếu queue rỗng
    bool pop(T& out) {
        if (count_ == 0) return false;   // empty → từ chối
        out  = buffer_[head_];           // copy phần tử ra ngoài
        head_ = (head_ + 1) % N;         // dịch chuyển head
        --count_;
        return true;
    }

    // Các query methods
    bool        empty() const { return count_ == 0; }
    bool        full()  const { return count_ == N; }
    std::size_t size()  const { return count_; }
    std::size_t capacity() const { return N; }     // N là compile-time constant
};
```

```cpp
// ─── firmware.cpp – sử dụng StaticQueue ─────────────────────
#include "static_queue.hpp"

// Struct đại diện cho một sự kiện CAN bus
struct CanFrame {
    uint32_t id;          // CAN ID (11-bit hoặc 29-bit)
    uint8_t  dlc;         // Data Length Code (0-8)
    uint8_t  data[8];     // payload
    uint32_t timestamp;   // tick khi nhận được frame
};

// Queue toàn cục – nằm trên BSS, không heap
// 32 frame CAN, mỗi frame 16 byte → 512 byte BSS (an toàn cho MCU nhỏ)
static StaticQueue<CanFrame, 32> can_rx_queue;

// ISR: chạy khi nhận được CAN frame – phải cực kỳ nhanh
// __attribute__((interrupt)) là GCC extension cho ISR
void CAN1_RX0_IRQHandler() {
    CanFrame frame;
    frame.id        = CAN1->sFIFOMailBox[0].RIR >> 21;   // lấy ID từ hardware register
    frame.dlc       = CAN1->sFIFOMailBox[0].RDTR & 0x0F; // 4 bit thấp = DLC
    frame.timestamp = HAL_GetTick();

    // Copy 8 byte data từ hardware FIFO vào struct
    for (uint8_t i = 0; i < frame.dlc; ++i) {
        frame.data[i] = (CAN1->sFIFOMailBox[0].RDLR >> (8 * (i % 4))) & 0xFF;
    }

    // push vào queue – nếu đầy thì bỏ frame (oldest-frame-dropped policy)
    // Không gọi new, không gọi malloc → safe trong ISR
    can_rx_queue.push(frame);

    CAN1->RF0R |= CAN_RF0R_RFOM0;  // Release FIFO: báo hardware đã đọc xong
}

// Task chính: xử lý frame từ queue
void process_can_frames() {
    CanFrame frame;
    while (can_rx_queue.pop(frame)) {  // lấy từng frame
        // Xử lý theo ID
        switch (frame.id) {
            case 0x100: handle_engine_data(frame.data, frame.dlc);  break;
            case 0x200: handle_sensor_data(frame.data, frame.dlc);  break;
            default:    break;
        }
    }
}
```

> **💡 Điểm mấu chốt:** `StaticQueue<CanFrame, 32>` và `StaticQueue<uint8_t, 64>` là **hai class riêng biệt** được sinh tại compile-time. Không có virtual, không có heap, không có runtime type check. Kích thước stack/BSS được biết chính xác trước khi flash lên MCU.

---

### 2.5 Template Specialization trong Embedded – Xử lý đặc biệt cho kiểu cụ thể

```cpp
// ─── Serializer chung: chuyển đổi kiểu T → bytes ─────────────
// Dùng để gói dữ liệu vào CAN frame hoặc UART frame

template<typename T>
struct Serializer {
    // Đọc T từ mảng byte (little-endian)
    // reinterpret_cast: tái diễn giải byte sequence thành kiểu T
    // Chú ý: chỉ hợp lệ khi T là trivially copyable (int, float, struct POD)
    static T deserialize(const uint8_t* bytes) {
        T result;
        // memcpy an toàn hơn reinterpret_cast trực tiếp (tránh UB trên ARM)
        __builtin_memcpy(&result, bytes, sizeof(T));
        return result;
    }

    // Ghi T vào mảng byte (little-endian)
    static void serialize(const T& value, uint8_t* out) {
        __builtin_memcpy(out, &value, sizeof(T));
    }
};

// ─── Specialization cho bool – tiết kiệm 1 bit thay vì 1 byte ─
template<>
struct Serializer<bool> {
    static bool deserialize(const uint8_t* bytes) {
        return bytes[0] != 0;   // bất kỳ giá trị != 0 đều là true
    }

    static void serialize(const bool& value, uint8_t* out) {
        out[0] = value ? 0x01 : 0x00;  // chuẩn hóa: true=1, false=0
    }
};

// ─── Ví dụ sử dụng trong firmware ────────────────────────────
void pack_diagnostic_frame(uint8_t* frame_data) {
    uint16_t rpm     = 3500;       // tốc độ động cơ
    float    voltage = 12.5f;      // điện áp pin
    bool     fault   = false;      // có lỗi không

    // offset 0-1: RPM (2 byte, little-endian: 3500 = 0x0DAC → [0xAC, 0x0D])
    Serializer<uint16_t>::serialize(rpm, &frame_data[0]);

    // offset 2-5: Voltage (4 byte IEEE 754 float)
    Serializer<float>::serialize(voltage, &frame_data[2]);

    // offset 6: Fault flag (1 byte, dùng specialization cho bool)
    Serializer<bool>::serialize(fault, &frame_data[6]);
}
```

---

## Phần 3 – Data Types & Access Control

### 3.1 Kiểu dữ liệu trong Embedded – Tại sao `int` là nguy hiểm

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
uint8_t  byte_val   = 255;      // 0 → 255          (8-bit,  1 byte)
uint16_t word_val   = 65535;    // 0 → 65535         (16-bit, 2 byte)
uint32_t dword_val  = 0xDEAD;   // 0 → 4,294,967,295 (32-bit, 4 byte)
uint64_t qword_val  = 0ULL;     // 0 → 18 quintillion (64-bit, 8 byte) – tránh trên MCU nhỏ

// ─── Kiểu signed (có âm) – dùng cho: nhiệt độ, tốc độ, offset ───
int8_t   temp_offset = -10;     // -128 → +127
int16_t  temperature = -4000;   // -32768 → +32767    (x10: -40.00°C)
int32_t  position    = -100000; // -2^31 → +2^31-1

// ─── Kiểu đặc biệt ────────────────────────────────────────────
bool     flag        = true;    // chỉ true/false (1 byte trên hầu hết ABI)
float    voltage     = 3.3f;    // 32-bit IEEE 754 – có sẵn FPU trên Cortex-M4/M7
// double voltage   = 3.3;      // 64-bit – Cortex-M4 không có FPU 64-bit → CHẬM!

// ─── Kiểu cho địa chỉ và offset ─────────────────────────────
// size_t: unsigned, đủ lớn để chứa kích thước bộ nhớ bất kỳ
std::size_t buf_size = sizeof(uint32_t) * 16;   // luôn đúng trên mọi platform

// ptrdiff_t: signed, dùng cho hiệu của 2 pointer
ptrdiff_t offset = ptr_end - ptr_start;
```

---

### 3.2 Bit-fields và Struct Packing – Tối ưu bộ nhớ cho Register Map

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

### 3.3 Access Control trong Class – Ứng dụng cho Embedded Driver

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
    static constexpr uint8_t REG_WHO_AM_I   = 0x0F;   // ID register
    static constexpr uint8_t REG_CTRL1      = 0x20;   // control register 1
    static constexpr uint8_t REG_TEMP_L     = 0x2A;   // temperature LSB
    static constexpr uint8_t REG_TEMP_H     = 0x2B;   // temperature MSB
    static constexpr uint8_t EXPECTED_WHO   = 0xBC;   // giá trị mong đợi WHO_AM_I

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

    // Ghép 2 byte thành int16_t (two's complement, big-endian in this sensor)
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

### 3.4 `const` và `constexpr` – Compile-time Constants trong Embedded

```cpp
// ─── Sự khác biệt quan trọng ─────────────────────────────────

// #define – không có kiểu, không có scope, không thể debug
#define MAX_SENSORS 8          // BAD in C++: preprocessor replace trước khi compile

// const – có kiểu, có scope, nhưng có thể ở RAM hoặc Flash
const uint8_t kMaxSensors = 8; // có thể bị đặt vào RAM nếu compiler không optimize

// constexpr – CHẮC CHẮN tính tại compile-time, vào Flash (read-only)
constexpr uint8_t kMaxSensors = 8;    // guaranteed compile-time
constexpr uint32_t kSystemClockHz = 168'000'000; // 168 MHz (C++14: digit separator)
constexpr float    kVref = 3.3f;      // reference voltage

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

### 3.5 Tổng hợp: Class kết hợp `unique_ptr` + Template + Data Types

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

## Bảng tóm tắt

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
