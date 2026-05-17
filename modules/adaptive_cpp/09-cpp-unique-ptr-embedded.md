---
layout: default
title: "Advanced C++ – Phần 9: Smart Pointers trong Embedded"
description: "Hiểu sâu ba loại smart pointer (unique_ptr, shared_ptr, weak_ptr) – cơ chế ownership, reference counting, dangling pointer prevention – và ứng dụng thực tế quản lý tài nguyên trên MCU/RTOS không bị memory leak."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-unique-ptr-embedded/
tags: [cpp, unique-ptr, shared-ptr, weak-ptr, smart-pointer, raii, ownership, embedded, stm32]
---

# Advanced C++ – Phần 9: Smart Pointers trong Embedded

> **Mục tiêu bài này:** Nắm vững ba loại smart pointer (`unique_ptr`, `shared_ptr`, `weak_ptr`), biết chọn đúng loại cho từng tình huống, và tránh toàn bộ lớp lỗi memory trên MCU/RTOS.
>
> **Series kỹ thuật nền tảng Embedded C++:**  
> → **Phần 9 (bài này): Smart Pointers**  
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
│Smart Pointers│      Template       │  Data Type & Access    │
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

Smart pointer giải quyết vấn đề này bằng cách **tự động quản lý lifetime** của object theo nguyên tắc RAII.

---

## 1.2 Ba loại Smart Pointer – Bản đồ tổng quan

```
┌──────────────────────────────────────────────────────────────────────┐
│  C++ Smart Pointers  (<memory>)                                      │
│                                                                      │
│  ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │   unique_ptr<T>  │   │   shared_ptr<T>  │   │   weak_ptr<T>   │  │
│  │                  │   │                  │   │                 │  │
│  │ Một chủ duy nhất │   │ Nhiều chủ chia   │   │ Quan sát không  │  │
│  │ Không thể copy   │   │ sẻ (ref count)   │   │ sở hữu          │  │
│  │ CÓ THỂ move      │   │ Giải phóng khi   │   │ Phá vỡ cycle    │  │
│  │ Zero overhead    │   │ count về 0        │   │ không tăng ref  │  │
│  │                  │   │                  │   │                 │  │
│  │ Dùng khi: 1 nơi  │   │ Dùng khi: nhiều  │   │ Dùng khi: cần  │  │
│  │ sở hữu resource  │   │ nơi cần truy cập │   │ tránh cycle     │  │
│  └──────────────────┘   └──────────────────┘   └─────────────────┘  │
│                                                                      │
│  Quy tắc chọn: unique_ptr mặc định → shared_ptr nếu cần chia sẻ     │
│                → weak_ptr để phá vòng lặp hoặc observer             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. `unique_ptr` – Sở hữu độc quyền

### 2.1 Mental Model

```
  unique_ptr (stack)   ──owns──▶   T object (heap)
       │
       │ khi ra khỏi scope → destructor → delete object tự động
       
  KHÔNG THỂ copy → tại mọi thời điểm, chỉ 1 chủ sở hữu
  CÓ THỂ move   → chuyển quyền sở hữu tường minh
  Kích thước    = 1 raw pointer, không overhead runtime
```

### 2.2 Cú pháp cơ bản

```cpp
#include <memory>

// ─── Tạo unique_ptr ────────────────────────────────────────────
// make_unique<T>(args) – KHÔNG dùng new trực tiếp
auto ptr = std::make_unique<TemperatureSensor>(0x48);
//   ↑ kiểu: unique_ptr<TemperatureSensor>, gọi constructor(0x48)

// ─── Truy cập ──────────────────────────────────────────────────
ptr->start();              // operator-> như raw pointer
(*ptr).read();             // hoặc dereference

// ─── get() – mượn raw pointer, KHÔNG chuyển ownership ─────────
uint8_t addr = ptr->address();
HAL_I2C_Transmit(hi2c, ptr.get(), data, len, 100);
//                         ↑ raw pointer cho C API – không delete!

// ─── reset() – huỷ object hiện tại ────────────────────────────
ptr.reset();                          // delete object, ptr = nullptr
ptr.reset(new TemperatureSensor(0x49)); // thay bằng object mới

