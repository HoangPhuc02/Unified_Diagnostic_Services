---
layout: default
title: "Advanced C++ – Phần 5: Encapsulation – Đóng gói & Kiểm soát truy cập"
description: "Encapsulation trong C++ từ cơ bản đến nâng cao – access specifiers, invariant contract, const correctness, friend, Pimpl idiom – ứng dụng trong AUTOSAR Adaptive Platform."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-oop-encapsulation/
tags: [cpp, oop, encapsulation, const, pimpl, friend, invariant, adaptive-autosar]
---

# Advanced C++ – Phần 5: Encapsulation – Đóng gói & Kiểm soát truy cập

> **Mục tiêu bài này:** Hiểu tại sao Encapsulation là nền tảng của OOP, cơ chế C++ triển khai nó (access specifiers, const, friend, Pimpl), và ứng dụng trong AUTOSAR Adaptive Platform.
>
> **Series OOP:**
> → **Phần 5 (bài này): Encapsulation**
> → [Phần 6: Inheritance](/adaptive-cpp/cpp-oop-inheritance/)
> → [Phần 7: Polymorphism](/adaptive-cpp/cpp-oop-polymorphism/)
> → [Phần 8: Abstraction & SOLID](/adaptive-cpp/cpp-oop-abstraction/)

---

## Tổng quan

```
Encapsulation trong C++
├── 1. Access specifiers  – public / protected / private semantics
├── 2. Invariant contract – class cam kết trạng thái hợp lệ
├── 3. Const correctness  – const methods, mutable, const objects
├── 4. friend keyword     – kiểm soát ngoại lệ truy cập
└── 5. Pimpl idiom        – ẩn hoàn toàn implementation details
```

**Encapsulation KHÔNG phải là:** "thêm private và getter/setter vào mọi field".
**Encapsulation LÀ:** class **tự đảm bảo** rằng object của nó luôn ở trạng thái hợp lệ, bất kể caller làm gì.

---

## 1. Access Specifiers – Chi tiết từng loại

### 1.1 public / protected / private – Ý nghĩa thực sự

```
Ai truy cập được?
┌─────────────────────────────────────────────────┐
│ Member     │ Chính class │ Derived class │ Bên ngoài │
├────────────┼─────────────┼───────────────┼───────────┤
│ public     │     ✔       │      ✔        │    ✔      │
│ protected  │     ✔       │      ✔        │    ✗      │
│ private    │     ✔       │      ✗        │    ✗      │
└────────────┴─────────────┴───────────────┴───────────┘
Friend function/class phá vỡ cả private → xem Phần 4
```

**Quy tắc thiết kế:**
- **public**: API contract – cam kết ổn định với caller
- **protected**: extension points – cho derived class override
- **private**: implementation details – có thể thay đổi bất kỳ lúc nào mà không ảnh hưởng caller

```cpp
// Ví dụ: một NvM Manager class đúng cách phân cấp truy cập
class NvmConfigManager {
public:
    // === PUBLIC API – giao tiếp với caller ===
    // Đọc configuration block theo ID
    bool Read(uint16_t block_id, std::span<uint8_t> out_data);

    // Ghi configuration block
    bool Write(uint16_t block_id, std::span<const uint8_t> data);

    // Khởi tạo – gọi một lần khi startup
    bool Initialize();

    // Trạng thái (read-only cho caller)
    bool IsReady() const noexcept { return initialized_; }

protected:
    // === PROTECTED – chỉ derived class (e.g., NvmConfigManagerWithCrc) ===
    // Derived class có thể override cách validate data
    virtual bool ValidateBlockData(std::span<const uint8_t> data) {
        // Default: chấp nhận nếu size đúng
        return !data.empty();
    }

    // Derived class có thể override cách chọn storage address
    virtual uint32_t ResolveBlockAddress(uint16_t block_id) {
        return BASE_ADDRESS + (block_id * BLOCK_SIZE);
    }

private:
    // === PRIVATE – implementation details, không ai cần biết ===
    // Ghi raw vào hardware – không được expose ra ngoài vì bypass validation
    bool WriteRaw(uint32_t address, std::span<const uint8_t> data);

    // Cấu trúc nội bộ cho block metadata
    struct BlockDescriptor {
        uint32_t address;
        uint16_t size;
        uint8_t  crc;
    };

    BlockDescriptor* FindBlock(uint16_t block_id);

    // Data members – hoàn toàn ẩn
    bool                       initialized_    {false};
    std::array<BlockDescriptor, MAX_BLOCKS> block_table_ {};

    static constexpr uint32_t BASE_ADDRESS {0x0800'4000};
    static constexpr uint16_t BLOCK_SIZE   {256};
    static constexpr std::size_t MAX_BLOCKS {64};
};
```

