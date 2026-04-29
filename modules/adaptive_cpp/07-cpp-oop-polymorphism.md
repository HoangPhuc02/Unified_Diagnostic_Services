---
layout: default
title: "Advanced C++ – Phần 7: Polymorphism – Đa hình & Dispatch"
description: "Polymorphism trong C++ toàn diện – vtable/vptr mechanics, CRTP compile-time polymorphism, std::variant/visit, covariant return, dynamic_cast/RTTI, và ứng dụng trong AUTOSAR AP service registry."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-oop-polymorphism/
tags: [cpp, oop, polymorphism, vtable, crtp, variant, rtti, dynamic-cast, adaptive-autosar]
---

# Advanced C++ – Phần 7: Polymorphism – Đa hình & Dispatch

> **Mục tiêu bài này:** Hiểu cơ chế dispatch (tĩnh và động), vtable/vptr memory layout, các téchnique polymorphism không dùng vtable (CRTP, variant), và khi nào chọn cái nào.
>
> **Series OOP:**
> → [Phần 5: Encapsulation](/adaptive-cpp/cpp-oop-encapsulation/)
> → [Phần 6: Inheritance](/adaptive-cpp/cpp-oop-inheritance/)
> → **Phần 7 (bài này): Polymorphism**
> → [Phần 8: Abstraction & SOLID](/adaptive-cpp/cpp-oop-abstraction/)

---

## Tổng quan

```
Polymorphism trong C++
├── A. Runtime (dynamic) polymorphism
│   ├── 1. vtable / vptr mechanics        – cơ chế bên dưới
│   ├── 2. virtual / override / final     – keywords và semantics
│   ├── 3. Pure virtual & abstract class  – interface via class
│   ├── 4. Virtual destructor             – tại sao bắt buộc
│   ├── 5. Covariant return types         – override linh hoạt
│   └── 6. dynamic_cast & RTTI            – type-safe downcast
│
└── B. Compile-time (static) polymorphism
    ├── 7. CRTP                           – zero overhead, no vtable
    ├── 8. std::variant + std::visit      – algebraic type, no heap
    └── 9. Concepts (C++20)               – constrained templates
```

---

## Phần A: Runtime Polymorphism

## 1. vtable và vptr – Cơ chế bên dưới

### 1.1 Tại sao virtual call cần vtable?

**Vấn đề:** C++ phải biết tại **runtime** nên gọi function nào khi ta chỉ có `Base*`. Với function non-virtual, compiler biết ngay tại compile time (static dispatch). Với `virtual`, chỉ biết khi chạy.

**Giải pháp:** mỗi polymorphic class có một `vtable` (function pointer array), và mỗi object có một hidden `vptr` trỏ vào `vtable` của class cụ thể tại runtime.

```
Memory khi gọi virtual:

    Base* bp = new Derived();

    Stack:          Heap:
    ┌────────┐     ┌──────────────────────────────────┐
    │   bp   │────►│  vptr  │  data members...         │
    └────────┘     └──┬─────┴──────────────────────────┘
                      │
                      ▼
               Derived's vtable:
               ┌─────────────────────────────┐
               │ [0] &Derived::VirtualFunc1  │
               │ [1] &Derived::VirtualFunc2  │
               │ [2] &Base::VirtualFunc3     │  ← không override → giữ base
               └─────────────────────────────┘

    bp->VirtualFunc1()
    → load vptr từ object
    → load function pointer tại index 0 trong vtable
    → call qua function pointer
    (2 memory indirections thay vì 0 của non-virtual call)
```