// ─── release() – từ bỏ ownership ──────────────────────────────
TemperatureSensor* raw = ptr.release(); // ptr = nullptr
// raw bây giờ là raw pointer – PHẢI tự delete raw!
delete raw;
```

### 2.3 Move Semantics – Chuyển quyền sở hữu

```cpp
auto p1 = std::make_unique<UartDriver>(1, 115200);

// auto p2 = p1;   ← LỖI BIÊN DỊCH: copy constructor bị xóa
//   error: call to deleted constructor of 'unique_ptr<UartDriver>'

// MOVE – chuyển toàn bộ ownership một cách tường minh:
auto p2 = std::move(p1);
// Sau move: p2 sở hữu object, p1 = nullptr
// Compiler buộc phải dùng std::move → không vô tình có 2 chủ
```

### 2.4 Ứng dụng Embedded – UART Driver

```cpp
// ─── uart_driver.hpp ─────────────────────────────────────────
class UartDriver {
public:
    UartDriver(uint8_t port, uint32_t baud);
    ~UartDriver();              // tắt clock, giải phóng DMA
    uint16_t transmit(const uint8_t* data, uint16_t len);
    uint16_t receive(uint8_t* buf, uint16_t max_len);
private:
    uint8_t  port_;
    uint32_t baud_;
};
```

```cpp
// ─── main.cpp ─────────────────────────────────────────────────
bool setup_uart1() {
    auto uart = std::make_unique<UartDriver>(1, 115200);

    if (!uart->selfTest()) {
        return false;  // ← KHÔNG LEAK: destructor chạy ngay tại đây
    }

    const uint8_t hs[] = {0xAA, 0x55};
    uart->transmit(hs, sizeof(hs));

    uint8_t resp[2] = {};
    if (uart->receive(resp, 2) != 2 || resp[0] != 0xAA) {
        return false;  // ← KHÔNG LEAK
    }

    return true;
    // ← uart ra khỏi scope → ~UartDriver() tự động dọn dẹp
}
```

> **💡 Điểm mấu chốt:** `unique_ptr` biến "nhớ gọi `delete`" thành vấn đề của compiler. Trên MCU 64 KB RAM, đây là sự khác biệt giữa firmware ổn định và firmware crash sau 6 giờ.

### 2.5 Custom Deleter – Tài nguyên không phải heap

Embedded thường có tài nguyên giải phóng bằng API HAL/RTOS, không phải `delete`:

```cpp
// Tình huống: I2C handle phải dùng HAL_I2C_DeInit() để tắt peripheral

auto i2c_deleter = [](HAL_I2C_Handle_t* h) {
    if (h) {
        HAL_I2C_DeInit(h);  // tắt I2C, disable clock
        HAL_Free(h);        // HAL-specific free
    }
};

std::unique_ptr<HAL_I2C_Handle_t, decltype(i2c_deleter)>
    i2c(HAL_I2C_Init(I2C1_BASE), i2c_deleter);
//      ↑ raw pointer từ HAL    ↑ sẽ gọi khi i2c bị huỷ

HAL_I2C_Transmit(i2c.get(), 0x48, data, len, 100);

// Khi i2c ra khỏi scope → HAL_I2C_DeInit + HAL_Free chạy tự động
```

> **⚠️ Cạm bẫy:** Gọi `.get()` rồi `delete` thủ công → double-free → hard fault trên MCU.

### 2.6 `unique_ptr<T[]>` – Buffer động

```cpp
// unique_ptr<T[]> gọi delete[] khi huỷ (không phải delete)
auto rx_buf = std::make_unique<uint8_t[]>(256);

rx_buf[0] = 0xAA;
rx_buf[1] = 0x55;

DMA_Config(DMA1_CH1, rx_buf.get(), 256);
// Khi ra khỏi scope → delete[] tự động
```

---

## 3. `shared_ptr` – Sở hữu chia sẻ (Reference Counting)

### 3.1 Mental Model

```
  shared_ptr A ─┐
                ├──▶  T object  +  [ref count = 2]
  shared_ptr B ─┘
  
  Khi A bị huỷ: ref count → 1, object CÒN TỒN TẠI
  Khi B bị huỷ: ref count → 0, object BỊ DELETE
  
  Control block (heap riêng): chứa ref count + weak count + deleter
  Kích thước shared_ptr = 2 raw pointer (ptr + control block)