### 1.2 struct vs class – Một khác biệt duy nhất

```cpp
// C++: struct và class CHỈ khác ở default access
struct Point {     // default: PUBLIC (convention: dùng cho plain data)
    float x, y;
};

class Engine {     // default: PRIVATE (convention: dùng khi có invariant)
    float rpm_;
};

// Cả hai đều fully OOP – struct CÓ THỂ có methods, virtual, inheritance
struct Config {    // vẫn là struct nhưng có methods
    int timeout_ms {5000};
    bool retry     {true};

    bool IsValid() const noexcept {
        return timeout_ms > 0 && timeout_ms <= 60000;
    }
};
```

> **💡 Quy ước thực tế:** `struct` cho POD/aggregate data không có invariant. `class` khi cần invariant contract.

---

## 2. Invariant Contract – Trái tim của Encapsulation

### 2.1 Invariant là gì?

**Invariant** (bất biến) = điều kiện luôn đúng với mọi object hợp lệ của class.

Encapsulation đảm bảo invariant bằng cách:
1. Khởi tạo object ở trạng thái hợp lệ (constructor)
2. Duy trì trạng thái hợp lệ sau mỗi operation (public methods)
3. Không bao giờ để object ở trạng thái inconsistent

```cpp
// EngineController với invariant rõ ràng
class EngineController {
    // === INVARIANTS (không bao giờ bị vi phạm) ===
    // INV1: rpm_ luôn trong [0, MAX_RPM]
    // INV2: running_ == true ⟺ rpm_ > IDLE_THRESHOLD
    // INV3: overheated_ == true ⟹ temperature_ > OVERHEAT_THRESHOLD
    // INV4: fuel_level_ luôn trong [0.0, 1.0]

public:
    // Constructor: thiết lập invariant từ đầu
    explicit EngineController() {
        // Giá trị mặc định thỏa mãn tất cả invariant
        assert(CheckInvariant() && "Constructor phá vỡ invariant");
    }

    // Mỗi setter phải DUY TRÌ invariant
    [[nodiscard]] bool SetRpm(int new_rpm) {
        // Kiểm tra precondition
        if (new_rpm < 0 || new_rpm > MAX_RPM) return false;

        rpm_ = new_rpm;
        // Cập nhật các field liên quan để duy trì INV2
        running_ = (rpm_ > IDLE_THRESHOLD);

        // Postcondition: invariant vẫn đúng
        assert(CheckInvariant());
        return true;
    }

    [[nodiscard]] bool SetTemperature(float celsius) {
        if (celsius < MIN_TEMP || celsius > MAX_TEMP) return false;

        temperature_ = celsius;
        // Cập nhật INV3
        overheated_ = (temperature_ > OVERHEAT_THRESHOLD);

        assert(CheckInvariant());
        return true;
    }

    // Getters – const, không thay đổi state, không thể phá invariant
    int   GetRpm()         const noexcept { return rpm_; }
    float GetTemperature() const noexcept { return temperature_; }
    bool  IsRunning()      const noexcept { return running_; }
    bool  IsOverheated()   const noexcept { return overheated_; }

private:
    // Kiểm tra tất cả invariant – dùng trong assert
    bool CheckInvariant() const noexcept {
        if (rpm_ < 0 || rpm_ > MAX_RPM)              return false;
        if (running_ != (rpm_ > IDLE_THRESHOLD))      return false;
        if (overheated_ && temperature_ <= OVERHEAT_THRESHOLD) return false;
        if (fuel_level_ < 0.0f || fuel_level_ > 1.0f) return false;
        return true;
    }

    int   rpm_         {0};
    float temperature_ {20.0f};
    float fuel_level_  {1.0f};   // 1.0 = full tank
    bool  running_     {false};
    bool  overheated_  {false};

    static constexpr int   MAX_RPM            {8000};
    static constexpr int   IDLE_THRESHOLD     {500};
    static constexpr float MIN_TEMP           {-40.0f};
    static constexpr float MAX_TEMP           {200.0f};
    static constexpr float OVERHEAT_THRESHOLD {120.0f};
};
```

