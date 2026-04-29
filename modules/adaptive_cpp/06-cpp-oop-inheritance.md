---
layout: default
title: "Advanced C++ – Phần 6: Inheritance – Kế thừa & Tái sử dụng"
description: "Inheritance trong C++ chi tiết – public/protected/private inheritance, diamond problem, virtual inheritance, mixin, EBO – ứng dụng trong kiến trúc AUTOSAR Adaptive Platform."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-oop-inheritance/
tags: [cpp, oop, inheritance, virtual-inheritance, diamond, mixin, ebo, adaptive-autosar]
---

# Advanced C++ – Phần 6: Inheritance – Kế thừa & Tái sử dụng

> **Mục tiêu bài này:** Hiểu cơ chế kế thừa từ memory layout đến constructor order, phân biệt public/protected/private inheritance, giải diamond problem với virtual inheritance, và áp dụng mixin pattern trong C++.
>
> **Series OOP:**
> → [Phần 5: Encapsulation](/adaptive-cpp/cpp-oop-encapsulation/)
> → **Phần 6 (bài này): Inheritance**
> → [Phần 7: Polymorphism](/adaptive-cpp/cpp-oop-polymorphism/)
> → [Phần 8: Abstraction & SOLID](/adaptive-cpp/cpp-oop-abstraction/)

---

## Tổng quan

```
Inheritance trong C++
├── 1. Public / Protected / Private inheritance  – 3 loại khác nhau về semantics
├── 2. Constructor & Destructor order            – thứ tự trong cây kế thừa
├── 3. Method hiding vs overriding               – virtual keyword quyết định
├── 4. Multiple inheritance                      – use cases và cạm bẫy
├── 5. Diamond problem & virtual inheritance     – hiệu ứng và giải pháp
├── 6. Mixin pattern                             – kế thừa theo hành vi
└── 7. EBO (Empty Base Optimization)            – tối ưu memory cho embedded
```

---

## 1. Public / Protected / Private Inheritance

### 1.1 Tại sao có 3 loại?

```
Quan hệ          Truy cập public members của Base  Semantics
─────────────────────────────────────────────────────────────────────
public Base      → public trong Derived             IS-A
protected Base   → protected trong Derived          Implemented-in-terms-of (internal)
private Base     → private trong Derived            Implemented-in-terms-of (strong)
```

**Quy tắc:** Chỉ `public` inheritance tạo quan hệ IS-A. Caller có thể dùng `Derived*` ở bất kỳ chỗ nào cần `Base*`.

```cpp
// IS-A: ElectricVehicle IS-A Vehicle
class Vehicle {
public:
    virtual void Start() = 0;
    virtual float GetSpeed() const noexcept = 0;
    int GetYear() const noexcept { return year_; }
protected:
    void SetSpeed(float s) noexcept { current_speed_ = s; }
private:
    int   year_          {2024};
    float current_speed_ {0.0f};
};

// Public inheritance: Derived IS-A Base
// → public members của Vehicle vẫn public trong ElectricVehicle
// → caller có thể dùng ElectricVehicle* thay cho Vehicle*
class ElectricVehicle : public Vehicle {
public:
    void Start() override { motor_.Engage(); }
    float GetSpeed() const noexcept override { return speed_sensor_.Read(); }
    float GetBatteryPercent() const noexcept { return battery_.GetLevel(); }
private:
    ElectricMotor   motor_;
    SpeedSensor     speed_sensor_;
    BatterySystem   battery_;
};

void DriveVehicle(Vehicle& v) {   // nhận Vehicle&
    v.Start();
    std::cout << "Speed: " << v.GetSpeed() << "\n";
}

ElectricVehicle ev;
DriveVehicle(ev);  // OK – ElectricVehicle IS-A Vehicle (public inheritance)
```

### 1.2 Protected inheritance – Implemented-in-terms-of (internal use)

**Khi nào:** Derived dùng implementation của Base nhưng KHÔNG muốn expose Base's public interface ra ngoài, nhưng vẫn muốn derived-of-derived có quyền trọn vẹn.

```cpp
// Protected inheritance: Derived sử dụng Base nhưng không expose public interface
// "Tôi được implement bằng Base nhưng tôi KHÔNG phải là Base đối với caller"
class Timer {
public:
    void Start() { running_ = true; tick_ = 0; }
    void Stop()  { running_ = false; }
    uint32_t GetTick() const noexcept { return tick_; }
    void Increment() { if (running_) ++tick_; }
protected:
    bool     running_ {false};
    uint32_t tick_    {0};
};

// WatchdogTimer dùng Timer implementation nhưng wrapper interface khác
class WatchdogTimer : protected Timer {
public:
    // Expose chỉ những gì phù hợp với Watchdog semantics
    void Arm(uint32_t timeout_ticks) {
        timeout_ = timeout_ticks;
        Start();  // dùng Timer::Start() – ok vì protected inheritance
    }

    void Kick() {
        // Reset timer về 0
        Stop();
        Start();
    }

    bool IsExpired() const {
        return GetTick() >= timeout_;   // OK – GetTick là member của protected base
    }

private:
    uint32_t timeout_ {100};
};

// Từ bên ngoài:
WatchdogTimer wdt;
wdt.Arm(50);   // OK
wdt.Kick();    // OK
// wdt.Start(); // COMPILER ERROR – Timer::Start() là protected trong WatchdogTimer
// wdt.GetTick(); // COMPILER ERROR – không thể truy cập Base public API
```