```cpp
class Shape {
public:
    virtual ~Shape()             = default;
    virtual float Area()   const = 0;  // slot [0]
    virtual float Perimeter() const = 0; // slot [1]
    virtual void  Draw()         {}     // slot [2] – có default impl
};

class Circle : public Shape {
public:
    explicit Circle(float r) : r_(r) {}
    float Area()      const override { return 3.14159f * r_ * r_; }  // override slot [0]
    float Perimeter() const override { return 2.0f * 3.14159f * r_; } // override slot [1]
    // Draw() – không override → slot [2] giữ Shape::Draw()
private:
    float r_;
};

class Rectangle : public Shape {
public:
    Rectangle(float w, float h) : w_(w), h_(h) {}
    float Area()      const override { return w_ * h_; }
    float Perimeter() const override { return 2.0f * (w_ + h_); }
private:
    float w_, h_;
};

// Runtime dispatch:
std::vector<std::unique_ptr<Shape>> shapes;
shapes.push_back(std::make_unique<Circle>(5.0f));
shapes.push_back(std::make_unique<Rectangle>(3.0f, 4.0f));
shapes.push_back(std::make_unique<Circle>(2.0f));

for (auto const& s : shapes) {
    // Area() và Perimeter() đều dispatch đúng loại tại runtime
    std::cout << "Area=" << s->Area()
              << " Perim=" << s->Perimeter() << "\n";
}
```

### 1.2 Chi phí của vtable

| Loại call | Mechanism | Overhead |
|---|---|---|
| Non-virtual function | Direct call (compile-time address) | 0 |
| Virtual function | 2 loads + indirect call | 1–5 ns (cache dependent) |
| Virtual với branch prediction | CPU caches vptr | Gần 0 nếu pattern stable |
| Devirtualization (compiler) | Compiler inline virtual | 0 – nếu type known tại compile time |

**Kích thước object:** mỗi class có virtual method thêm 1 `vptr` (8 bytes trên 64-bit). Khi class KHÔNG có virtual method – không có vptr.

> **💡 Điểm mấu chốt:** vtable overhead rất nhỏ trong thực tế. Lo ngại về hiệu năng virtual chỉ đúng trong hot loops với container lớn và nhiều different types. Trong kiến trúc dịch vụ như AUTOSAR AP, virtual hoàn toàn phù hợp.

---

## 2. virtual / override / final – Semantics chi tiết

### 2.1 Quy tắc override

```cpp
class ServiceInterface {
public:
    virtual ~ServiceInterface() = default;

    // Chỉ override nếu SIGNATURE HOÀN TOÀN KHỚP:
    // 1. Tên method
    // 2. Danh sách parameter types (không tính tên parameter)
    // 3. const/volatile qualifiers
    // 4. ref qualifiers (&, &&)
    virtual void Process(int id, float value) = 0;
    virtual void Process(std::string_view name) = 0;  // overload – khác signature
    virtual int  Query() const = 0;
};

class ConcreteService : public ServiceInterface {
public:
    // OK: tên + params + (không const) khớp
    void Process(int id, float value) override {}

    // OK: tên + string_view param khớp
    void Process(std::string_view name) override {}

    // OK: const qualifier khớp
    int Query() const override { return 42; }

    // Được CAUGHT bởi override keyword:
    // void Process(int id, double value) override {} // ERROR: float≠double
    // int Query() override {}        // ERROR: thiếu const
    // void process(int, float) override {}  // ERROR: tên khác (lowercase p)
};
```

### 2.2 Khi không có override – Nguy hiểm

```cpp
class LoggerBase {
public:
    virtual void LogInfo(std::string_view msg) {
        std::cout << "[INFO] " << msg << "\n";
    }
};

class FileLogger : public LoggerBase {
public:
    // BAD: quên override, viết nhầm signature
    // Không có 'override' → compiler không báo lỗi
    // Đây là method mới hoàn toàn, không liên quan LoggerBase::LogInfo
    void LogInfo(std::string msg) {  // std::string thay vì std::string_view!
        file_ << "[INFO] " << msg << "\n";
    }

    // GOOD: dùng override → compiler NGAY LẬP TỨC báo lỗi
    // void LogInfo(std::string msg) override {}  // ERROR caught!
private:
    std::ofstream file_;
};

LoggerBase* logger = new FileLogger();
logger->LogInfo("test");
// Gọi LoggerBase::LogInfo – FileLogger::LogInfo(string) không được gọi!
// Bug im lặng không có warning
```

### 2.3 Covariant Return Types

