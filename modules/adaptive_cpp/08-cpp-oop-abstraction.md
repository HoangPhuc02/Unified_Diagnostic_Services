---
layout: default
title: "Advanced C++ – Phần 8: Abstraction, SOLID & Type Erasure"
description: "Abstraction trong C++ – abstract class, interface pattern, NVI, SOLID từng nguyên tắc với ví dụ AUTOSAR AP, dependency injection, type erasure với std::function và concept-based erasure."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-oop-abstraction/
tags: [cpp, oop, abstraction, interface, solid, dependency-injection, type-erasure, nvi, adaptive-autosar]
---

# Advanced C++ – Phần 8: Abstraction, SOLID & Type Erasure

> **Mục tiêu bài này:** Hiểu abstraction thực sự có nghĩa gì trong C++, cách thiết kế interface đúng, 5 nguyên tắc SOLID với ví dụ cụ thể trong kiến trúc AUTOSAR AP, và kỹ thuật type erasure tiên tiến.
>
> **Series OOP:**
> → [Phần 5: Encapsulation](/adaptive-cpp/cpp-oop-encapsulation/)
> → [Phần 6: Inheritance](/adaptive-cpp/cpp-oop-inheritance/)
> → [Phần 7: Polymorphism](/adaptive-cpp/cpp-oop-polymorphism/)
> → **Phần 8 (bài này): Abstraction & SOLID**

---

## Tổng quan

```
Abstraction & SOLID
├── 1. Abstract class rules           – quy tắc và khi nào abstract
├── 2. Interface pattern trong C++    – pure abstract, no data
├── 3. NVI – Non-Virtual Interface    – pattern quan trọng
├── 4. SOLID principles               – 5 nguyên tắc thiết kế
│   ├── S – Single Responsibility
│   ├── O – Open/Closed
│   ├── L – Liskov Substitution
│   ├── I – Interface Segregation
│   └── D – Dependency Inversion
├── 5. Dependency Injection           – pattern & best practices
└── 6. Type Erasure                   – std::function, std::any, concept-based
```

---

## 1. Abstract Class – Quy tắc và Ý nghĩa

### 1.1 Định nghĩa và quy tắc

**Abstract class** = class có ít nhất một pure virtual method. Không thể tạo instance trực tiếp. Mục đích: định nghĩa **hợp đồng** (contract) mà derived class phải thực hiện.

```cpp
// Abstract class = contract định nghĩa behavior
class IDtcStorage {
public:
    // Hợp đồng: mọi DTC storage implementation PHẢI làm được:
    virtual bool         Store(DtcRecord const& record)         = 0;
    virtual bool         Clear(uint32_t dtc_number)             = 0;
    virtual bool         ClearAll()                             = 0;
    virtual DtcRecord    Retrieve(uint32_t dtc_number) const    = 0;
    virtual std::vector<DtcRecord> RetrieveAll() const          = 0;
    virtual std::size_t  GetStoredCount() const noexcept        = 0;
    virtual std::size_t  GetCapacity()    const noexcept        = 0;

    // Concrete helper – tính từ pure virtuals
    bool IsFull() const noexcept {
        return GetStoredCount() >= GetCapacity();
    }

    virtual ~IDtcStorage() = default;
};

// Concrete implementations – satisfy contract theo cách riêng
class NvmDtcStorage     : public IDtcStorage { /* NVM backend */ };
class RamDtcStorage     : public IDtcStorage { /* RAM-only, faster */ };
class MockDtcStorage    : public IDtcStorage { /* Test doubles */ };
class EncryptedDtcStorage : public IDtcStorage { /* Encrypted NVM */ };
```

### 1.2 Abstract vs Concrete – Decision Tree

```
Class có methods nào?
│
├── Tất cả đều pure virtual + virtual dtor:
│   → Interface (xem mục 2)
│
├── Một số pure virtual + shared logic:
│   → Abstract Base Class (Template Method pattern)
│
├── Không có pure virtual, chỉ virtual:
│   → Concrete class có thể kế thừa (open for extension)
│
└── Không virtual gì cả:
    → Value class / Final class (không thiết kế cho kế thừa)
```

---

## 2. Interface Pattern – Pure Abstract trong C++

### 2.1 Interface "thuần" – không data, chỉ behavior