### 1.3 Private inheritance – Strict implementation reuse

**Khi nào:** Base hoàn toàn là implementation detail, không có thể có thêm derived class nào có quyền truy cập. Thường thay bằng **Composition** (tốt hơn), nhưng private inheritance có lợi thế EBO (xem phần 7).

```cpp
// Private inheritance – mạnh nhất: không derived class nào thấy Base
class LogBufferImpl {
protected:
    void AppendImpl(std::string_view msg) {
        buffer_.push_back(std::string(msg));
    }
    void FlushImpl() { buffer_.clear(); }
    std::size_t SizeImpl() const { return buffer_.size(); }
private:
    std::vector<std::string> buffer_;
};

// Logger dùng LogBufferImpl nhưng che hoàn toàn
class Logger : private LogBufferImpl {
public:
    void Log(std::string_view msg) {
        AppendImpl(msg);   // truy cập protected của base – OK
        if (SizeImpl() >= FLUSH_THRESHOLD) FlushImpl();
    }
    std::size_t GetBufferedCount() const { return SizeImpl(); }

private:
    static constexpr std::size_t FLUSH_THRESHOLD {100};
};

// Không ai có thể dùng Logger như LogBufferImpl
// Không thể cast Logger* sang LogBufferImpl*
```

---

## 2. Constructor và Destructor – Thứ tự gọi

### 2.1 Thứ tự trong single inheritance

**Vấn đề cần hiểu:** khi tạo derived object, constructors của tất cả base classes phải được gọi trước, theo thứ tự từ gốc đến ngọn. Destructor theo thứ tự ngược lại.

```
Hierarchy:     VehicleBase → ElectricVehicle → TeslaCar
Construction:  VehicleBase() → ElectricVehicle() → TeslaCar()   [base trước]
Destruction:   ~TeslaCar() → ~ElectricVehicle() → ~VehicleBase() [derived trước]
```

```cpp
class VehicleBase {
public:
    explicit VehicleBase(std::string_view model)
        : model_(model)
    {
        std::cout << "VehicleBase(" << model_ << ")\n";
    }

    virtual ~VehicleBase() {
        // Virtual destructor BẮT BUỘC khi class có virtual methods
        // Không có điều này: delete base_ptr sẽ chỉ gọi ~VehicleBase()
        // → TeslaCar/ElectricVehicle resources bị leak!
        std::cout << "~VehicleBase(" << model_ << ")\n";
    }

    std::string_view GetModel() const noexcept { return model_; }

protected:
    std::string model_;
};

class ElectricVehicle : public VehicleBase {
public:
    // PHẢI gọi VehicleBase constructor trong initializer list
    explicit ElectricVehicle(std::string_view model, int battery_kwh)
        : VehicleBase(model)        // gọi base constructor TRƯỚC
        , battery_kwh_(battery_kwh) // khởi tạo member sau
    {
        std::cout << "ElectricVehicle(" << battery_kwh_ << " kWh)\n";
    }

    ~ElectricVehicle() override {
        std::cout << "~ElectricVehicle\n";
    }   // ~VehicleBase() sẽ tự động được gọi SAU

protected:
    int battery_kwh_;
};

class TeslaCar : public ElectricVehicle {
public:
    explicit TeslaCar(int battery_kwh, bool autopilot)
        : ElectricVehicle("Tesla", battery_kwh)  // gọi ElectricVehicle constructor
        , has_autopilot_(autopilot)
    {
        std::cout << "TeslaCar(autopilot=" << has_autopilot_ << ")\n";
    }

    ~TeslaCar() override {
        std::cout << "~TeslaCar\n";
    }

private:
    bool has_autopilot_;
};

// Output khi tạo và hủy TeslaCar:
// VehicleBase(Tesla)        ← base gốc trước
// ElectricVehicle(100 kWh)  ← intermediate
// TeslaCar(autopilot=1)     ← derived cuối cùng
// ~TeslaCar                 ← derived trước
// ~ElectricVehicle          ← intermediate
// ~VehicleBase(Tesla)       ← base gốc cuối cùng
```

### 2.2 Constructor delegation và init order