```cpp
// Covariant return: override có thể trả về kiểu Derived* thay vì Base*
// Điều kiện: kiểu trả về của override phải là derived pointer/reference
//            từ kiểu trả về của base

class VehicleFactory {
public:
    virtual Vehicle* Create() const = 0;  // trả về Base*
    virtual ~VehicleFactory() = default;
};

class ElectricVehicleFactory : public VehicleFactory {
public:
    // Covariant: trả về ElectricVehicle* (derived từ Vehicle*)
    // Vẫn là override hợp lệ!
    ElectricVehicle* Create() const override {
        return new ElectricVehicle("Model3", 100);
    }
};

// Dùng:
ElectricVehicleFactory factory;

// Qua interface đa hình – trả về Vehicle*
VehicleFactory& base = factory;
Vehicle* v = base.Create();  // runtime dispatch

// Gọi trực tiếp – trả về ElectricVehicle* ngay
ElectricVehicle* ev = factory.Create();  // không cần cast!
ev->GetBatteryPercent();  // trực tiếp gọi method của ElectricVehicle
```

---

## 3. Pure virtual và Abstract Class

### 3.1 Quy tắc Abstract Class

```cpp
// Class có ít nhất 1 pure virtual method = abstract class
// Không thể tạo instance trực tiếp
class AbstractSensor {
public:
    virtual ~AbstractSensor() = default;

    // Pure virtual – PHẢI override trong subclass trước khi instantiate
    virtual float Read() const = 0;
    virtual bool  Calibrate(float ref_value) = 0;
    virtual std::string GetType() const = 0;

    // Non-pure virtual – có default impl nhưng có thể override
    virtual bool SelfTest() {
        float val = Read();
        return val > 0.0f;  // generic test
    }

    // Non-virtual – không thể override (không phải extension point)
    float ReadCalibrated() const {
        return Read() * calibration_factor_;
    }

    void SetCalibrationFactor(float f) noexcept {
        calibration_factor_ = f;
    }

protected:
    float calibration_factor_ {1.0f};
};

// AbstractSensor sensor;  // COMPILER ERROR: cannot instantiate abstract class

class PressureSensor : public AbstractSensor {
public:
    float       Read()     const override;
    bool        Calibrate(float ref) override;
    std::string GetType()  const override { return "Pressure"; }
    // SelfTest() – không override, dùng AbstractSensor::SelfTest()
};

// Có thể instantiate PressureSensor (override đủ pure virtual methods)
PressureSensor ps;
float v = ps.ReadCalibrated();  // gọi non-virtual wrapper
```

### 3.2 Pure virtual với default implementation

```cpp
// Ít biết: pure virtual CÓ THỂ có implementation!
// Dùng cho base case luôn phải được gọi explicitly
class Component {
public:
    virtual void Initialize() = 0;  // pure virtual nhưng có thân hàm

    virtual ~Component() = default;
};

// Pure virtual với implementation (ở bên ngoài class)
void Component::Initialize() {
    // Logic cơ bản phải luôn chạy: init base resources
    std::cout << "Component base init\n";
}

class DerivedComponent : public Component {
public:
    void Initialize() override {
        Component::Initialize();  // explicitly gọi base
        // ... thêm logic của DerivedComponent
        std::cout << "DerivedComponent extended init\n";
    }
};

// output:
// Component base init
// DerivedComponent extended init
```

---

## 4. Virtual Destructor – Tại sao bắt buộc

### 4.1 Memory leak khi không có virtual destructor

```cpp
class Resource {
public:
    Resource() : data_(new uint8_t[1024]) {}
    // BAD: non-virtual destructor!
    ~Resource() {         // non-virtual
        delete[] data_;
        std::cout << "Resource cleaned\n";
    }
private:
    uint8_t* data_;
};

class CriticalResource : public Resource {
public:
    CriticalResource() : Resource(), log_(new char[4096]) {}
    ~CriticalResource() {   // non-virtual (match base)
        delete[] log_;
        std::cout << "CriticalResource cleaned\n";
    }
private:
    char* log_;
};

// BUG:
Resource* res = new CriticalResource();
delete res;
// Gọi: Resource::~Resource() (non-virtual → static dispatch)
// KHÔNG gọi: CriticalResource::~CriticalResource()
// log_ (4096 bytes) bị leak!

// Output: "Resource cleaned"
// expected: "CriticalResource cleaned\nResource cleaned"
```