```cpp
// C++ Interface = abstract class chỉ có pure virtual methods
// Convention: tiền tố "I" (không bắt buộc, nhưng phổ biến trong C++)
class ILogger {
public:
    virtual ~ILogger() = default;

    virtual void LogDebug(std::string_view msg) = 0;
    virtual void LogInfo (std::string_view msg) = 0;
    virtual void LogWarn (std::string_view msg) = 0;
    virtual void LogError(std::string_view msg) = 0;

    // No data members!
    // No non-virtual methods! (trừ destructor)
};

class IEventNotifier {
public:
    virtual ~IEventNotifier() = default;

    virtual void Subscribe(uint32_t event_id,
                           std::function<void(EventData const&)> handler) = 0;
    virtual void Unsubscribe(uint32_t event_id) = 0;
    virtual void Publish(uint32_t event_id, EventData const& data) = 0;
};

// Implementations:
class ConsoleLogger : public ILogger {
public:
    void LogDebug(std::string_view msg) override {
        std::cout << "[DBG]  " << msg << "\n";
    }
    void LogInfo(std::string_view msg) override {
        std::cout << "[INFO] " << msg << "\n";
    }
    void LogWarn(std::string_view msg) override {
        std::cout << "[WARN] " << msg << "\n";
    }
    void LogError(std::string_view msg) override {
        std::cerr << "[ERR]  " << msg << "\n";
    }
};

class AraCoreLogger : public ILogger {
    void LogDebug(std::string_view msg) override {
        ara::log::LogDebug() << msg;
    }
    // ... (AUTOSAR AP logger backend)
};

// Production code không phụ thuộc vào implementation cụ thể:
class DiagnosticCore {
public:
    // Nhận ILogger – không biết và không cần biết nó là Console hay Ara
    explicit DiagnosticCore(ILogger& logger) : logger_(logger) {}
    void Run() {
        logger_.LogInfo("DiagnosticCore started");
        // ...
    }
private:
    ILogger& logger_;  // reference to interface
};
```

### 2.2 Segregated Interfaces (xem thêm ISP trong SOLID)

```cpp
// BAD: Một interface monolithic
class IDiagnosticAll {
public:
    virtual void HandleRequest(DiagRequest const&) = 0;
    virtual void LogEvent(std::string_view) = 0;         // logging
    virtual void StoreData(std::span<const uint8_t>) = 0; // storage
    virtual void SendNotification(uint32_t) = 0;         // notification
    virtual ~IDiagnosticAll() = default;
};
// Mock phải implement TẤT CẢ, kể cả không dùng trong test

// GOOD: Tách thành interfaces nhỏ, mỗi cái 1 trách nhiệm
class IRequestHandler {
public:
    virtual void HandleRequest(DiagRequest const&) = 0;
    virtual ~IRequestHandler() = default;
};

class IEventLogger {
public:
    virtual void LogEvent(std::string_view) = 0;
    virtual ~IEventLogger() = default;
};

class IDataStore {
public:
    virtual void StoreData(std::span<const uint8_t>) = 0;
    virtual ~IDataStore() = default;
};

// Test chỉ implement interface cần dùng:
struct MockRequestHandler : public IRequestHandler {
    std::vector<DiagRequest> recorded;
    void HandleRequest(DiagRequest const& r) override { recorded.push_back(r); }
};
```

---

## 3. NVI – Non-Virtual Interface Pattern

### 3.1 Vấn đề NVI giải quyết

**Vấn đề:** khi base class expose virtual method public, derived class có thể override và bỏ qua pre/post-condition checks. Không có nơi để đặt cross-cutting concerns (logging, validation, metrics).

**NVI Pattern:** public methods là non-virtual (không override được). Override xảy ra ở protected/private virtual methods.

```cpp
// WITHOUT NVI: Derived có thể bỏ qua validation
class SensorServiceBad {
public:
    virtual float ReadSensor(int sensor_id) {
        return ReadImpl(sensor_id);  // validation có thể bị override bỏ qua
    }
};

class DerivedServiceBad : public SensorServiceBad {
public:
    // Override hoàn toàn – bỏ qua validation từ base
    float ReadSensor(int sensor_id) override {
        return -999.0f;  // giả return, bỏ hết validation
    }
};
```