> **⚠️ Cạm bẫy:** Viết getter/setter cho MỌI field private mà không enforce invariant = không phải encapsulation, chỉ là boilerplate vô nghĩa.

### 2.2 Constructor, Destructor và Exception Safety

```cpp
// RAII: constructor thành công ↔ object hợp lệ; destructor luôn cleanup
class SensorSession {
public:
    // Constructor mở session – nếu thất bại, throw (object không tồn tại)
    explicit SensorSession(uint8_t sensor_id)
        : sensor_id_(sensor_id)
    {
        if (sensor_id >= MAX_SENSORS) {
            // Throw khiến object không bao giờ được tạo
            // → destructor KHÔNG được gọi → không cần cleanup ở đây
            throw std::invalid_argument("sensor_id out of range");
        }
        if (!hardware_.OpenSensor(sensor_id_)) {
            throw std::runtime_error("Cannot open sensor");
        }
        session_handle_ = hardware_.AllocateSession();
        // Tại đây object hoàn toàn hợp lệ – invariant đã được thiết lập
    }

    // Destructor LUÔN được gọi nếu constructor thành công
    ~SensorSession() {
        // Cleanup không throw exception (noexcept)
        hardware_.CloseSession(session_handle_);
        hardware_.CloseSensor(sensor_id_);
    }

    // Không copy – session là unique resource
    SensorSession(SensorSession const&)            = delete;
    SensorSession& operator=(SensorSession const&) = delete;

    // Move OK – transfer ownership
    SensorSession(SensorSession&& other) noexcept
        : sensor_id_(other.sensor_id_)
        , session_handle_(other.session_handle_)
    {
        // Vô hiệu hóa object cũ – destructor không cleanup
        other.session_handle_ = INVALID_HANDLE;
    }

    float ReadValue() const {
        if (session_handle_ == INVALID_HANDLE) {
            throw std::logic_error("Session has been moved");
        }
        return hardware_.ReadSensor(sensor_id_);
    }

private:
    uint8_t  sensor_id_;
    uint32_t session_handle_   {INVALID_HANDLE};
    SensorHardware& hardware_  {SensorHardware::Instance()};

    static constexpr uint32_t INVALID_HANDLE {0xFFFF'FFFF};
    static constexpr uint8_t  MAX_SENSORS    {16};
};
```

---

## 3. Const Correctness – Cam kết "Tôi không thay đổi gì"

### 3.1 const member function

**Vấn đề cần giải quyết:** không có const correctness, không thể phân biệt "method này an toàn gọi từ const object" và "method này thay đổi state".

```cpp
class DtcStatusRegister {
public:
    explicit DtcStatusRegister(uint8_t initial = 0) : raw_(initial) {}

    // const method – cam kết không thay đổi object
    // Có thể gọi từ: const DtcStatusRegister& hoặc const DtcStatusRegister*
    bool IsTestFailed()  const noexcept { return (raw_ & 0x01) != 0; }
    bool IsConfirmed()   const noexcept { return (raw_ & 0x08) != 0; }
    bool IsPending()     const noexcept { return (raw_ & 0x04) != 0; }
    uint8_t RawValue()   const noexcept { return raw_; }

    // non-const method – thay đổi state
    void SetBit(uint8_t bit, bool value) noexcept {
        if (value) raw_ |=  (1u << bit);
        else       raw_ &= ~(1u << bit);
    }

    // const overload – trả về bằng const reference (không copy, không sửa)
    // non-const overload – trả về bằng reference (có thể sửa)
    uint8_t const& GetRaw() const noexcept { return raw_; }
    uint8_t&       GetRaw()       noexcept { return raw_; }

private:
    uint8_t raw_ {0};
};

// Const correctness trong action:
void PrintStatus(DtcStatusRegister const& reg) {
    // OK: IsTestFailed() và IsConfirmed() đều là const methods
    std::cout << "Failed=" << reg.IsTestFailed()
              << " Confirmed=" << reg.IsConfirmed() << "\n";
    // COMPILER ERROR: reg.SetBit(0, true) – không thể gọi non-const method
}

void UpdateStatus(DtcStatusRegister& reg) {
    // OK: có thể gọi cả const và non-const methods
    reg.SetBit(0, true);   // testFailed
    reg.SetBit(3, true);   // confirmed
}
```