```cpp
// GOOD: virtual destructor
class Resource {
public:
    Resource() : data_(new uint8_t[1024]) {}
    virtual ~Resource() {   // virtual!
        delete[] data_;
        std::cout << "Resource cleaned\n";
    }
private:
    uint8_t* data_;
};

class CriticalResource : public Resource {
public:
    CriticalResource() : Resource(), log_(new char[4096]) {}
    ~CriticalResource() override {   // override
        delete[] log_;
        std::cout << "CriticalResource cleaned\n";
    }
private:
    char* log_;
};

Resource* res = new CriticalResource();
delete res;
// Output đúng:
// CriticalResource cleaned
// Resource cleaned
```

### 4.2 Quy tắc Virtual Destructor

| Tình huống | Cần virtual dtor? |
|---|---|
| Class có bất kỳ `virtual` method | **CÓ** – luôn |
| Class được thiết kế để kế thừa | **CÓ** |
| Abstract base class | **CÓ** – thường `= default` |
| Final class, không bao giờ kế thừa | Không bắt buộc nhưng nên có |
| Class không có virtual method, không kế thừa | Không cần |

```cpp
// Pattern phổ biến: abstract interface
class ISerializer {
public:
    virtual ~ISerializer() = default;  // virtual! = default (empty)
    virtual void Serialize(std::span<const uint8_t> data) = 0;
    virtual std::vector<uint8_t> Deserialize(std::span<const uint8_t> raw) = 0;
};
```

---

## 5. dynamic_cast và RTTI

### 5.1 Khi nào cần dynamic_cast?

**Nguyên tắc:** `dynamic_cast` cho thấy thiếu polymorphism. Nếu thường xuyên cast, refactor code thay vì dùng `dynamic_cast`. Nhưng có một số trường hợp hợp lệ.

```cpp
class DiagRequest {
public:
    virtual ~DiagRequest() = default;
    virtual uint8_t GetSID() const = 0;
};

class ReadDataRequest : public DiagRequest {
public:
    uint8_t GetSID() const override { return 0x22; }
    std::vector<uint16_t> GetDIDs() const { return dids_; }
private:
    std::vector<uint16_t> dids_ {0x1234, 0x5678};
};

class WriteDataRequest : public DiagRequest {
public:
    uint8_t GetSID() const override { return 0x2E; }
    uint16_t GetDID() const { return did_; }
    std::span<const uint8_t> GetData() const { return data_; }
private:
    uint16_t did_ {0};
    std::vector<uint8_t> data_;
};

void ProcessRequest(DiagRequest& req) {
    // dynamic_cast pointer version:
    // → trả về nullptr nếu cast thất bại (không throw)
    if (auto* read = dynamic_cast<ReadDataRequest*>(&req)) {
        // Chắc chắn đây là ReadDataRequest
        for (uint16_t did : read->GetDIDs()) {
            HandleReadDID(did);
        }
        return;
    }

    if (auto* write = dynamic_cast<WriteDataRequest*>(&req)) {
        HandleWriteDID(write->GetDID(), write->GetData());
        return;
    }

    // Không match → unknown request
    std::cerr << "Unknown request SID: " << +req.GetSID() << "\n";
}

// dynamic_cast reference version:
// → throw std::bad_cast nếu thất bại
void ProcessReadRequest(DiagRequest& req) {
    try {
        ReadDataRequest& read = dynamic_cast<ReadDataRequest&>(req);
        for (uint16_t did : read.GetDIDs()) {
            HandleReadDID(did);
        }
    } catch (std::bad_cast const& e) {
        std::cerr << "Expected ReadDataRequest\n";
    }
}
```

### 5.2 typeid và type_info

```cpp
#include <typeinfo>

void InspectType(DiagRequest const& req) {
    // typeid với reference: trả về dynamic type (runtime type)
    std::type_info const& ti = typeid(req);

    // name() phụ thuộc compiler (mangled trên GCC, readable trên MSVC)
    std::cout << "Dynamic type: " << ti.name() << "\n";

    // So sánh types:
    if (typeid(req) == typeid(ReadDataRequest)) {
        std::cout << "Is ReadDataRequest\n";
    }
}

// typeid với pointer – KHÔNG deref:
DiagRequest* p = new ReadDataRequest();
// typeid(*p) → dynamic type (ReadDataRequest) – RTTI lookup
// typeid(p)  → static type (DiagRequest*)       – compile time

delete p;
```