```cpp
// WITH NVI: interface public không override được
class SensorService {
public:
    // Non-virtual public interface – KHÔNG thể override
    float ReadSensor(int sensor_id) {
        // Pre-condition: luôn chạy, không bỏ được
        if (sensor_id < 0 || sensor_id >= kMaxSensors) {
            ara::log::LogError() << "Invalid sensor_id: " << sensor_id;
            return std::numeric_limits<float>::quiet_NaN();
        }

        // Ghi metrics trước khi read
        auto start_ts = std::chrono::steady_clock::now();

        // Extension point (virtual, protected) – derived override tại đây
        float result = ReadSensorImpl(sensor_id);

        // Post-condition: luôn chạy
        auto duration = std::chrono::steady_clock::now() - start_ts;
        RecordReadLatency(sensor_id, duration);

        if (std::isnan(result) || std::isinf(result)) {
            ara::log::LogWarn() << "Sensor " << sensor_id << " returned invalid value";
        }

        return result;
    }

    virtual ~SensorService() = default;

protected:
    // Extension point – derived class override
    virtual float ReadSensorImpl(int sensor_id) {
        return hw_driver_.ReadRaw(sensor_id) * calibration_[sensor_id];
    }

private:
    static constexpr int kMaxSensors {16};
    HardwareDriver hw_driver_;
    std::array<float, kMaxSensors> calibration_ {};

    void RecordReadLatency(int id, std::chrono::nanoseconds ns) {
        // metrics recording...
    }
};

class FilteredSensorService : public SensorService {
protected:
    // Override chỉ implementation – không bỏ được pre/post conditions!
    float ReadSensorImpl(int sensor_id) override {
        // Thêm low-pass filter on top of base reading
        float raw = SensorService::ReadSensorImpl(sensor_id);  // gọi base impl
        return ApplyLowPassFilter(sensor_id, raw);
    }

private:
    float ApplyLowPassFilter(int id, float val) {
        prev_[id] = 0.8f * prev_[id] + 0.2f * val;
        return prev_[id];
    }
    std::array<float, 16> prev_ {};
};
```

> **💡 Điểm mấu chốt:** NVI = "đặt cửa sổ extension chỉ ở nơi bạn muốn". Public API giữ nguyên contract (pre/post conditions, logging), derived class chỉ thay đổi core logic.

---

## 4. SOLID Principles

### S – Single Responsibility Principle (SRP)

**Nguyên tắc:** Một class nên chỉ có **một lý do để thay đổi** (one reason to change).

```cpp
// BAD: DtcHandler làm quá nhiều việc
class DtcHandlerBad {
public:
    // Responsibility 1: nhận và parse request
    void ParseRequest(std::span<const uint8_t> raw) {}

    // Responsibility 2: logic nghiệp vụ DTC
    std::vector<DtcEntry> FindDTCs(uint8_t mask) {}
    void StoreDTC(DtcEntry const& e) {}

    // Responsibility 3: format response
    std::vector<uint8_t> EncodeResponse(std::vector<DtcEntry> const& dtcs) {}

    // Responsibility 4: gửi qua transport
    void SendOverCAN(std::span<const uint8_t> data) {}

    // Responsibility 5: logging
    void LogOperation(std::string_view op) {}
};
// 5 lý do để thay đổi: mỗi responsibility độc lập thay đổi

// GOOD: tách biệt rõ ràng
class DiagRequestParser {
public:
    DiagRequest Parse(std::span<const uint8_t> raw);  // chỉ parse
};

class DtcRepository {
public:
    std::vector<DtcEntry> Find(uint8_t status_mask);  // chỉ data access
    void Store(DtcEntry const& e);
};

class DtcResponseEncoder {
public:
    std::vector<uint8_t> Encode(std::vector<DtcEntry> const& dtcs); // chỉ encode
};

class CanTransport {
public:
    void Send(std::span<const uint8_t> data);          // chỉ transport
};

// Orchestrator kết hợp – nhưng không làm việc của từng class
class ReadDTCHandler {
public:
    ReadDTCHandler(DiagRequestParser& p, DtcRepository& r,
                   DtcResponseEncoder& e, CanTransport& t)
        : parser_(p), repo_(r), encoder_(e), transport_(t) {}

    void Handle(std::span<const uint8_t> raw) {
        auto req      = parser_.Parse(raw);
        auto dtcs     = repo_.Find(req.status_mask);
        auto response = encoder_.Encode(dtcs);
        transport_.Send(response);
    }

private:
    DiagRequestParser&   parser_;
    DtcRepository&       repo_;
    DtcResponseEncoder&  encoder_;
    CanTransport&        transport_;
};
```

---

### O – Open/Closed Principle (OCP)