```cpp
// QUAN TRỌNG: Thứ tự trong initializer list KHÔNG ảnh hưởng thứ tự khởi tạo
// Thứ tự thực sự = thứ tự khai báo member trong class

class Sensor {
    int    id_;       // khởi tạo TRƯỚC (khai báo trước)
    float  scale_;    // khởi tạo SAU
    std::string name_; // khởi tạo CUỐI

public:
    Sensor(int id, float scale)
        : scale_(scale)   // trong init list thứ tự này
        , id_(id)         // không quan trọng!
        , name_("Sensor_" + std::to_string(id))  // name_ phụ thuộc id_
    {
        // id_ đã được khởi tạo trước scale_ và name_
        // vì id_ khai báo trước trong class body
    }
};

// BAD: name_ dùng id_ nhưng khai báo sau id_ → thứ tự đúng
// GOOD: khai báo member theo thứ tự dependency trong class body
```

> **⚠️ Cạm bẫy phổ biến:** Initializer list luôn theo thứ tự khai báo trong class, KHÔNG theo thứ tự bạn viết trong initializer list. Compiler thường cảnh báo (-Wreorder) nếu thứ tự khác nhau.

---

## 3. Method Hiding vs Overriding

### 3.1 Không có virtual: Hiding (tên che khuất)

```cpp
class Base {
public:
    void Foo()  { std::cout << "Base::Foo\n"; }
    void Bar()  { std::cout << "Base::Bar\n"; }
};

class Derived : public Base {
public:
    // WITHOUT virtual in Base: HIDING, not overriding
    // Base::Foo bị "ẩn" bởi Derived::Foo – không phải override
    void Foo()  { std::cout << "Derived::Foo\n"; }
    // Bar vẫn visible từ Base
};

Derived d;
d.Foo();          // Derived::Foo    – Derived's version
d.Bar();          // Base::Bar       – inherited từ Base

Base* bp = &d;
bp->Foo();        // Base::Foo       – KHÔNG phải Derived::Foo!
                  // Không có virtual → static dispatch theo type của pointer
bp->Bar();        // Base::Bar

// Để gọi lại Base::Foo từ Derived:
// Base::Foo();  // scope-qualified call
```

### 3.2 Với virtual: Overriding (ghi đè đúng cách)

```cpp
class DiagServiceBase {
public:
    virtual ~DiagServiceBase() = default;

    // virtual: dynamic dispatch – gọi đúng derived version tại runtime
    virtual void HandleRequest(DiagRequest const& req) {
        std::cout << "Base::HandleRequest\n";
    }

    // non-virtual: static dispatch – luôn gọi Base version
    void LogRequest(DiagRequest const& req) {
        std::cout << "Base log\n";
    }

    // pure virtual: PHẢI override trong derived, không có default impl
    virtual std::string GetName() const = 0;
};

class ReadDTCService : public DiagServiceBase {
public:
    // override keyword – compiler kiểm tra: tên, signature phải match Base
    void HandleRequest(DiagRequest const& req) override {
        std::cout << "ReadDTC::HandleRequest\n";
    }

    // Compiler error nếu:
    // void HandleRequest(int x) override {}  // signature khác → không phải override
    // void handleRequest(...) override {}    // tên khác → không phải override

    std::string GetName() const override { return "ReadDTCService"; }
};

// Runtime polymorphism
DiagServiceBase* svc = new ReadDTCService();
svc->HandleRequest(req);  // ReadDTC::HandleRequest – virtual dispatch
svc->LogRequest(req);     // Base::LogRequest – static dispatch (non-virtual)
delete svc;               // OK – virtual destructor gọi ~ReadDTCService
```

### 3.3 final – Đóng override chain

```cpp
// final trên method: không ai được override nữa
class SecureService : public DiagServiceBase {
public:
    // override + final: tôi đã override, nhưng không ai được override tiếp
    void HandleRequest(DiagRequest const& req) override final {
        // Tắt security check logic – không được phép bỏ qua
        if (!security_check_.Passed()) return;
        DoHandle(req);
    }

    std::string GetName() const override { return "SecureService"; }

private:
    virtual void DoHandle(DiagRequest const& req) = 0;  // đây mới là extension point
    SecurityChecker security_check_;
};

// final trên class: không thể kế thừa từ class này nữa
class SingletonLogger final : public ILogger {
    // Không ai có thể kế thừa SingletonLogger
};
// class MyLogger : public SingletonLogger {}; // COMPILER ERROR
```

### 3.4 using declaration – Khôi phục hidden base methods

```cpp
class Shape {
public:
    virtual float Area() const = 0;
    // Tính area đơn vị khác nhau
    float AreaCm2()  const { return Area(); }
    float AreaMm2()  const { return Area() * 100.0f; }
    float AreaInch2() const { return Area() / 6.452f; }
};

class Rectangle : public Shape {
public:
    explicit Rectangle(float w, float h) : w_(w), h_(h) {}

    float Area() const override { return w_ * h_; }

    // Nếu Rectangle định nghĩa Area() thì KHÔNG hide AreaCm2/AreaMm2/AreaInch2
    // Vì chúng không bị override (khác tên)

    // Nhưng nếu thêm overload Area(int n) – tạo hiding!
    float Area(int scale) const { return Area() * scale; }
    // Bây giờ Area() (không tham số) từ Shape bị hidden bởi Area(int)!

    // Giải pháp: bring back bằng using
    using Shape::Area;   // khôi phục Shape::Area() (không tham số) vào scope Derived

private:
    float w_, h_;
};
```

