---
layout: default
title: "Advanced C++ – Phần 10: Template trong Embedded"
description: "Function template, class template với NTTP, template specialization – tái sử dụng code an toàn không cấp phát heap, ứng dụng ISR queue và serializer trên MCU."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-template-embedded/
tags: [cpp, template, nttp, static-assert, specialization, embedded, isr, can-bus]
---

# Advanced C++ – Phần 10: Template trong Embedded

> **Mục tiêu bài này:** Viết code tái sử dụng cho nhiều kiểu dữ liệu mà không copy-paste, dùng Non-Type Template Parameter để xác định kích thước buffer tại compile-time, và xử lý kiểu đặc biệt bằng specialization.
>
> **Series kỹ thuật nền tảng Embedded C++:**  
> → [Phần 9: `unique_ptr` trong Embedded](/adaptive-cpp/cpp-unique-ptr-embedded/)  
> → **Phần 10 (bài này): Template**  
> → [Phần 11: Data Types & Access Control](/adaptive-cpp/cpp-data-types-access/)
>
> **Yêu cầu trước:** Quen với class/struct C++, hiểu `static` và `const`.  
> **Compiler:** GCC-ARM ≥ 11, cờ `-std=c++17`

---

## 2.1 Vấn đề không có Template

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

## 2.2 Function Template – Giải thích chi tiết

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

## 2.3 Template với ràng buộc `static_assert` – An toàn hơn trong Embedded

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

## 2.4 Class Template – Container tĩnh không dùng heap

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
        out   = buffer_[head_];          // copy phần tử ra ngoài
        head_ = (head_ + 1) % N;         // dịch chuyển head
        --count_;
        return true;
    }

    // Các query methods
    bool        empty()    const { return count_ == 0; }
    bool        full()     const { return count_ == N; }
    std::size_t size()     const { return count_; }
    std::size_t capacity() const { return N; }   // N là compile-time constant
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

## 2.5 Template Specialization trong Embedded – Xử lý đặc biệt cho kiểu cụ thể

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
    uint16_t rpm     = 3500;    // tốc độ động cơ
    float    voltage = 12.5f;   // điện áp pin
    bool     fault   = false;   // có lỗi không

    // offset 0-1: RPM (2 byte, little-endian: 3500 = 0x0DAC → [0xAC, 0x0D])
    Serializer<uint16_t>::serialize(rpm, &frame_data[0]);

    // offset 2-5: Voltage (4 byte IEEE 754 float)
    Serializer<float>::serialize(voltage, &frame_data[2]);

    // offset 6: Fault flag (1 byte, dùng specialization cho bool)
    Serializer<bool>::serialize(fault, &frame_data[6]);
}
```

---

## Bảng tóm tắt

| Kỹ thuật | Vấn đề giải quyết | Bối cảnh sử dụng |
|---|---|---|
| Function template | Tái sử dụng logic cho nhiều kiểu số | `clamp`, `map`, `serialize`, math helpers |
| Class template (NTTP) | Container kích thước cố định, không heap | Ring buffer, queue, stack cho ISR |
| Template specialization | Xử lý kiểu đặc biệt không dùng được generic | `bool`, `float` serialization |
| `static_assert` | Bắt lỗi kiểu sai tại compile-time | Validate template arguments |

---

> **Tiếp theo:** [Phần 11 – Data Types & Access Control](/adaptive-cpp/cpp-data-types-access/) – kiểu dữ liệu cố định kích thước, bit-field register map, `constexpr`, và phân chia `public`/`private` cho embedded driver.