> **⚠️ Cạm bẫy:** `dynamic_cast` yêu cầu RTTI được bật (`-frtti` – default trên GCC/Clang). Một số embedded projects disable RTTI (`-fno-rtti`) để giảm binary size. Trong trường hợp đó: dùng `static_cast` với enum discriminator hoặc CRTP.

---

## Phần B: Compile-time Polymorphism

## 6. CRTP – Curiously Recurring Template Pattern

### 6.1 CRTP là gì?

**CRTP** = class Base là template nhận derived class làm template argument. Cho phép base class gọi derived class methods tại **compile time** – không vtable, không overhead.

```cpp
// Pattern cơ bản:
template <typename Derived>
class Base {
public:
    void Interface() {
        // Downcast về Derived ngay tại compile time – safe vì design ensures this
        static_cast<Derived*>(this)->Implementation();
    }
};

class Concrete : public Base<Concrete> {
public:
    void Implementation() {
        std::cout << "Concrete impl\n";
    }
};
```

### 6.2 CRTP thực tế: Sensor với compile-time dispatch

```cpp
// CRTP base cho tất cả sensor drivers
template <typename Derived>
class SensorBase {
public:
    // Interface: gọi derived implementation – KHÔNG virtual
    float Read() const {
        return static_cast<Derived const*>(this)->ReadImpl();
    }

    bool Calibrate(float ref) {
        return static_cast<Derived*>(this)->CalibrateImpl(ref);
    }

    // Shared implementation: sử dụng Read() đã customize
    float ReadSmoothed(int samples = 5) const {
        float sum = 0.0f;
        for (int i = 0; i < samples; ++i) {
            sum += Read();
        }
        return sum / static_cast<float>(samples);
    }

    bool SelfTest() {
        float val = Read();
        return !std::isnan(val) && !std::isinf(val);
    }
};

// Concrete sensor: inherit từ SensorBase<itself>
class TemperatureSensor : public SensorBase<TemperatureSensor> {
    friend class SensorBase<TemperatureSensor>;  // cho base access private Impl

public:
    explicit TemperatureSensor(uint8_t addr) : i2c_addr_(addr) {}

private:
    float ReadImpl() const {
        // Đọc I2C register
        return static_cast<float>(ReadRawI2C(i2c_addr_)) * 0.0625f;
    }

    bool CalibrateImpl(float ref_temp) {
        float raw = ReadImpl();
        offset_ = ref_temp - raw;
        return true;
    }

    float ReadRawI2C(uint8_t addr) const;  // hardware layer

    uint8_t i2c_addr_;
    float   offset_ {0.0f};
};

class PressureSensor : public SensorBase<PressureSensor> {
    friend class SensorBase<PressureSensor>;

public:
    explicit PressureSensor(uint8_t cs_pin) : cs_pin_(cs_pin) {}

private:
    float ReadImpl() const {
        return ReadSPI(cs_pin_) * 0.01f;  // convert raw to kPa
    }

    bool CalibrateImpl(float ref_bar) {
        scale_ = ref_bar / ReadImpl();
        return true;
    }

    float ReadSPI(uint8_t pin) const;

    uint8_t cs_pin_;
    float   scale_ {1.0f};
};

// Template function dùng CRTP sensors – compile-time specialization
template <typename SensorT>
void MonitorSensor(SensorBase<SensorT>& sensor, std::string_view name) {
    if (!sensor.SelfTest()) {
        std::cerr << name << " self-test FAILED\n";
        return;
    }
    float val = sensor.ReadSmoothed(10);
    std::cout << name << " = " << val << "\n";
}

// Usage:
TemperatureSensor temp_sensor{0x48};
PressureSensor    pres_sensor{2};

MonitorSensor(temp_sensor, "TEMP");
MonitorSensor(pres_sensor, "PRES");
// Không heap, không vtable, compiler có thể inline hoàn toàn
```

### 6.3 CRTP cho mixin static (compile-time)