### 3.2 mutable – Ngoại lệ hợp lệ

**Khi nào dùng `mutable`:** khi field thay đổi nhưng KHÔNG ảnh hưởng đến "logical state" của object từ góc nhìn caller. Ví dụ điển hình: cache, mutex, lazy initialization.

```cpp
class SensorCache {
public:
    explicit SensorCache(HardwareDriver& drv) : driver_(drv) {}

    // Về mặt logic: hàm này chỉ "đọc" sensor value → const
    // Nhưng nó cần cập nhật cache → phải dùng mutable
    float GetTemperature() const {
        if (!cache_valid_) {
            // Cập nhật cache – OK vì cache là implementation detail
            // Không thay đổi "logical state" của SensorCache đối với caller
            cached_temperature_ = driver_.ReadTemperatureRaw() * SCALE_FACTOR;
            cache_valid_ = true;
        }
        return cached_temperature_;
    }

    // Invalidate cache sau khi hardware update
    void InvalidateCache() noexcept {
        cache_valid_ = false;
    }

private:
    HardwareDriver& driver_;

    // mutable: có thể thay đổi ngay cả trong const method
    mutable float cached_temperature_ {0.0f};
    mutable bool  cache_valid_         {false};

    static constexpr float SCALE_FACTOR {0.0625f};
};

// Thread-safe version – mutex cần mutable trong const method
class ThreadSafeSensorCache {
public:
    float GetTemperature() const {
        std::lock_guard<std::mutex> lock(mutex_);  // mutex_ phải mutable!
        if (!cache_valid_) {
            cached_temperature_ = driver_.ReadTemperatureRaw() * SCALE_FACTOR;
            cache_valid_ = true;
        }
        return cached_temperature_;
    }

private:
    HardwareDriver& driver_;
    mutable std::mutex mutex_;             // mutex là mutable – bắt buộc
    mutable float      cached_temperature_ {0.0f};
    mutable bool       cache_valid_        {false};
    static constexpr float SCALE_FACTOR    {0.0625f};
};
```

> **⚠️ Cạm bẫy:** Dùng `mutable` để lách quy tắc const (`mutable int state_` rồi sửa nó trong const method) là code smell nặng. `mutable` chỉ hợp lệ khi field thực sự là implementation cache/mutex, không phải business state.

### 3.3 const trong function parameters

```cpp
// Quy tắc truyền tham số:
// - Primitive types (int, float, bool): truyền by value
// - Large types: truyền bằng const& (tránh copy, không sửa)
// - Cần sửa: truyền bằng & (non-const)
// - Cần ownership transfer: truyền bằng value (move semantics)

void ProcessConfig(
    uint32_t                      timeout_ms,   // small – by value
    std::string const&            service_name, // large string – const ref
    std::vector<uint8_t> const&   payload,      // large vector – const ref
    DiagnosticContext&            ctx,           // cần sửa – non-const ref
    std::unique_ptr<Handler>      handler        // ownership – by value (moved)
) {
    // timeout_ms, service_name, payload: đảm bảo không bị sửa
    // ctx: được phép sửa
    // handler: ownership đã chuyển vào function
}
```

---

## 4. friend – Ngoại lệ kiểm soát truy cập

### 4.1 friend function

**Vấn đề:** `operator<<` cho ostream KHÔNG thể là member của class (vì `ostream` là left operand), nhưng cần truy cập private data.