```

### 3.2 Cú pháp cơ bản

```cpp
#include <memory>

// ─── Tạo shared_ptr ────────────────────────────────────────────
// make_shared: 1 allocation cho cả object + control block (hiệu quả hơn)
auto sp1 = std::make_shared<Sensor>(0x48);
//   ↑ ref count = 1

// ─── Copy → tăng ref count ─────────────────────────────────────
auto sp2 = sp1;   // ref count = 2, cả sp1 và sp2 trỏ cùng object
auto sp3 = sp1;   // ref count = 3

// ─── Kiểm tra số chủ sở hữu ────────────────────────────────────
std::cout << sp1.use_count();  // in ra 3

// ─── Huỷ một shared_ptr ────────────────────────────────────────
sp2.reset();      // ref count = 2, object vẫn tồn tại
sp3.reset();      // ref count = 1
// sp1.reset() hoặc sp1 ra khỏi scope → ref count = 0 → delete object
```

### 3.3 Ứng dụng Embedded – Sensor dùng chung bởi nhiều task

**Tình huống:** Sensor BME280 đọc cả nhiệt độ lẫn áp suất. Hai FreeRTOS task đều cần truy cập cùng một driver instance.

```cpp
// ─── sensor_manager.hpp ──────────────────────────────────────
#include <memory>

class Bme280Driver {
public:
    Bme280Driver(uint8_t i2c_addr);
    ~Bme280Driver();           // giải phóng I2C lock

    float readTemperature();
    float readPressure();
};

// Singleton pattern với shared_ptr – an toàn hơn raw singleton
std::shared_ptr<Bme280Driver> getSensor();
```

```cpp
// ─── sensor_manager.cpp ──────────────────────────────────────
static std::weak_ptr<Bme280Driver> g_sensor_weak;  // xem Section 4