```cpp
// Singleton pattern qua CRTP – đảm bảo chỉ 1 instance, type-safe
template <typename Derived>
class Singleton {
public:
    static Derived& Instance() {
        static Derived instance;  // Meyer's singleton – thread-safe (C++11)
        return instance;
    }
    // Prevent copy/move
    Singleton(Singleton const&)            = delete;
    Singleton& operator=(Singleton const&) = delete;

protected:
    Singleton() = default;  // chỉ derived class gọi được
};

class DiagnosticManager : public Singleton<DiagnosticManager> {
    friend class Singleton<DiagnosticManager>;  // cho access constructor
public:
    void Register(DiagnosticServiceBase* svc) {
        services_[svc->GetSID()] = svc;
    }
    DiagnosticServiceBase* Find(uint8_t sid) const {
        auto it = services_.find(sid);
        return it != services_.end() ? it->second : nullptr;
    }
private:
    DiagnosticManager() = default;  // private constructor qua Singleton
    std::unordered_map<uint8_t, DiagnosticServiceBase*> services_;
};

// Usage:
DiagnosticManager::Instance().Register(&session_ctrl_svc);
auto* svc = DiagnosticManager::Instance().Find(0x10);
```

### 6.4 So sánh CRTP vs Virtual

| Tiêu chí | Virtual | CRTP |
|---|---|---|
| Dispatch | Runtime | Compile-time |
| Overhead | vptr load + indirect call | 0 (inlined) |
| Heterogeneous container | `vector<Base*>` – OK | Không thể (phải template) |
| Binary size | Nhỏ hơn (chia sẻ code) | Lớn hơn (mỗi type sinh code riêng) |
| Debugability | Dễ | Khó (template errors phức tạp) |
| Khi nào | Hot loop với nhiều types, AP services | Sensor drivers, policy, mixin compile-time |

---

## 7. std::variant và std::visit

### 7.1 Variant là gì?

`std::variant<A, B, C>` = type-safe union – giữ **chính xác một** trong các types đã khai báo, trên **stack** (không heap, không pointer), với exhaustive type-check tại compile time.

```cpp
#include <variant>

// Các kiểu response có thể có của diagnostic request
struct OkResponse {
    std::vector<uint8_t> data;
};

struct NrcResponse {
    uint8_t service_id;
    uint8_t nrc_code;
};

struct PendingResponse {
    uint32_t estimated_ms;
};

// DiagResult là một trong 3 – không cần virtual, không heap cho result type
using DiagResult = std::variant<OkResponse, NrcResponse, PendingResponse>;

DiagResult ProcessDiagRequest(DiagRequest const& req) {
    // ... xử lý
    if (success) {
        return OkResponse{.data = {0x62, 0x12, 0x34, 0xAB}};
    } else if (need_more_time) {
        return PendingResponse{.estimated_ms = 300};
    } else {
        return NrcResponse{.service_id = 0x22, .nrc_code = 0x31};  // requestOutOfRange
    }
}
```

### 7.2 std::visit – Pattern matching trên variant

```cpp
// visit dùng visitor callable với overloads cho mỗi type
// Compiler KIỂM TRA exhaustive: phải handle TẤT CẢ types trong variant

// Helper: overloaded trick (C++17)
template <typename... Ts>
struct Overloaded : Ts... {
    using Ts::operator()...;
};
template <typename... Ts>
Overloaded(Ts...) -> Overloaded<Ts...>;

DiagResult result = ProcessDiagRequest(req);

std::visit(Overloaded{
    [&](OkResponse const& ok) {
        SendResponse(ctx, ok.data);
        std::cout << "OK, " << ok.data.size() << " bytes\n";
    },
    [&](NrcResponse const& nrc) {
        SendNRC(ctx, nrc.service_id, nrc.nrc_code);
        std::cout << "NRC 0x" << std::hex << +nrc.nrc_code << "\n";
    },
    [&](PendingResponse const& pend) {
        SendResponsePending(ctx);
        ScheduleRetry(pend.estimated_ms);
        std::cout << "Pending, retry in " << pend.estimated_ms << " ms\n";
    }
}, result);

// Nếu bỏ một case (ví dụ không handle PendingResponse):
// COMPILER ERROR: could not match type 'PendingResponse' in visitor
// → exhaustive check ở compile time!
```

### 7.3 std::holds_alternative và std::get