---

## 4. Multiple Inheritance – Kế thừa nhiều Base class

### 4.1 Khi nào Multiple Inheritance hợp lệ?

**Nguyên tắc:** Multiple inheritance hợp lệ khi kế thừa từ **nhiều interface** (abstract class không có data) hoặc **mixin classes** (behavior-only). Kế thừa từ nhiều class có data → nguy hiểm.

```cpp
// Interface chỉ có pure virtual – OK để multiple inherit
class IStartable {
public:
    virtual ~IStartable() = default;
    virtual bool Start() = 0;
    virtual bool Stop()  = 0;
};

class IDiagnosable {
public:
    virtual ~IDiagnosable() = default;
    virtual bool RunSelfTest() = 0;
    virtual std::string GetDiagInfo() const = 0;
};

class IConfigurable {
public:
    virtual ~IConfigurable() = default;
    virtual bool Configure(ConfigBlock const& cfg) = 0;
    virtual ConfigBlock GetConfig() const = 0;
};

// Multiple interface inheritance – không có data conflict, an toàn
class MotorController
    : public IStartable        // IS-A IStartable
    , public IDiagnosable      // IS-A IDiagnosable
    , public IConfigurable     // IS-A IConfigurable
{
public:
    bool Start() override;
    bool Stop()  override;
    bool RunSelfTest() override;
    std::string GetDiagInfo() const override;
    bool Configure(ConfigBlock const& cfg) override;
    ConfigBlock GetConfig() const override;
};

// Có thể dùng MotorController* ở bất kỳ chỗ nào cần IStartable/IDiagnosable/IConfigurable
```

### 4.2 Ambiguity và Name Resolution

```cpp
class LoggableMixin {
public:
    void Log(std::string_view msg) {
        std::cout << "[LOG] " << msg << "\n";
    }
};

class SerializableMixin {
public:
    void Log(std::string_view msg) {  // cùng tên!
        std::cout << "[SERIAL] " << msg << "\n";
    }
};

class DataProcessor : public LoggableMixin, public SerializableMixin {
public:
    void Process() {
        // Ambiguous: Log() từ đâu?
        // Log("processing");  // COMPILER ERROR: ambiguous

        // Giải quyết bằng scope-qualified call:
        LoggableMixin::Log("processing");
        SerializableMixin::Log("serializing");

        // Hoặc declare một Log() riêng để resolve:
    }

    // Override để resolve ambiguity
    void Log(std::string_view msg) {
        LoggableMixin::Log(msg);  // chọn implementation cụ thể
    }
};
```

---

## 5. Diamond Problem và Virtual Inheritance

### 5.1 Diamond Problem

**Vấn đề:** Khi một class kế thừa từ 2 class, cả 2 đều kế thừa từ cùng 1 base → base bị duplicate trong memory.

```
           Animal
          /      \
       Dog       Robot
          \      /
         RoboDog           ← kế thừa từ cả Dog và Robot
                           ← có 2 bản copy của Animal!
```

```cpp
class Animal {
public:
    explicit Animal(std::string_view name) : name_(name) {}
    void Eat() { std::cout << name_ << " eats\n"; }
    virtual void Move() = 0;
protected:
    std::string name_;
};

class Dog : public Animal {
public:
    explicit Dog(std::string_view name) : Animal(name) {}
    void Move() override { std::cout << name_ << " runs\n"; }
    void Bark() { std::cout << name_ << " barks\n"; }
};

class Robot : public Animal {
public:
    explicit Robot(std::string_view name) : Animal(name) {}
    void Move() override { std::cout << name_ << " rolls\n"; }
    void Charge() { std::cout << name_ << " charges\n"; }
};

// BAD: Diamond WITHOUT virtual inheritance
class RoboDog : public Dog, public Robot {
public:
    RoboDog() : Dog("Rex"), Robot("RoboRex") {}
    void Move() override { Dog::Move(); }
};

RoboDog rd;
// rd.Eat();  // COMPILER ERROR: ambiguous (Dog::Animal::Eat hay Robot::Animal::Eat?)
rd.Dog::Eat();    // phải qualify
rd.Robot::Eat();  // 2 version tồn tại độc lập

// Memory layout của RoboDog (BAD):
// [Dog subobject]   → [Animal data: name_="Rex"]
// [Robot subobject] → [Animal data: name_="RoboRex"]
// RoboDog data
// → 2 bản copy Animal! memory waste + inconsistency
```

### 5.2 Virtual Inheritance – Giải pháp Diamond