```cpp
class NvmBlock {
public:
    explicit NvmBlock(uint32_t addr, uint16_t size)
        : address_(addr), size_(size) {}

    // Khai báo friend function – nằm ngoài class nhưng có quyền truy cập private
    // friend KHÔNG làm hàm này trở thành member – nằm ở global scope
    friend std::ostream& operator<<(std::ostream& os, NvmBlock const& block);

    // Cũng có thể dùng friend class
    friend class NvmBlockSerializer;  // serializer cần access toàn bộ fields

private:
    uint32_t address_;
    uint16_t size_;
    uint8_t  crc_     {0};
    bool     dirty_   {false};
};

// Định nghĩa bên ngoài class – có thể truy cập private members
std::ostream& operator<<(std::ostream& os, NvmBlock const& block) {
    os << "NvmBlock{addr=0x" << std::hex << block.address_   // private!
       << " size=" << std::dec << block.size_                  // private!
       << " crc=0x" << std::hex << (int)block.crc_             // private!
       << " dirty=" << block.dirty_ << "}";                    // private!
    return os;
}

// Serializer class có quyền đọc toàn bộ NvmBlock
class NvmBlockSerializer {
public:
    std::vector<uint8_t> Serialize(NvmBlock const& block) {
        std::vector<uint8_t> result;
        // Truy cập private fields trực tiếp vì là friend class
        auto addr = block.address_;   // private!
        auto size = block.size_;      // private!
        // ... serialization logic
        return result;
    }
};
```

### 4.2 Khi nào dùng friend?

**Hợp lệ:**
- `operator<<`, `operator>>` khi cần truy cập private
- Test class cần white-box testing (test fixture)
- Closely coupled classes (e.g., Iterator và Container)

**Không hợp lệ:**
- Dùng `friend` để tránh thiết kế public API đúng cách
- Lazy: "thêm friend cho tiện" thay vì tạo accessor

```cpp
// Ví dụ hợp lệ: Iterator là friend của Container
class EventMemory {
    friend class EventMemoryIterator;  // iterator cần truy cập internal structure
public:
    EventMemoryIterator begin();
    EventMemoryIterator end();
private:
    std::array<EventEntry, 32> entries_;
    std::size_t count_ {0};
};

class EventMemoryIterator {
public:
    explicit EventMemoryIterator(EventMemory& mem, std::size_t idx)
        : memory_(mem), index_(idx) {}

    EventEntry& operator*() {
        return memory_.entries_[index_];  // truy cập private vì là friend
    }

    EventMemoryIterator& operator++() { ++index_; return *this; }
    bool operator!=(EventMemoryIterator const& other) const {
        return index_ != other.index_;
    }

private:
    EventMemory&  memory_;
    std::size_t   index_;
};
```

---

## 5. Pimpl Idiom – Ẩn hoàn toàn implementation

### 5.1 Vấn đề khi implementation lộ trong header

**Vấn đề cần giải quyết:** mọi file include header của class đều phụ thuộc vào private implementation details. Thay đổi private member → toàn bộ code recompile. Struct private leak ra binary interface.

```cpp
// BAD – header lộ implementation details
// diag_service.h
#include "nvm_driver.h"    // detail dependency – mọi includer phải biết về NvmDriver
#include "can_driver.h"    // tương tự
#include "dem_types.h"     // tương tự

class DiagnosticService {
public:
    bool Initialize();
    bool ProcessRequest(DiagRequest const& req);
private:
    NvmDriver  nvm_;       // thay đổi NvmDriver → mọi includer recompile
    CanDriver  can_;
    DemContext dem_ctx_;
    uint32_t   session_timeout_ms_ {5000};
    bool       initialized_        {false};
    // ... 20 more private fields
};
// Thêm 1 field private → toàn bộ project recompile!
```

**Cơ chế Pimpl:**