**Nguyên tắc:** Class nên **mở để mở rộng** (add behavior) nhưng **đóng với sửa đổi** (don't break existing code).

```cpp
// BAD: Thêm loại sensor mới → phải sửa ReadSensorFactory
std::string ReadSensor(SensorType type) {
    // Phải modify hàm này mỗi khi thêm sensor type mới
    switch (type) {
        case SensorType::kTemperature: return ReadTemperature();
        case SensorType::kPressure:    return ReadPressure();
        // Thêm kSpeed → phải sửa đây → vi phạm OCP
    }
    return "";
}

// GOOD: mở rộng bằng cách thêm class mới, không sửa existing code
class ISensorReader {
public:
    virtual std::string Read() = 0;
    virtual std::string GetName() const = 0;
    virtual ~ISensorReader() = default;
};

// Existing implementations – không bao giờ thay đổi
class TemperatureReader : public ISensorReader {
    std::string Read() override { return std::to_string(ReadHWTemp()); }
    std::string GetName() const override { return "Temperature"; }
};

class PressureReader : public ISensorReader {
    std::string Read() override { return std::to_string(ReadHWPressure()); }
    std::string GetName() const override { return "Pressure"; }
};

// Thêm sensor mới: chỉ thêm class mới, KHÔNG sửa existing code!
class SpeedReader : public ISensorReader {
    std::string Read() override { return std::to_string(ReadHWSpeed()); }
    std::string GetName() const override { return "Speed"; }
};

// Orchestrator không cần thay đổi:
class SensorMonitor {
public:
    void AddReader(std::unique_ptr<ISensorReader> r) {
        readers_.push_back(std::move(r));
    }
    void ReadAll() const {
        for (auto const& r : readers_) {
            std::cout << r->GetName() << ": " << r->Read() << "\n";
        }
    }
private:
    std::vector<std::unique_ptr<ISensorReader>> readers_;
};

// Mở rộng: chỉ cần:
monitor.AddReader(std::make_unique<SpeedReader>());
// Không touch TemperatureReader, PressureReader, hay SensorMonitor!
```

---

### L – Liskov Substitution Principle (LSP)

**Nguyên tắc:** Object của Derived class phải có thể **thay thế** Base class mà **không làm hỏng behavior**.

```cpp
// BAD: vi phạm LSP – Derived hành xử khác Base theo cách unexpected
class DiagRequest {
public:
    virtual bool IsValid() const {
        return !data_.empty();
    }
    virtual std::span<const uint8_t> GetData() const { return data_; }

protected:
    std::vector<uint8_t> data_;
};

class ExtendedDiagRequest : public DiagRequest {
public:
    bool IsValid() const override {
        // Precondition mạnh hơn Base: thêm điều kiện extra
        // → LSP violation: caller dùng DiagRequest* nhưng ExtendedDiagRequest strict hơn
        return !data_.empty() && data_.size() >= 10 && data_[0] == 0xFF;
    }
};

// Caller dùng DiagRequest*:
void Process(DiagRequest* req) {
    if (req->IsValid()) {
        // assume: data không rỗng (theo DiagRequest contract)
        HandleData(req->GetData());
    }
}

// Khi pass ExtendedDiagRequest với data={0x22, 0x01} (valid theo DiagRequest):
// req->IsValid() = false (vi phạm Liskov: caller kỳ vọng true)
// → Process không handle data dù data đúng định dạng DiagRequest
```

```cpp
// GOOD: LSP-compliant hierarchy

// Contract DiagRequest Base:
// - IsValid() → true NẾU data không rỗng
// - GetData() → data không modified nếu đã valid

class DiagRequest {
public:
    virtual bool IsValid() const {
        return !data_.empty();
    }
    virtual std::span<const uint8_t> GetData() const { return data_; }
    virtual ~DiagRequest() = default;
protected:
    std::vector<uint8_t> data_;
};

// ExtendedDiagRequest: KHÔNG tăng preconditions, chỉ thêm extra behaviors
class ExtendedDiagRequest : public DiagRequest {
public:
    // IsValid() kế thừa từ Base (không override) – giữ nguyên contract
    // GetData() kế thừa từ Base

    // Thêm behavior MỚI (không có trong Base contract):
    bool HasExtendedHeader() const {
        return data_.size() >= 10 && data_[0] == 0xFF;
    }

    ExtendedHeader ParseHeader() const {
        // chỉ gọi khi HasExtendedHeader() = true
        return ParseExtendedHeaderImpl(data_);
    }
};

// Liskov: ExtendedDiagRequest CÓ THỂ thay thế DiagRequest hoàn toàn
// Caller Process(DiagRequest*) hoạt động đúng với ExtendedDiagRequest
```

> **⚠️ Cạm bẫy phổ biến:** Vi phạm LSP thường xảy ra khi override method với **precondition mạnh hơn** hoặc **postcondition yếu hơn** so với base class.

---

### I – Interface Segregation Principle (ISP)

**Nguyên tắc:** Client không nên bị buộc phụ thuộc vào interface mà họ không dùng. **Chia nhỏ interface** – nhiều interface chuyên biệt tốt hơn 1 interface monolithic.

```cpp
// BAD: ISensorManager monolithic
class ISensorManager {
public:
    // Group 1: reading
    virtual float Read(int id) = 0;
    virtual bool  IsSensorHealthy(int id) = 0;

    // Group 2: configuration (không phải client nào cũng config)
    virtual bool Configure(int id, SensorConfig const&) = 0;
    virtual SensorConfig GetConfig(int id) = 0;

    // Group 3: calibration (chỉ factory/service mode dùng)
    virtual bool Calibrate(int id, float ref) = 0;
    virtual float GetCalibrationOffset(int id) = 0;

    // Group 4: storage (persistence layer, không phải logic)
    virtual bool SaveConfig(std::string_view path)  = 0;
    virtual bool LoadConfig(std::string_view path)  = 0;

    virtual ~ISensorManager() = default;
};

// Application code chỉ cần đọc → phải implement toàn bộ interface!
class DashboardController {
    ISensorManager& mgr_;  // chỉ dùng Read() và IsSensorHealthy()
    // nhưng phải mock Configure, Calibrate, SaveConfig, LoadConfig khi test!
};

// GOOD: ISP – 4 interfaces nhỏ
class ISensorReader {
public:
    virtual float Read(int id) = 0;
    virtual bool  IsSensorHealthy(int id) = 0;
    virtual ~ISensorReader() = default;
};

class ISensorConfigurator {
public:
    virtual bool Configure(int id, SensorConfig const&) = 0;
    virtual SensorConfig GetConfig(int id) = 0;
    virtual ~ISensorConfigurator() = default;
};

class ISensorCalibrator {
public:
    virtual bool Calibrate(int id, float ref) = 0;
    virtual float GetCalibrationOffset(int id) = 0;
    virtual ~ISensorCalibrator() = default;
};

class ISensorPersistence {
public:
    virtual bool SaveConfig(std::string_view path) = 0;
    virtual bool LoadConfig(std::string_view path) = 0;
    virtual ~ISensorPersistence() = default;
};

// Concrete class implement tất cả (platform code):
class SensorManagerImpl
    : public ISensorReader
    , public ISensorConfigurator
    , public ISensorCalibrator
    , public ISensorPersistence
{
    // Implement tất cả...
};

// Clients chỉ phụ thuộc vào interface cần:
class DashboardController {
    ISensorReader& reader_;         // chỉ cần read
};

class FactoryCalibrationTool {
    ISensorCalibrator& calibrator_; // chỉ cần calibrate
};

class ConfigManager {
    ISensorConfigurator& cfg_;
    ISensorPersistence&  persist_;  // cần cả 2
};
```

---

### D – Dependency Inversion Principle (DIP)

**Nguyên tắc:**
1. High-level modules không nên phụ thuộc vào low-level modules. Cả hai phụ thuộc vào **abstraction**.
2. Abstraction không nên phụ thuộc vào chi tiết. Chi tiết phụ thuộc vào abstraction.

```cpp
// BAD: High-level DiagController phụ thuộc vào concrete NvmStorage
class DiagController {
public:
    DiagController() : storage_(/* singleton? */) {} // hard-coded dependency

    void StoreDTC(DtcEntry const& e) {
        storage_.Write(e.GetRawData());  // phụ thuộc cụ thể NvmStorage API
    }

private:
    NvmStorage storage_;  // concrete class – vi phạm DIP!
};

// Không thể test DiagController mà không có NvmStorage hardware!

// GOOD: Dependency Inversion
class IDtcStorage {
public:
    virtual bool Store(DtcEntry const& e) = 0;
    virtual bool Clear(uint32_t dtc) = 0;
    virtual ~IDtcStorage() = default;
};

// High-level module: phụ thuộc vào abstraction IDtcStorage
class DiagController {
public:
    explicit DiagController(IDtcStorage& storage) : storage_(storage) {}

    void StoreDTC(DtcEntry const& e) {
        if (!storage_.Store(e)) {
            // handle error
        }
    }

private:
    IDtcStorage& storage_;  // phụ thuộc abstraction, không phải concrete!
};

// Low-level modules: implement abstraction
class NvmDtcStorage : public IDtcStorage {
    bool Store(DtcEntry const& e) override { /* NVM write */ return true; }
    bool Clear(uint32_t dtc)      override { /* NVM erase */ return true; }
};

class MockDtcStorage : public IDtcStorage {
public:
    bool Store(DtcEntry const& e) override {
        stored_.push_back(e); return true;
    }
    bool Clear(uint32_t dtc) override {
        auto it = std::find_if(stored_.begin(), stored_.end(),
                               [dtc](auto& e){ return e.dtc_number == dtc; });
        if (it != stored_.end()) { stored_.erase(it); return true; }
        return false;
    }
    std::vector<DtcEntry> const& GetStored() const { return stored_; }
private:
    std::vector<DtcEntry> stored_;
};

// Unit test không cần hardware:
MockDtcStorage mock_storage;
DiagController ctrl{mock_storage};
ctrl.StoreDTC(DtcEntry{0x1234});
assert(mock_storage.GetStored().size() == 1);
```

---

## 5. Dependency Injection Patterns

### 5.1 Constructor Injection – Preferred

```cpp
// PREFERRED: Constructor injection
// Dependency rõ ràng, object ALWAYS trong valid state sau construction
class DemManager {
public:
    // Tất cả dependencies được inject và bắt buộc
    // Không thể tạo DemManager mà không có đủ dependencies
    DemManager(
        IDtcStorage&      dtc_storage,
        IEventNotifier&   notifier,
        ILogger&          logger,
        IDemConfig const& config)
        : dtc_storage_(dtc_storage)
        , notifier_   (notifier)
        , logger_     (logger)
        , config_     (config)
    {}

    void ReportEvent(EventId id, EventStatus status) {
        logger_.LogDebug("ReportEvent: " + std::to_string(id));
        auto entry = BuildDtcEntry(id, status);
        if (!dtc_storage_.Store(entry)) {
            logger_.LogError("Failed to store DTC");
            return;
        }
        notifier_.Publish(kDtcStoredEvent, {id, status});
    }

private:
    IDtcStorage&      dtc_storage_;
    IEventNotifier&   notifier_;
    ILogger&          logger_;
    IDemConfig const& config_;
};

// Composition Root – nơi duy nhất biết concrete classes
void SetupDiagnosticStack() {
    NvmDtcStorage    storage;
    EventBus         notifier;
    AraCoreLogger    logger;
    DemConfigFromNvm config;

    DemManager dem{storage, notifier, logger, config};
    dem.ReportEvent(0x0001, EventStatus::kFailed);
}
```

### 5.2 Method Injection và Setter Injection

```cpp
// Method injection: dependency chỉ cần cho 1 operation cụ thể
class DtcFormatter {
public:
    // IFormatter inject vào method – không cần lưu trữ
    std::string Format(DtcEntry const& entry, IFormatter& formatter) const {
        return formatter.Format(entry.dtc_number, entry.status);
    }
};

// Setter injection: optional dependency (có thể null/default)
class DiagnosticService {
public:
    DiagnosticService(IDtcStorage& storage) : storage_(storage) {}

    // Optional logger – nếu không set, dùng null logger
    void SetLogger(ILogger* logger) {
        logger_ = logger ? logger : &null_logger_;
    }

    void Process(DiagRequest const& req) {
        logger_->LogInfo("Processing request");
        // ...
    }

private:
    IDtcStorage& storage_;
    ILogger*     logger_      {&null_logger_};  // default null
    NullLogger   null_logger_;                  // no-op implementation
};
```

---

## 6. Type Erasure – Polymorphism không Inheritance

### 6.1 Vấn đề Type Erasure giải quyết

**Type Erasure** = kỹ thuật để dùng polymorphism mà **không cần hierarchy**, **không cần interface class**. Useful khi làm việc với third-party types không thể modify.

```cpp
// std::function là type erasure đơn giản nhất
// Giữ bất kỳ callable nào có signature void(std::string_view)

class EventDispatcher {
public:
    using Handler = std::function<void(std::string_view)>;

    void AddHandler(std::string_view event, Handler h) {
        handlers_[std::string(event)].push_back(std::move(h));
    }

    void Dispatch(std::string_view event, std::string_view data) const {
        auto it = handlers_.find(std::string(event));
        if (it == handlers_.end()) return;
        for (auto const& h : it->second) {
            h(data);
        }
    }

private:
    std::unordered_map<std::string, std::vector<Handler>> handlers_;
};

// Các loại handler khác nhau – không cần kế thừa từ gì cả
void FreeFunction(std::string_view data) {
    std::cout << "Free: " << data << "\n";
}

struct LambdaCapture {
    int id;
    void operator()(std::string_view data) const {
        std::cout << "Lambda[" << id << "]: " << data << "\n";
    }
};

class MemberHandler {
public:
    void Handle(std::string_view data) {
        std::cout << "Member: " << data << "\n";
    }
};

// Tất cả đều work:
MemberHandler mh;
EventDispatcher dispatcher;
dispatcher.AddHandler("dtc_stored", FreeFunction);
dispatcher.AddHandler("dtc_stored", LambdaCapture{42});
dispatcher.AddHandler("dtc_stored",
    [&mh](std::string_view d) { mh.Handle(d); });

dispatcher.Dispatch("dtc_stored", "DTC 0x1234");
```

### 6.2 Concept-based Type Erasure (manual, không inheritance)

```cpp
// Mục tiêu: Lưu bất kỳ "Serializable" type nào mà không cần interface class
// Useful khi: third-party types, legacy code, performance-critical
template <typename T>
concept Serializable = requires(T const t, std::ostream& os) {
    { t.Serialize(os) } -> std::same_as<void>;
    { t.GetName()     } -> std::convertible_to<std::string>;
};

class AnySerializable {
public:
    // Construct từ bất kỳ type nào thỏa Serializable
    template <Serializable T>
    /* implicit */ AnySerializable(T value)
        : pImpl_(std::make_unique<Model<T>>(std::move(value)))
    {}

    // API không đổi với mọi type
    void Serialize(std::ostream& os) const { pImpl_->Serialize(os); }
    std::string GetName()            const { return pImpl_->GetName(); }

private:
    // Internal interface (hidden)
    struct Concept {
        virtual void Serialize(std::ostream&) const = 0;
        virtual std::string GetName() const = 0;
        virtual ~Concept() = default;
    };

    // Wrapper cho từng concrete type
    template <typename T>
    struct Model final : Concept {
        explicit Model(T v) : value_(std::move(v)) {}
        void Serialize(std::ostream& os) const override { value_.Serialize(os); }
        std::string GetName() const override { return value_.GetName(); }
        T value_;
    };

    std::unique_ptr<Concept> pImpl_;
};

// Usage: lưu nhiều loại serializable mà không cần chung hierarchy
struct DtcData {
    uint32_t number; uint8_t status;
    void Serialize(std::ostream& os) const { os << "DTC " << number; }
    std::string GetName() const { return "DtcData"; }
};

struct FreezeFrameData {
    std::vector<uint8_t> bytes;
    void Serialize(std::ostream& os) const {
        for (auto b : bytes) os << std::hex << +b << " ";
    }
    std::string GetName() const { return "FreezeFrame"; }
};

// DtcData và FreezeFrameData KHÔNG kế thừa từ gì cả
std::vector<AnySerializable> records;
records.push_back(DtcData{0x1234, 0x08});
records.push_back(FreezeFrameData{{0x01, 0x02, 0x03}});

for (auto const& r : records) {
    std::cout << r.GetName() << ": ";
    r.Serialize(std::cout);
    std::cout << "\n";
}
```

---

## 7. Mini Project – DEM (Diagnostic Event Manager) hoàn chỉnh

```cpp
// Kết hợp tất cả: Abstract, Interface, NVI, SOLID, DI
// ================================================

// --- Interfaces (ISP) ---
class IDtcStorage {
public:
    virtual bool Store(DtcRecord const& r) = 0;
    virtual bool Retrieve(uint32_t dtc, DtcRecord& out) const = 0;
    virtual std::vector<DtcRecord> RetrieveAll() const = 0;
    virtual bool ClearAll() = 0;
    virtual ~IDtcStorage() = default;
};

class IFreezeFrameStorage {
public:
    virtual bool StoreFrame(uint32_t dtc, FreezeFrame const& ff) = 0;
    virtual bool GetFrame(uint32_t dtc, FreezeFrame& out) const = 0;
    virtual ~IFreezeFrameStorage() = default;
};

class IDemEventHandler {
public:
    virtual void OnEventReported(EventId id, EventStatus status) = 0;
    virtual void OnDTCStored(uint32_t dtc_number)                = 0;
    virtual void OnDTCCleared(uint32_t dtc_number)               = 0;
    virtual ~IDemEventHandler() = default;
};

// --- Abstract Base với NVI (SRP: manage events only) ---
class DemBase {
public:
    DemBase(IDtcStorage& dtc_store, IFreezeFrameStorage& ff_store)
        : dtc_store_(dtc_store), ff_store_(ff_store) {}

    virtual ~DemBase() = default;

    // NVI: public interface – pre/post conditions fixed
    void ReportEvent(EventId id, EventStatus status) {
        if (!IsValidEventId(id)) return;

        // Extension point:
        HandleEventReport(id, status);
        NotifyHandlers(id, status);
    }

    bool AddHandler(std::unique_ptr<IDemEventHandler> h) {
        if (!h) return false;
        handlers_.push_back(std::move(h));
        return true;
    }

protected:
    // Extension: derived classes customize DTC creation logic
    virtual void HandleEventReport(EventId id, EventStatus status) = 0;

    // Helpers DIP: access injection points
    IDtcStorage&          DtcStore()  { return dtc_store_; }
    IFreezeFrameStorage&  FfStore()   { return ff_store_; }

private:
    void NotifyHandlers(EventId id, EventStatus status) {
        for (auto& h : handlers_) {
            h->OnEventReported(id, status);
        }
    }

    static bool IsValidEventId(EventId id) {
        return id != kInvalidEventId;
    }

    IDtcStorage&         dtc_store_;
    IFreezeFrameStorage& ff_store_;
    std::vector<std::unique_ptr<IDemEventHandler>> handlers_;
};

// --- Concrete DEM (OCP: open for extension via AddHandler, closed for modification) ---
class StandardDem final : public DemBase {
public:
    StandardDem(IDtcStorage& dtc, IFreezeFrameStorage& ff,
                EventToDtcMap const& mapping)
        : DemBase(dtc, ff), event_map_(mapping) {}

protected:
    void HandleEventReport(EventId id, EventStatus status) override {
        // Map event → DTC number
        auto it = event_map_.find(id);
        if (it == event_map_.end()) return;

        uint32_t dtc_number = it->second;

        if (status == EventStatus::kFailed) {
            DtcRecord record{
                .dtc_number  = dtc_number,
                .status_byte = ComputeStatusByte(id),
                .occurrence  = IncrementOccurrence(dtc_number),
                .timestamp   = GetCurrentTimestamp()
            };
            DtcStore().Store(record);

            // Capture freeze frame
            FreezeFrame ff = CaptureCurrentFreezeFrame();
            FfStore().StoreFrame(dtc_number, ff);
        }
    }

private:
    EventToDtcMap const& event_map_;
    std::unordered_map<uint32_t, uint32_t> occurrence_counter_;

    uint8_t ComputeStatusByte(EventId id) const { /* ... */ return 0x08; }
    uint32_t IncrementOccurrence(uint32_t dtc) { return ++occurrence_counter_[dtc]; }
    uint64_t GetCurrentTimestamp() const { /* ... */ return 0; }
    FreezeFrame CaptureCurrentFreezeFrame() const { /* ... */ return {}; }
};
```

---

## 8. Bài tập thực hành

### Bài 1 – Refactor theo SOLID

**YC:** Cho class `NetworkConfig` làm tất cả:
- Đọc config từ file
- Validate IP/subnet
- Lưu vào NVRAM
- Gửi notification khi đổi

Refactor thành 4 classes riêng, inject dependencies qua constructor.

### Bài 2 – Type Erasure cho Metric Reporters

**YC:** Tạo `AnyMetricReporter` type-erased class có thể lưu bất kỳ object nào có:
- `void Report(std::string_view metric, float value)`
- `std::string GetBackendName() const`

Dùng concept-based type erasure. Test với 3 backend types không cùng hierarchy.

---

## Tóm tắt

| Kỹ thuật | Vấn đề giải quyết | Khi nào dùng |
|---|---|---|
| Abstract class | Define contract với shared logic | Template Method, framework base |
| Interface (pure abstract) | Contract thuần, no impl | Dependency boundaries, testing |
| NVI pattern | Bảo vệ pre/post conditions | Cross-cutting concerns (log, validate) |
| SRP | Class có >1 lý do thay đổi | Mọi lúc – phân tách responsibilities |
| OCP | Phải modify existing code để mở rộng | Plugin, handler, strategy patterns |
| LSP | Derived class hành xử khác base | Khi override làm thay đổi contract |
| ISP | Interface quá lớn, clients thừa methods | Mock-heavy codebase, plugin system |
| DIP | High-level phụ thuộc concrete | Testing, swap implementation |
| Constructor injection | Dependency rõ ràng và bắt buộc | Preferred DI method |
| std::function | Callable type erasure | Callback, event handler |
| Concept-based erasure | Polymorphism không inheritance | Third-party types, value semantics |

---

**← Phần trước:** [OOP Phần 7: Polymorphism](/adaptive-cpp/cpp-oop-polymorphism/)