```cpp
// GOOD: Virtual inheritance → chỉ có 1 bản copy Animal
class Dog : public virtual Animal {     // virtual keyword
public:
    explicit Dog(std::string_view name) : Animal(name) {}
    void Move() override { std::cout << name_ << " runs\n"; }
    void Bark() {}
};

class Robot : public virtual Animal {  // virtual keyword
public:
    explicit Robot(std::string_view name) : Animal(name) {}
    void Move() override { std::cout << name_ << " rolls\n"; }
    void Charge() {}
};

// Derived class của cả Dog và Robot
class RoboDog : public Dog, public Robot {
public:
    // PHẢI khởi tạo virtual base (Animal) trực tiếp từ most-derived class
    // Dog() và Robot() KHÔNG tự gọi Animal() trong trường hợp virtual
    RoboDog()
        : Animal("RoboDogX")  // most-derived class gọi Animal constructor
        , Dog("RoboDogX")     // Dog("x") gọi Virtual Base Animal nhưng bị ignore
        , Robot("RoboDogX")   // tương tự Robot
    {}

    void Move() override {
        // Resolve ambiguity: chọn 1 phiên bản
        Dog::Move();
    }
};

RoboDog rd;
rd.Eat();         // OK – chỉ có 1 Animal subobject
rd.Dog::Eat();    // OK
rd.Robot::Eat();  // OK – cùng 1 Animal object

// Memory layout với virtual inheritance:
// [Dog subobject]    → vptr_dog, (không có Animal trực tiếp)
// [Robot subobject]  → vptr_robot, (không có Animal trực tiếp)
// [Animal subobject] → name_ (shared, chỉ 1 bản)
// RoboDog data
// Dog/Robot truy cập Animal qua virtual base pointer (thêm overhead nhỏ)
```

### 5.3 Tổng kết khi nào dùng Virtual Inheritance

| Tình huống | Dùng virtual inheritance? |
|---|---|
| Multiple interface (pure abstract) | Không cần (không có data) |
| Mixin classes (không data member) | Thường không cần |
| Concrete class với shared base có data | Cần |
| AUTOSAR AP: `ara::com`, interfaces | Không cần (pure interfaces) |

> **💡 Điểm mấu chốt:** Virtual inheritance thêm overhead (vptr thêm, khởi tạo phức tạp hơn). Thiết kế đúng = tránh diamond problem ngay từ đầu bằng cách dùng thuần interface (pure abstract, không data).

---

## 6. Mixin Pattern – Thêm Behavior qua Inheritance

### 6.1 Mixin là gì?

**Mixin** = class không tạo object độc lập, chỉ tồn tại để thêm behavior vào class khác qua inheritance. Mixin không có data state của riêng (hoặc rất ít).

```cpp
// Mixin 1: thêm khả năng serialize sang JSON
class JsonSerializableMixin {
public:
    // Mixin định nghĩa interface serialize bằng CRTP-like convention
    // Derived class cần implement toJsonImpl()
    std::string ToJson() const {
        // Gọi derived class implementation thông qua virtual
        return BuildJson(GetJsonFields());
    }

    virtual ~JsonSerializableMixin() = default;

protected:
    // Derived class override để cung cấp field list
    virtual std::vector<std::pair<std::string,std::string>>
        GetJsonFields() const = 0;

private:
    std::string BuildJson(
        std::vector<std::pair<std::string,std::string>> const& fields) const
    {
        std::ostringstream ss;
        ss << "{\n";
        for (std::size_t i = 0; i < fields.size(); ++i) {
            ss << "  \"" << fields[i].first << "\": \"" << fields[i].second << "\"";
            if (i + 1 < fields.size()) ss << ",";
            ss << "\n";
        }
        ss << "}";
        return ss.str();
    }
};

// Mixin 2: thêm khả năng observable (notify on change)
class ObservableMixin {
public:
    using ChangeCallback = std::function<void(std::string_view field_name)>;

    void AddObserver(ChangeCallback cb) {
        observers_.push_back(std::move(cb));
    }

    virtual ~ObservableMixin() = default;

protected:
    // Derived class gọi khi có field thay đổi
    void NotifyChange(std::string_view field_name) {
        for (auto const& cb : observers_) {
            cb(field_name);
        }
    }

private:
    std::vector<ChangeCallback> observers_;
};

// Class hưởng lợi từ cả 2 mixin
class DiagnosticConfig
    : public JsonSerializableMixin    // thêm ToJson()
    , public ObservableMixin          // thêm AddObserver(), NotifyChange()
{
public:
    explicit DiagnosticConfig(uint32_t timeout, bool extended_mode)
        : timeout_ms_(timeout), extended_mode_(extended_mode) {}

    [[nodiscard]] bool SetTimeout(uint32_t ms) {
        if (ms == 0 || ms > 60000) return false;
        timeout_ms_ = ms;
        NotifyChange("timeout_ms");  // từ ObservableMixin
        return true;
    }

    void SetExtendedMode(bool enabled) {
        extended_mode_ = enabled;
        NotifyChange("extended_mode");
    }

    uint32_t GetTimeout()     const noexcept { return timeout_ms_; }
    bool     IsExtendedMode() const noexcept { return extended_mode_; }

protected:
    // Implement JsonSerializableMixin contract
    std::vector<std::pair<std::string,std::string>> GetJsonFields() const override {
        return {
            {"timeout_ms",     std::to_string(timeout_ms_)},
            {"extended_mode",  extended_mode_ ? "true" : "false"},
        };
    }

private:
    uint32_t timeout_ms_    {5000};
    bool     extended_mode_ {false};
};

// Dùng:
DiagnosticConfig cfg{5000, false};

// Observer từ AUTOSAR component
cfg.AddObserver([](std::string_view field) {
    ara::log::LogInfo() << "Config changed: " << field;
});

cfg.SetTimeout(3000);         // tự động notify observer
std::cout << cfg.ToJson();    // serialize toàn bộ config
```