```
diag_service.h (public interface):        diag_service.cpp (implementation):
┌─────────────────────────────┐            ┌──────────────────────────────┐
│ class DiagnosticService {   │            │ #include "nvm_driver.h"      │
│   class Impl;               │  ─── ─ ─→  │ #include "can_driver.h"      │
│   std::unique_ptr<Impl> p_; │            │                              │
│ public:                     │            │ struct DiagnosticService::   │
│   Initialize();             │            │   Impl {                     │
│   ProcessRequest(...);      │            │     NvmDriver nvm;           │
│ };                          │            │     CanDriver can;           │
└─────────────────────────────┘            │     DemContext dem;          │
  Caller chỉ thấy forward decl            │   };                         │
  → không phụ thuộc NvmDriver             └──────────────────────────────┘
```

```cpp
// === diag_service.hpp – chỉ là interface, không lộ implementation ===
#pragma once
#include <memory>  // std::unique_ptr – không cần include implementation headers

// Forward declaration (không include) – giảm compile dependencies
struct DiagRequest;
struct DiagResponse;

class DiagnosticService {
public:
    explicit DiagnosticService();    // constructor trong .cpp
    ~DiagnosticService();            // destructor trong .cpp (unique_ptr<Impl> cần thấy ~Impl)

    // Copy semantics cần implement trong .cpp (Impl phải copyable)
    DiagnosticService(DiagnosticService const&);
    DiagnosticService& operator=(DiagnosticService const&);

    // Move semantics – default OK với unique_ptr
    DiagnosticService(DiagnosticService&&)            noexcept = default;
    DiagnosticService& operator=(DiagnosticService&&) noexcept = default;

    bool Initialize();
    bool ProcessRequest(DiagRequest const& req, DiagResponse& resp);
    bool IsInitialized() const noexcept;

private:
    // Forward declaration của implementation struct
    // Caller không bao giờ thấy nội dung của Impl
    struct Impl;
    std::unique_ptr<Impl> p_;  // heap-allocated, ABI-stable pointer
};

// === diag_service.cpp – implementation, CÁCh duy nhất include dependencies ===
#include "diag_service.hpp"
#include "nvm_driver.hpp"    // chỉ .cpp biết về dependency này
#include "can_driver.hpp"
#include "dem_interface.hpp"

// Định nghĩa đầy đủ Impl – ẩn hoàn toàn trong .cpp
struct DiagnosticService::Impl {
    NvmDriver  nvm;
    CanDriver  can;
    DemInterface dem;
    uint32_t   session_timeout_ms {5000};
    bool       initialized        {false};
    uint8_t    active_session     {0x01};

    // Constructor chỉ visible trong .cpp
    explicit Impl() {
        dem.SetNvmInterface(nvm);
    }
};

// Tất cả methods được implement tại đây, delegate sang p_->...
DiagnosticService::DiagnosticService()
    : p_(std::make_unique<Impl>())   // khởi tạo Impl trên heap
{}

// Destructor phải ở .cpp vì unique_ptr<Impl> cần thấy ~Impl() để gọi delete
DiagnosticService::~DiagnosticService() = default;

bool DiagnosticService::Initialize() {
    if (!p_->nvm.Open()) return false;
    if (!p_->can.Initialize()) return false;
    p_->initialized = true;
    return true;
}

bool DiagnosticService::ProcessRequest(DiagRequest const& req, DiagResponse& resp) {
    if (!p_->initialized) return false;
    // ... delegate logic to p_-> fields
    return true;
}

bool DiagnosticService::IsInitialized() const noexcept {
    return p_->initialized;
}
```

### 5.2 Khi nào nên dùng Pimpl?

| Tình huống | Dùng Pimpl? |
|---|---|
| Public library API (binary compatibility) | **Bắt buộc** |
| Module có nhiều dependencies nặng | Nên dùng (giảm compile time) |
| Class nội bộ, ít thay đổi | Không cần |
| Performance-critical hot path | Cẩn thận (thêm heap allocation + indirection) |
| AUTOSAR AP service skeleton | Thường dùng (AP Runtime ẩn implementation) |

> **💡 Điểm mấu chốt:** Pimpl là **binary encapsulation** – ẩn hoàn toàn implementation khỏi ABI. Tất cả thay đổi trong `Impl` không cần recompile caller code.

---

## 6. Encapsulation trong AUTOSAR Adaptive Platform