```cpp
DiagResult result = /* ... */;

// Kiểm tra type:
if (std::holds_alternative<OkResponse>(result)) {
    auto const& ok = std::get<OkResponse>(result);  // safe: đã kiểm tra
    ProcessOk(ok);
}

// std::get_if – trả về pointer (nullptr nếu sai type, không throw)
if (auto* nrc = std::get_if<NrcResponse>(&result)) {
    std::cout << "NRC: 0x" << std::hex << +nrc->nrc_code << "\n";
}

// std::get mà không kiểm tra – throw std::bad_variant_access nếu sai
try {
    auto const& ok = std::get<OkResponse>(result);
} catch (std::bad_variant_access const&) {
    std::cerr << "Not OkResponse!\n";
}
```

### 7.4 Variant vs Virtual – Khi nào chọn cái nào?

| Tiêu chí | `variant` | virtual |
|---|---|---|
| Số types | Cố định, biết trước | Mở rộng tùy ý |
| Memory | Stack (no heap) | Heap (pointer) |
| Exhaustive check | Compile-time | Không |
| Thêm type mới | Phải sửa tất cả visitor | Chỉ thêm class mới |
| Heterogeneous collection | `vector<variant<A,B,C>>` | `vector<unique_ptr<Base>>` |
| Bối cảnh AUTOSAR AP | Result types, error types | Service hierarchy |

---

## 8. C++20 Concepts – Constrained Polymorphism

### 8.1 Concepts cho kiểm tra tại compile time

```cpp
#include <concepts>

// Concept: type nào cũng được miễn là có Read() trả về float
template <typename T>
concept Readable = requires(T const t) {
    { t.Read() } -> std::convertible_to<float>;
};

// Concept: sensor đầy đủ
template <typename T>
concept SensorLike = Readable<T> && requires(T t, float f) {
    { t.Calibrate(f) } -> std::same_as<bool>;
    { t.GetType()    } -> std::convertible_to<std::string>;
};

// Constrained template – chỉ compile nếu Type thoả SensorLike
template <SensorLike SensorT>
float ReadAndLog(SensorT& sensor) {
    std::cout << "Reading " << sensor.GetType() << ": ";
    float v = sensor.Read();
    std::cout << v << "\n";
    return v;
}

// Dùng concept với requires clause
void ProcessSensors(auto& s1, auto& s2)
    requires SensorLike<decltype(s1)> && SensorLike<decltype(s2)>
{
    float sum = ReadAndLog(s1) + ReadAndLog(s2);
    std::cout << "Sum: " << sum << "\n";
}

// Error message sẽ rõ ràng:
struct BadSensor { int Read() { return 0; } };  // int thay vì float
// ReadAndLog(BadSensor{});
// ERROR: 'BadSensor' does not satisfy 'Readable'
// note: { t.Read() } -> std::convertible_to<float> failed
```

---

## 9. Ứng dụng trong AUTOSAR AP – Service Registry với Runtime Polymorphism

### 9.1 Service Registry hoàn chỉnh

```cpp
// === Service Registry quản lý tất cả Diagnostic Services ===
class DiagnosticServiceRegistry {
public:
    using ServicePtr = std::unique_ptr<DiagnosticServiceBase>;

    // Đăng ký service – ownership transfer
    void Register(ServicePtr svc) {
        uint8_t sid = svc->GetSID();
        if (registry_.count(sid)) {
            ara::log::LogWarn() << "SID 0x" << std::hex << +sid << " already registered, skipping";
            return;
        }
        registry_.emplace(sid, std::move(svc));
    }

    // Factory method đăng ký typed service
    template <typename ServiceT, typename... Args>
    ServiceT& RegisterNew(Args&&... args) {
        auto svc = std::make_unique<ServiceT>(std::forward<Args>(args)...);
        ServiceT* raw = svc.get();
        Register(std::move(svc));
        return *raw;
    }

    // Dispatch request – O(1) lookup + virtual call
    void Dispatch(ara::diag::UdsRequestContext& ctx) {
        uint8_t sid = ctx.GetRequest().data.empty()
                    ? 0x00
                    : ctx.GetRequest().data[0];

        auto it = registry_.find(sid);
        if (it == registry_.end()) {
            ctx.SendNegativeResponse(ara::diag::NrcCode::kServiceNotSupported);
            return;
        }

        // Virtual call – dispatches đúng derived service
        it->second->ProcessRequest(ctx);
    }

    // Dump all registered SIDs (debug/diagnostic)
    std::vector<uint8_t> GetRegisteredSIDs() const {
        std::vector<uint8_t> sids;
        sids.reserve(registry_.size());
        for (auto const& [sid, _] : registry_) {
            sids.push_back(sid);
        }
        return sids;
    }

private:
    std::unordered_map<uint8_t, ServicePtr> registry_;
};

// === Khởi tạo ===
DiagnosticServiceRegistry registry;

registry.RegisterNew<SessionControlService>();
registry.RegisterNew<SecurityAccessService>();
registry.RegisterNew<ReadDataByIdService>();
registry.RegisterNew<WriteDataByIdService>();
registry.RegisterNew<ReadDTCInformationService>();
registry.RegisterNew<ClearDTCService>(dtc_manager_ref);

// Dispatch request tới đúng service tự động
void OnUdsRequestReceived(ara::diag::UdsRequestContext& ctx) {
    registry.Dispatch(ctx);  // virtual dispatch bên trong
}
```