### 6.2 Policy-based Mixin với CRTP (không vtable)

```cpp
// Policy = mixin không virtual, inject qua template parameter
// Zero overhead – compiler-time composition
template <typename Derived>
class LoggingPolicy {
public:
    void LogInfo(std::string_view msg) const {
        std::cout << "[" << static_cast<Derived const*>(this)->GetName()
                  << "] INFO: " << msg << "\n";
    }
    void LogError(std::string_view msg) const {
        std::cout << "[" << static_cast<Derived const*>(this)->GetName()
                  << "] ERROR: " << msg << "\n";
    }
};

template <typename Derived>
class TimestampPolicy {
public:
    uint32_t GetTimestampMs() const {
        // Giả lập – trong thực tế: system clock
        return static_cast<uint32_t>(
            std::chrono::steady_clock::now().time_since_epoch().count() / 1'000'000);
    }
};

// Class kết hợp nhiều policies – không vtable, compile-time only
class SensorManager
    : public LoggingPolicy<SensorManager>     // inject logging behavior
    , public TimestampPolicy<SensorManager>   // inject timestamp behavior
{
public:
    std::string_view GetName() const noexcept { return "SensorManager"; }

    void Update() {
        LogInfo("Update called at " + std::to_string(GetTimestampMs()) + " ms");
        // ... sensor update logic
    }

    void HandleError(std::string_view error) {
        LogError(error);
    }
};

SensorManager mgr;
mgr.Update();            // LoggingPolicy::LogInfo được gọi – zero vtable overhead
mgr.HandleError("overheat");
```

---

## 7. EBO – Empty Base Optimization

### 7.1 Tại sao cần EBO trong Embedded?

**Vấn đề:** Mọi object trong C++ có size >= 1 byte (standard guarantee). Khi class có data members + empty base, base chiếm 1 byte thừa. Nhân với hàng ngàn objects → lãng phí RAM đáng kể.

```cpp
class EmptyAllocator {};  // size = 1 (minimum)

class Buffer {
    uint8_t*      data_;
    std::size_t   size_;
    EmptyAllocator alloc_;  // 1 byte + padding
};

// sizeof(Buffer) = 8 + 8 + 1 + 7(padding) = 24 bytes thay vì 16!

// EBO: kế thừa thay vì có member
class SmallBuffer : private EmptyAllocator {  // base có thể overlap với SmallBuffer
    uint8_t*    data_;
    std::size_t size_;
};
// sizeof(SmallBuffer) = 16 – EBO: EmptyAllocator không tốn thêm space!
```

### 7.2 EBO với custom allocator trong embedded

```cpp
// Allocator interface nhẹ – không có data member
struct PoolAllocator {
    // Stateless – trỏ vào global pool
    static void* Allocate(std::size_t n) {
        return g_pool.Alloc(n);
    }
    static void Deallocate(void* p, std::size_t n) {
        g_pool.Free(p, n);
    }
};
// sizeof(PoolAllocator) = 1 (empty class)

// EBO: kế thừa allocator thay vì có field
template <typename T, typename Alloc = PoolAllocator>
class EcuVector : private Alloc {  // EBO: Alloc empty → không tốn thêm space
public:
    EcuVector() = default;

    void push_back(T const& val) {
        if (size_ >= capacity_) Grow();
        data_[size_++] = val;
    }

    T& operator[](std::size_t i) noexcept { return data_[i]; }
    std::size_t size() const noexcept { return size_; }

private:
    void Grow() {
        std::size_t new_cap = capacity_ * 2 + 1;
        // Dùng Alloc::Allocate từ base (EBO)
        auto* new_data = static_cast<T*>(Alloc::Allocate(sizeof(T) * new_cap));
        std::copy(data_, data_ + size_, new_data);
        if (data_) Alloc::Deallocate(data_, sizeof(T) * capacity_);
        data_     = new_data;
        capacity_ = new_cap;
    }

    T*          data_     {nullptr};
    std::size_t size_     {0};
    std::size_t capacity_ {0};
    // Alloc: 0 bytes extra (EBO)
};

// Với member thay vì kế thừa:
// sizeof(EcuVector<float, PoolAllocator>) = 3 pointers + PoolAllocator(1) + padding = 32
// Với EBO:
// sizeof(EcuVector<float, PoolAllocator>) = 3 pointers = 24 bytes
```