### 6.1 ara::core::Result<T> – Encapsulation lỗi

```cpp
// Result<T> encapsulates (value OR error) – caller PHẢI handle cả hai
// Không thể "vô tình" bỏ qua lỗi như với raw pointers hay error codes

ara::core::Result<SensorReading> ReadSensor(uint8_t id) {
    if (id >= MAX_SENSORS) {
        return ara::core::Result<SensorReading>::FromError(
            ara::core::ErrorCode{SensorErrorDomain::kInvalidId, id});
    }
    SensorReading reading = hardware_.Sample(id);
    return ara::core::Result<SensorReading>::FromValue(reading);
}

// Fluent error handling – không cần kiểm tra null/errcode thủ công
void ProcessVehicleData() {
    ReadSensor(3)
        .AndThen([](SensorReading const& r) {
            // Chỉ được gọi nếu HasValue() == true
            return ValidateReading(r);
        })
        .MapError([](ara::core::ErrorCode const& err) {
            // Transform lỗi nếu cần
            return DiagnosticError{err};
        })
        .ValueOr(SensorReading::Invalid());  // fallback
}
```

### 6.2 DTC Status Byte – Encapsulation bit manipulation

```cpp
// Thay vì để caller tự bitmask, encapsulate logic trong class
class DtcStatus {
public:
    // Named bit positions – thay vì magic numbers
    static constexpr uint8_t kTestFailed          {0};
    static constexpr uint8_t kFailedThisOC        {1};
    static constexpr uint8_t kPendingDTC          {2};
    static constexpr uint8_t kConfirmedDTC        {3};
    static constexpr uint8_t kFailedSinceLastClear{5};
    static constexpr uint8_t kWarningIndicator    {7};

    // Factory methods với meaningful names
    static DtcStatus FromRaw(uint8_t raw) noexcept {
        DtcStatus s; s.raw_ = raw; return s;
    }

    static DtcStatus Confirmed() noexcept {
        DtcStatus s;
        s.SetBit(kTestFailed, true);
        s.SetBit(kFailedThisOC, true);
        s.SetBit(kPendingDTC, true);
        s.SetBit(kConfirmedDTC, true);
        s.SetBit(kFailedSinceLastClear, true);
        s.SetBit(kWarningIndicator, true);
        return s;
    }

    static DtcStatus Healed() noexcept {
        DtcStatus s;
        // Xóa active bits, giữ history bits
        s.SetBit(kTestFailed, false);
        s.SetBit(kWarningIndicator, false);
        s.SetBit(kFailedSinceLastClear, true);  // lịch sử vẫn còn
        return s;
    }

    bool IsTestFailed()            const noexcept { return GetBit(kTestFailed); }
    bool IsConfirmed()             const noexcept { return GetBit(kConfirmedDTC); }
    bool IsWarningActive()         const noexcept { return GetBit(kWarningIndicator); }
    bool IsFailedSinceLastClear()  const noexcept { return GetBit(kFailedSinceLastClear); }

    uint8_t Raw() const noexcept { return raw_; }

    // Merge: cập nhật status theo mask (để caller không làm bitmask thủ công)
    void UpdateFrom(DtcStatus const& other, uint8_t mask) noexcept {
        raw_ = (raw_ & ~mask) | (other.raw_ & mask);
    }

private:
    bool GetBit(uint8_t pos) const noexcept { return (raw_ >> pos) & 1u; }
    void SetBit(uint8_t pos, bool v) noexcept {
        if (v) raw_ |=  (1u << pos);
        else   raw_ &= ~(1u << pos);
    }

    uint8_t raw_ {0};
};
```

---

## 7. Bài tập thực hành

### Bài 1 – Thiết kế class với invariant chặt

**Yêu cầu:** Tạo class `VehicleSpeed` với các invariant:
- Tốc độ không âm và không vượt quá 300 km/h
- Khi `is_reverse_ == true` thì `speed_kmh_` không quá 30 km/h
- `acceleration_ms2_` phải trong `[-15.0, 5.0]` (giới hạn vật lý xe)