### 9.2 Kết hợp variant cho result type

```cpp
// Result của diagnostic operation – không virtual, không heap cho result
using DtcQueryResult = std::variant<
    std::vector<DtcEntry>,    // success case
    NrcError,                 // request error
    std::string               // unexpected error message
>;

class ReadDTCInformationService : public DiagnosticServiceBase {
    // ...
protected:
    void HandleServiceLogic(ara::diag::UdsRequestContext& ctx) override {
        uint8_t sub_func = ctx.GetRequest().data[1];

        // Trả về variant result – tập trung xử lý ở đây
        DtcQueryResult result = QueryDTCs(sub_func, ctx.GetRequest());

        std::visit(Overloaded{
            [&](std::vector<DtcEntry> const& dtcs) {
                // Encode và gửi DTC list
                auto response = EncodeDTCResponse(sub_func, dtcs);
                SendPositiveResponse(ctx, response);
            },
            [&](NrcError const& err) {
                ctx.SendNegativeResponse(err.code);
            },
            [&](std::string const& msg) {
                ara::log::LogError() << "ReadDTC unexpected error: " << msg;
                ctx.SendNegativeResponse(ara::diag::NrcCode::kConditionsNotCorrect);
            }
        }, result);
    }
};
```

---

## 10. Bài tập thực hành

### Bài 1 – CRTP Counter

**Yêu cầu:** Tạo CRTP base `Countable<Derived>` theo dõi số lượng instance. Base cung cấp `static int GetCount()`. Hai derived classes: `SensorInstance` và `ServiceInstance`. Chứng minh counter độc lập theo từng class (không dùng virtual).

### Bài 2 – State Machine với variant

**Yêu cầu:** Implement ECU diagnostic state machine với `std::variant<Idle, DiagActive, Authenticating, Programming>`. Mỗi state là một struct với data riêng. Dùng `std::visit` để handle transitions. Không dùng virtual method hay enum switch.

---

## Tóm tắt

| Kỹ thuật | Vấn đề giải quyết | Khi nào dùng |
|---|---|---|
| vtable / virtual | Runtime dispatch với heterogeneous types | Service hierarchy, Handler pattern |
| override keyword | Catch signature mismatch tại compile time | Mọi override, không ngoại lệ |
| covariant return | Override mà không mất type information | Factory method trong hierarchy |
| Virtual destructor | Tránh memory leak khi delete base ptr | Mọi class có virtual method |
| dynamic_cast | Type-safe downcast khi cần specific API | Visitor pattern, serialization |
| CRTP | Zero-overhead polymorphism | Sensor drivers, mixin, policy |
| std::variant | Exhaustive type-safe union, stack-based | Result types, state machine |
| std::visit | Pattern matching trên variant | Xử lý variant result |
| Concepts (C++20) | Named constraints cho template types | Library interface, API contracts |

---

**← Phần trước:** [OOP Phần 6: Inheritance](/adaptive-cpp/cpp-oop-inheritance/)
**Phần tiếp →** [OOP Phần 8: Abstraction & SOLID](/adaptive-cpp/cpp-oop-abstraction/)