> **💡 Điểm mấu chốt:** C++20 thêm `[[no_unique_address]]` attribute để đạt EBO mà không cần inheritance. Nhưng EBO qua private inheritance vẫn phổ biến trong C++17 code.

---

## 8. Ứng dụng trong AUTOSAR AP – DiagnosticService Hierarchy

### 8.1 Base class hoàn chỉnh với Template Method Pattern

```cpp
// === Base class – logic chung cho mọi UDS diagnostic service ===
class DiagnosticServiceBase {
public:
    explicit DiagnosticServiceBase(
        uint8_t service_id,
        ara::diag::Session min_session   = ara::diag::Session::kDefault,
        uint8_t required_security_level  = 0)
        : sid_(service_id)
        , min_session_(min_session)
        , required_sec_level_(required_security_level)
    {}

    virtual ~DiagnosticServiceBase() = default;

    // Template Method: thứ tự kiểm tra + dispatch đã được fix
    // Derived class KHÔNG thể bỏ qua security check
    void ProcessRequest(ara::diag::UdsRequestContext& ctx) final {
        auto const& req = ctx.GetRequest();

        // Bước 1: Kiểm tra length tối thiểu
        if (!CheckMinLength(req)) {
            ctx.SendNegativeResponse(ara::diag::NrcCode::kIncorrectMessageLength);
            return;
        }
        // Bước 2: Kiểm tra session
        if (!IsSessionAllowed(ctx.GetCurrentSession())) {
            ctx.SendNegativeResponse(ara::diag::NrcCode::kServiceNotSupportedInSession);
            return;
        }
        // Bước 3: Kiểm tra security level
        if (!IsSecurityLevelSufficient(ctx.GetSecurityLevel())) {
            ctx.SendNegativeResponse(ara::diag::NrcCode::kSecurityAccessDenied);
            return;
        }
        // Bước 4: Extension point – derived class xử lý nội dung
        HandleServiceLogic(ctx);
    }

    uint8_t GetSID() const noexcept { return sid_; }

protected:
    // Protected extension points – derived class override nếu cần
    virtual std::size_t GetMinRequestLength() const noexcept { return 1; }

    // Pure virtual: mỗi service phải implement logic riêng
    virtual void HandleServiceLogic(ara::diag::UdsRequestContext& ctx) = 0;

    // Helper – exposed cho derived class
    void SendPositiveResponse(ara::diag::UdsRequestContext& ctx,
                              std::span<const uint8_t> data) {
        ctx.SendPositiveResponse(data);
    }

private:
    bool CheckMinLength(ara::diag::UdsRequest const& req) const {
        return req.data.size() >= GetMinRequestLength();
    }

    bool IsSessionAllowed(ara::diag::Session current) const {
        return current >= min_session_;
    }

    bool IsSecurityLevelSufficient(uint8_t current_level) const {
        return required_sec_level_ == 0 || current_level >= required_sec_level_;
    }

    uint8_t            sid_;
    ara::diag::Session min_session_;
    uint8_t            required_sec_level_;
};

// === Concrete: SID 0x10 DiagnosticSessionControl ===
class SessionControlService final : public DiagnosticServiceBase {
public:
    SessionControlService()
        : DiagnosticServiceBase(0x10)  // không cần security, available in any session
    {}

protected:
    std::size_t GetMinRequestLength() const noexcept override { return 2; }

    void HandleServiceLogic(ara::diag::UdsRequestContext& ctx) override {
        uint8_t sub_func = ctx.GetRequest().data[1] & 0x7F;  // mask supression bit
        bool suppress_response = (ctx.GetRequest().data[1] & 0x80) != 0;

        ara::diag::Session new_session;
        switch (sub_func) {
            case 0x01: new_session = ara::diag::Session::kDefault;  break;
            case 0x02: new_session = ara::diag::Session::kExtended; break;
            case 0x03: new_session = ara::diag::Session::kProgramming; break;
            default:
                ctx.SendNegativeResponse(ara::diag::NrcCode::kSubFunctionNotSupported);
                return;
        }

        ctx.SetSession(new_session);
        if (!suppress_response) {
            std::array<uint8_t, 5> resp = {
                sub_func,
                0x00, 0x19,  // defaultP2ServerMax = 25 ms
                0x01, 0xF4   // enhancedP2ServerMax = 500 ms
            };
            SendPositiveResponse(ctx, resp);
        }
    }
};

// === Concrete: SID 0x27 SecurityAccess ===
class SecurityAccessService final : public DiagnosticServiceBase {
public:
    SecurityAccessService()
        : DiagnosticServiceBase(0x27, ara::diag::Session::kExtended)
    {}

protected:
    std::size_t GetMinRequestLength() const noexcept override { return 2; }

    void HandleServiceLogic(ara::diag::UdsRequestContext& ctx) override {
        uint8_t sub_func = ctx.GetRequest().data[1];

        if (sub_func % 2 == 1) {
            // Odd: requestSeed
            HandleRequestSeed(ctx, sub_func);
        } else {
            // Even: sendKey
            HandleSendKey(ctx, sub_func);
        }
    }

private:
    void HandleRequestSeed(ara::diag::UdsRequestContext& ctx, uint8_t level) {
        uint32_t seed = GenerateSeed();  // csprng seed
        pending_seed_ = seed;
        pending_level_ = level;

        std::array<uint8_t, 5> resp = {
            level,
            static_cast<uint8_t>(seed >> 24),
            static_cast<uint8_t>(seed >> 16),
            static_cast<uint8_t>(seed >> 8),
            static_cast<uint8_t>(seed)
        };
        SendPositiveResponse(ctx, resp);
    }

    void HandleSendKey(ara::diag::UdsRequestContext& ctx, uint8_t level) {
        if (level != pending_level_ + 1) {
            ctx.SendNegativeResponse(ara::diag::NrcCode::kRequestSequenceError);
            return;
        }
        uint32_t received_key = ExtractKey(ctx.GetRequest().data);
        uint32_t expected_key = ComputeKey(pending_seed_);

        if (received_key == expected_key) {
            ctx.GrantSecurityLevel(level / 2);
            SendPositiveResponse(ctx, std::span<const uint8_t>{&level, 1});
        } else {
            ctx.SendNegativeResponse(ara::diag::NrcCode::kInvalidKey);
        }
    }

    uint32_t GenerateSeed() {
        static std::mt19937 rng{std::random_device{}()};
        return rng();
    }

    uint32_t ComputeKey(uint32_t seed) const {
        // Simplified – thực tế dùng AES/HMAC
        return seed ^ 0xC0FFEE00u;
    }

    uint32_t ExtractKey(std::span<const uint8_t> data) const {
        if (data.size() < 6) return 0;
        return (static_cast<uint32_t>(data[2]) << 24) |
               (static_cast<uint32_t>(data[3]) << 16) |
               (static_cast<uint32_t>(data[4]) << 8)  |
               (static_cast<uint32_t>(data[5]));
    }

    uint32_t pending_seed_  {0};
    uint8_t  pending_level_ {0};
};
```