std::shared_ptr<Bme280Driver> getSensor() {
    auto sp = g_sensor_weak.lock();
    if (!sp) {
        sp = std::make_shared<Bme280Driver>(0x76);
        g_sensor_weak = sp;
    }
    return sp;  // ref count tăng khi trả về caller
}
```

```cpp
// ─── task_temperature.cpp ────────────────────────────────────
void temperatureTask(void*) {
    auto sensor = getSensor();  // ref count + 1

    for (;;) {
        float temp = sensor->readTemperature();
        publishTemperature(temp);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
    // sensor ra khỏi scope → ref count - 1
    // Nếu pressureTask vẫn chạy, object còn tồn tại
}

// ─── task_pressure.cpp ────────────────────────────────────────
void pressureTask(void*) {
    auto sensor = getSensor();  // ref count + 1 (nếu cùng lúc = 2)

    for (;;) {
        float press = sensor->readPressure();
        publishPressure(press);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
```

> **⚠️ Cạm bẫy:** `shared_ptr` **không thread-safe cho object bên trong** — chỉ ref count là atomic. Nếu hai task cùng gọi `readTemperature()` và `readPressure()`, cần mutex riêng để bảo vệ I2C bus.

### 3.4 Chi phí `shared_ptr` so với `unique_ptr`

| Thuộc tính | `unique_ptr` | `shared_ptr` |
|---|---|---|
| Kích thước | 1 pointer (4/8 byte) | 2 pointer (8/16 byte) |
| Overhead tạo | Zero | 1 heap allocation cho control block |
| Copy | Không cho phép | O(1), atomic increment |
| Overhead huỷ | Zero | atomic decrement + kiểm tra = 0 |
| Dùng khi | 1 chủ sở hữu | Nhiều chủ, lifetime không rõ |

> **💡 Điểm mấu chốt:** Trên MCU Cortex-M4/M7, atomic increment/decrement là **1 instruction** (`LDREX`/`STREX`). Overhead `shared_ptr` rất nhỏ nhưng **không phải zero** — tránh dùng trong hard real-time interrupt handler (ISR).

---

## 4. `weak_ptr` – Quan sát không sở hữu

### 4.1 Vấn đề Circular Reference

```cpp
// BAD: cyclic shared_ptr → memory leak vĩnh viễn
struct Node {
    std::shared_ptr<Node> next;  // ← shared_ptr tạo cycle
    int value;
};

auto a = std::make_shared<Node>();  // count(a) = 1
auto b = std::make_shared<Node>();  // count(b) = 1
a->next = b;  // count(b) = 2
b->next = a;  // count(a) = 2

// Khi a, b ra khỏi scope:
//   count(a) = 1 (b->next vẫn giữ)
//   count(b) = 1 (a->next vẫn giữ)
//   → KHÔNG BAO GIỜ đến 0 → LEAK
```

### 4.2 Giải pháp: `weak_ptr` phá vòng

```cpp
// GOOD: weak_ptr không tăng ref count
struct Node {
    std::weak_ptr<Node> next;   // ← weak_ptr: quan sát, không sở hữu
    int value;
};

auto a = std::make_shared<Node>();  // count(a) = 1
auto b = std::make_shared<Node>();  // count(b) = 1
a->next = b;  // weak_ptr: count(b) vẫn = 1
b->next = a;  // weak_ptr: count(a) vẫn = 1

// Khi a, b ra khỏi scope:
//   count(a) → 0 → delete a
//   count(b) → 0 → delete b
//   KHÔNG LEAK
```

### 4.3 Cú pháp – Lock trước khi dùng

```cpp
// weak_ptr KHÔNG trực tiếp dereference được
// Phải lock() để lấy shared_ptr tạm thời

std::weak_ptr<Sensor> weak_sensor = getSensor();

// ─── Cách an toàn: dùng if ────────────────────────────────────
if (auto sp = weak_sensor.lock()) {
    // lock() trả shared_ptr, tăng ref count tạm thời
    // Nếu object còn sống → sp != nullptr
    sp->readTemperature();
    // sp ra khỏi scope → ref count giảm về lại
} else {
    // object đã bị huỷ (tất cả shared_ptr đã release)
    // Xử lý gracefully thay vì crash
}

// ─── Kiểm tra expired (không lock) ────────────────────────────
if (weak_sensor.expired()) {
    // Object không còn tồn tại
}
```

### 4.4 Ứng dụng Embedded – Observer Pattern cho Sensor Events

**Tình huống:** Nhiều module "đăng ký" nhận event từ sensor. Module có thể bị huỷ bất kỳ lúc nào (unsubscribe). Dùng `weak_ptr` để tránh giữ module sống sau khi nó đã bị huỷ.

```cpp
// ─── event_bus.hpp ───────────────────────────────────────────
#include <memory>
#include <vector>
#include <functional>

class SensorEventBus {
public:
    using Callback = std::function<void(float)>;

    struct Subscriber {
        std::weak_ptr<void> lifetime;  // weak_ptr đến chủ module
        Callback            callback;
    };

    void subscribe(std::weak_ptr<void> lifetime, Callback cb) {
        subscribers_.push_back({std::move(lifetime), std::move(cb)});
    }

    void publish(float value) {
        // Duyệt, gọi callback chỉ nếu subscriber còn sống
        auto it = subscribers_.begin();
        while (it != subscribers_.end()) {
            if (it->lifetime.expired()) {
                it = subscribers_.erase(it);  // tự dọn dẹp subscriber chết
            } else {
                it->callback(value);
                ++it;
            }
        }
    }

private:
    std::vector<Subscriber> subscribers_;
};
```

```cpp
// ─── display_module.cpp ──────────────────────────────────────
class DisplayModule : public std::enable_shared_from_this<DisplayModule> {
public:
    void init(SensorEventBus& bus) {
        // shared_from_this() lấy shared_ptr đến chính mình
        // weak_ptr để bus không giữ DisplayModule sống
        bus.subscribe(
            shared_from_this(),                // weak lifetime token
            [this](float temp) {               // callback
                showTemperature(temp);
            }
        );
    }

    void showTemperature(float t) { /* cập nhật LCD */ }
};

// Usage:
auto display = std::make_shared<DisplayModule>();
display->init(eventBus);

// Khi display bị huỷ (reset hoặc ra scope):
//   weak_ptr expired → eventBus tự dọn subscriber
//   KHÔNG dangling pointer, KHÔNG crash
```

> **💡 Điểm mấu chốt:** `weak_ptr` là giải pháp tiêu chuẩn cho **Observer pattern** và **cache** trong C++. Thay vì dùng raw pointer "nguy hiểm" để tránh overhead, dùng `weak_ptr` để có cả an toàn lẫn zero ownership overhead.

---

## 5. Quy tắc chọn Smart Pointer

```
Bạn cần quản lý lifetime của object?
          │
          ▼
    Một nơi duy nhất sở hữu?
     ┌────┴─────┐
    YES         NO
     │           │
     ▼           ▼
unique_ptr   Nhiều nơi cần truy cập?
(mặc định)    ┌────┴─────┐
             YES         NO
              │           │
              ▼           ▼
         shared_ptr    Chỉ quan sát,
                       không sở hữu?
                            │
                            ▼
                         weak_ptr
```

**Tóm tắt nhanh:**
- `unique_ptr` → **default choice** cho mọi trường hợp sở hữu đơn.
- `shared_ptr` → khi nhiều component cùng cần truy cập, lifetime không xác định trước.
- `weak_ptr` → khi cần quan sát mà không muốn kéo dài lifetime; phá circular reference.

---

## 6. Embedded Considerations – Điều cần lưu ý trên MCU

| Vấn đề | `unique_ptr` | `shared_ptr` | Ghi chú |
|---|---|---|---|
| RAM overhead | 0 | Control block ~24 byte | Trên MCU 8 KB RAM, mỗi `shared_ptr` tốn ~24 byte cho control block |
| Heap fragmentation | Phụ thuộc pattern tạo/huỷ | Cao hơn (2 allocation nếu không dùng `make_shared`) | Dùng `make_shared` giảm từ 2 xuống 1 allocation |
| ISR safety | An toàn (không atomic) | **KHÔNG dùng trong ISR** (atomic op, latency không xác định) | Copy/assign `shared_ptr` trong ISR → undefined behavior |
| RTOS task safety | An toàn nếu 1 task | Ref count an toàn, object cần mutex riêng | Chỉ ref count atomic, không phải toàn bộ object |
| Stack overflow | Không (object trên heap) | Không (object trên heap) | Bản thân smart pointer (stack) chỉ 4–16 byte |

> **⚠️ Cạm bẫy phổ biến:** Copy `shared_ptr` trong ISR → `std::atomic` operations → không deterministic latency → vi phạm real-time constraint. Trong ISR, chỉ dùng raw pointer trỏ vào buffer/object có lifetime được đảm bảo từ trước.

---

## Bảng tóm tắt

| Kỹ thuật | Vấn đề giải quyết | Bối cảnh sử dụng |
|---|---|---|
| `unique_ptr<T>` | Memory leak, quên delete | Driver object, buffer, RTOS handle sở hữu đơn |
| `unique_ptr<T[]>` | Leak khi dùng `new[]` | DMA buffer, RX/TX buffer động |
| Custom deleter | Tài nguyên không giải phóng bằng `delete` | HAL handle, file descriptor, peripheral |
| `std::move()` | Chuyển quyền sở hữu an toàn | Truyền driver vào class container |
| `shared_ptr<T>` | Lifetime không rõ, nhiều chủ sở hữu | Sensor dùng chung, shared config, service locator |
| `make_shared<T>` | Giảm allocation khi dùng `shared_ptr` | Thay thế `shared_ptr<T>(new T(...))` |
| `weak_ptr<T>` | Circular reference, observer pattern | Event bus, cache, parent-child node graph |
| `weak_ptr::lock()` | Truy cập an toàn, tránh dangling pointer | Bất cứ khi nào dùng `weak_ptr` để đọc object |

---

> **Tiếp theo:** [Phần 10 – Template trong Embedded](/adaptive-cpp/cpp-template-embedded/) – tái sử dụng code không copy-paste với function template, class template (NTTP) và specialization.