```cpp
class VehicleSpeed {
public:
    // Gợi ý: dùng factory method hoặc constructor với validation
    // Mọi setter phải trả về bool (success/failure)
    // CheckInvariant() dùng trong assert
};

// Test cases:
// VehicleSpeed s;
// assert(s.SetSpeed(100.0f) == true);   // OK
// assert(s.SetSpeed(-10.0f) == false);  // Từ chối
// assert(s.SetReverse(true) == true);   // OK khi speed đang thấp
// assert(s.SetSpeed(50.0f) == false);   // Từ chối khi đang reverse (>30)
```

**Đáp án gợi ý:**

```cpp
class VehicleSpeed {
public:
    [[nodiscard]] bool SetSpeed(float kmh) {
        if (kmh < 0.0f) return false;
        if (kmh > MAX_SPEED_KMH) return false;
        if (is_reverse_ && kmh > MAX_REVERSE_SPEED_KMH) return false;
        speed_kmh_ = kmh;
        assert(CheckInvariant());
        return true;
    }

    [[nodiscard]] bool SetReverse(bool reverse) {
        if (reverse && speed_kmh_ > MAX_REVERSE_SPEED_KMH) {
            // Không thể engage reverse khi đang chạy nhanh
            return false;
        }
        is_reverse_ = reverse;
        assert(CheckInvariant());
        return true;
    }

    [[nodiscard]] bool SetAcceleration(float accel_ms2) {
        if (accel_ms2 < MIN_ACCEL || accel_ms2 > MAX_ACCEL) return false;
        acceleration_ms2_ = accel_ms2;
        assert(CheckInvariant());
        return true;
    }

    float GetSpeed()        const noexcept { return speed_kmh_; }
    bool  IsReverse()       const noexcept { return is_reverse_; }
    float GetAcceleration() const noexcept { return acceleration_ms2_; }

private:
    bool CheckInvariant() const noexcept {
        if (speed_kmh_ < 0.0f || speed_kmh_ > MAX_SPEED_KMH)     return false;
        if (is_reverse_ && speed_kmh_ > MAX_REVERSE_SPEED_KMH)    return false;
        if (acceleration_ms2_ < MIN_ACCEL || acceleration_ms2_ > MAX_ACCEL) return false;
        return true;
    }

    float speed_kmh_       {0.0f};
    bool  is_reverse_      {false};
    float acceleration_ms2_{0.0f};

    static constexpr float MAX_SPEED_KMH         {300.0f};
    static constexpr float MAX_REVERSE_SPEED_KMH {30.0f};
    static constexpr float MIN_ACCEL             {-15.0f};
    static constexpr float MAX_ACCEL             {5.0f};
};
```

### Bài 2 – Áp dụng Pimpl cho DiagnosticLogger

**Yêu cầu:** Tạo một `DiagnosticLogger` class với:
- Interface chỉ expose 3 methods: `Log(level, message)`, `Flush()`, `SetLevel(min_level)`
- Implementation dùng `std::deque<LogEntry>` với mutex thread safety
- Dùng Pimpl để ẩn toàn bộ implementation kể cả mutex và deque khỏi header

---

## Tóm tắt

| Kỹ thuật | Vấn đề giải quyết | Bối cảnh sử dụng |
|---|---|---|
| `private` members + setters | Ngăn trạng thái không hợp lệ | Mọi class có invariant |
| Invariant contract | Đảm bảo object luôn hợp lệ | `EngineController`, `VehicleSpeed` |
| `const` method | Phân biệt read vs. modify | Mọi getter, query method |
| `mutable` | Cache/mutex trong const method | `SensorCache`, `ThreadSafeCache` |
| `friend` | Operator overloading, Iterator | `operator<<`, Container/Iterator |
| Pimpl idiom | Ẩn implementation, giảm compile deps | Public library, complex services |
| Factory methods | Kiểm soát object creation | `DtcStatus::Confirmed()`, `Result::FromValue()` |

---

**← Phần trước:** [C++ Nâng cao Phần 4: Design Patterns & AP Architecture](/adaptive-cpp/cpp-patterns/)
**Phần tiếp →** [OOP Phần 6: Inheritance](/adaptive-cpp/cpp-oop-inheritance/)