---

## 9. Bài tập thực hành

### Bài 1 – Vehicle Hierarchy với Template Method

**Yêu cầu:** Xây dựng hierarchy:
- `TransportBase`: abstract, có `StartJourney(destination)` theo Template Method
    - Bước chung: `ValidateDestination()`, `PrepareFuel()`, `LogDeparture()`
    - Bước riêng (pure virtual): `ExecuteTravel(destination)`, `GetFuelType()`
- `GroundVehicle`: concrete, override `ExecuteTravel` cho đường bộ, `GetFuelType()` = "Gasoline"
- `ElectricVehicle`: override `ExecuteTravel` cho đường bộ điện, `GetFuelType()` = "Electric"
- `DroneVehicle`: override `ExecuteTravel` cho đường không, `GetFuelType()` = "Battery"

### Bài 2 – Mixin cho Diagnostic Component

**Yêu cầu:** Tạo `DiagnosticComponent` kế thừa từ:
- `LoggableMixin`: thêm `LogInfo()`, `LogWarn()`, `LogError()`
- `ConfigurableMixin`: thêm `Configure(map<string,string>)`, `GetConfig()`
- `HealthCheckMixin`: thêm `IsHealthy()`, `GetHealthStatus()` (pure virtual)

---

## Tóm tắt

| Kỹ thuật | Vấn đề giải quyết | Bối cảnh sử dụng |
|---|---|---|
| Public inheritance | IS-A relationship, reuse interface | `DiagServiceBase → ReadDTCService` |
| Protected inheritance | Dùng implementation, hide từ caller | `WatchdogTimer uses Timer` |
| Private inheritance | Strict implementation reuse, EBO | Policy embedding, empty allocator |
| Virtual destructor | Đảm bảo cleanup khi delete base ptr | Mọi class có virtual methods |
| override keyword | Compiler kiểm tra signature match | Mọi virtual method override |
| final | Khóa override chain hoặc class | Security-critical methods |
| using declaration | Khôi phục hidden base methods | Sau khi thêm overload cùng tên |
| Multiple interface | Combine multiple behaviors | `MotorController : IStartable, IDiagnosable` |
| Virtual inheritance | Giải diamond problem | `Dog : virtual Animal` |
| Mixin pattern | Add-on behavior via inheritance | `LoggableMixin`, `ObservableMixin` |
| EBO | Tiết kiệm memory cho empty class | Stateless allocator, policy classes |

---

**← Phần trước:** [OOP Phần 5: Encapsulation](/adaptive-cpp/cpp-oop-encapsulation/)
**Phần tiếp →** [OOP Phần 7: Polymorphism](/adaptive-cpp/cpp-oop-polymorphism/)
