---
layout: default
title: "Advanced C++ – Phần 1: Templates, SFINAE & Concepts"
nav_exclude: true
module: true
category: adaptive_cpp
tags: [cpp, templates, sfinae, concepts, cpp20, type-traits, metaprogramming]
description: "Template metaprogramming, SFINAE, Concepts C++20 từ cơ bản đến nâng cao – kèm ứng dụng thực tế trong AUTOSAR Adaptive Platform (ara::com, ara::diag)."
permalink: /cpp-templates/
---

# Advanced C++ – Phần 1: Templates, SFINAE & Concepts

> **Môi trường:** C++17/C++20 · **Compiler:** GCC ≥ 11, Clang ≥ 12  
> **Ứng dụng AP:** `ara::com` proxy/skeleton generation, `ara::diag` handler registration

---

## 1. Function Templates – Nền tảng

### 1.1 Template cơ bản và deduction

```cpp
// Generic max – compiler deduces T tại call site
template<typename T>
T max_val(T a, T b) {
    return (a > b) ? a : b;
}

// Explicit specialization cho const char*
template<>
const char* max_val<const char*>(const char* a, const char* b) {
    return (std::strcmp(a, b) > 0) ? a : b;
}

int main() {
    auto r1 = max_val(3, 7);        // T = int
    auto r2 = max_val(3.0, 2.5);   // T = double
    auto r3 = max_val("abc", "xyz"); // specialization
}
```

### 1.2 Non-type template parameter (NTTP)

```cpp
// Buffer tĩnh với size tại compile-time
template<typename T, std::size_t N>
class StaticRingBuffer {
    T     data_[N];
    std::size_t head_{0}, tail_{0}, count_{0};
public:
    bool push(const T& val) {
        if (count_ == N) return false;
        data_[tail_] = val;
        tail_ = (tail_ + 1) % N;
        ++count_;
        return true;
    }
    bool pop(T& out) {
        if (count_ == 0) return false;
        out = data_[head_];
        head_ = (head_ + 1) % N;
        --count_;
        return true;
    }
    std::size_t size() const noexcept { return count_; }
};

// AP context: queue PDU frames không cần heap allocation
StaticRingBuffer<std::array<std::uint8_t, 8>, 16> can_rx_queue;
```

---

## 2. Class Templates & Partial Specialization

### 2.1 Partial specialization

```cpp
// Primary template
template<typename T, typename U>
struct TypePair {
    using first_type  = T;
    using second_type = U;
    static constexpr bool same = false;
};

// Partial spec: khi T == U
template<typename T>
struct TypePair<T, T> {
    using first_type  = T;
    using second_type = T;
    static constexpr bool same = true;
};

static_assert(!TypePair<int, double>::same);
static_assert( TypePair<int, int>::same);
```

### 2.2 Template template parameter

```cpp
// Wrapper generic container – áp dụng trong result/optional pattern của ara::core
template<template<typename...> class Container, typename T>
class TypedStore {
    Container<T> data_;
public:
    void insert(T val)          { data_.push_back(std::move(val)); }
    std::size_t size() const    { return data_.size(); }
};

TypedStore<std::vector, int>       int_store;
TypedStore<std::deque,  std::string> str_store;
```

---

## 3. Type Traits – Lập trình tại compile-time

### 3.1 std::type_traits cơ bản

```cpp
#include <type_traits>

template<typename T>
void serialize(const T& val) {
    if constexpr (std::is_integral_v<T>) {
        // little-endian encode integer
        std::uint8_t buf[sizeof(T)];
        std::memcpy(buf, &val, sizeof(T));
        send_bytes(buf, sizeof(T));
    } else if constexpr (std::is_floating_point_v<T>) {
        // IEEE 754 encode
        static_assert(sizeof(T) == 4 || sizeof(T) == 8);
        send_bytes(reinterpret_cast<const std::uint8_t*>(&val), sizeof(T));
    } else {
        static_assert(std::is_trivially_copyable_v<T>,
                      "T must be trivially copyable for raw serialization");
        send_bytes(reinterpret_cast<const std::uint8_t*>(&val), sizeof(T));
    }
}
```

### 3.2 Custom type trait

```cpp
// Trait kiểm tra một type có method .value() hay không
template<typename T, typename = void>
struct has_value_method : std::false_type {};

template<typename T>
struct has_value_method<T,
    std::void_t<decltype(std::declval<T>().value())>>
    : std::true_type {};

// Ứng dụng: kiểm tra ara::core::Result / std::optional
template<typename T>
void log_result(const T& r) {
    if constexpr (has_value_method<T>::value) {
        std::cout << "Value: " << r.value() << '\n';
    } else {
        std::cout << "Raw: " << r << '\n';
    }
}
```

---

## 4. SFINAE – Substitution Failure Is Not An Error

### 4.1 enable_if pattern

```cpp
// Chỉ cho phép gọi với arithmetic types
template<typename T,
         typename = std::enable_if_t<std::is_arithmetic_v<T>>>
T clamp(T value, T lo, T hi) {
    return std::max(lo, std::min(value, hi));
}

// Overload cho non-arithmetic – sẽ được chọn khi T không phải arithmetic
template<typename T,
         typename = std::enable_if_t<!std::is_arithmetic_v<T>>,
         typename = void>  // extra param để tránh redefinition
T clamp(T value, T lo, T hi) {
    // fallback: dùng operator<
    if (value < lo) return lo;
    if (hi < value) return hi;
    return value;
}
```

### 4.2 SFINAE với trailing return type

```cpp
// Hàm chỉ compile khi T có .begin() / .end()
template<typename Container>
auto container_sum(const Container& c)
    -> decltype(std::begin(c), std::end(c),
                typename Container::value_type{})
{
    typename Container::value_type total{};
    for (const auto& elem : c) total += elem;
    return total;
}
```

---

## 5. C++20 Concepts – SFINAE "thế hệ mới"

Concepts thay thế hoàn toàn SFINAE bằng cú pháp rõ ràng, lỗi compiler dễ đọc hơn.

### 5.1 Định nghĩa concept

```cpp
#include <concepts>

// Concept tự định nghĩa
template<typename T>
concept Serializable = requires(T val, std::vector<std::uint8_t>& buf) {
    { val.serialize(buf) } -> std::same_as<void>;
    { T::deserialize(buf) } -> std::same_as<T>;
    sizeof(T) <= 1024;  // size constraint
};

// Concept kết hợp
template<typename T>
concept ArithmeticOrEnum = std::is_arithmetic_v<T> || std::is_enum_v<T>;
```

### 5.2 Áp dụng concept

```cpp
// requires clause
template<typename T>
    requires Serializable<T>
void send_over_someip(const T& msg) {
    std::vector<std::uint8_t> buf;
    msg.serialize(buf);
    someip_transport_.send(buf);
}

// Abbreviated function template (C++20)
void log_value(const std::integral auto& v) {
    std::printf("INT %" PRId64 "\n", static_cast<std::int64_t>(v));
}

// Constrained auto in lambda
auto sum_range = [](const std::ranges::range auto& r) {
    return std::accumulate(std::begin(r), std::end(r),
                           std::ranges::range_value_t<decltype(r)>{});
};
```

### 5.3 AP Application – Concept cho ara::diag handler

```cpp
// Concept mô phỏng interface mà ara::diag yêu cầu của Read handler
template<typename Handler>
concept DiagReadHandler = requires(Handler h,
                                    ara::diag::MetaInfo meta,
                                    ara::diag::CancellationHandler cancel)
{
    { h.Read(meta, cancel) }
        -> std::same_as<ara::core::Future<std::vector<std::uint8_t>>>;
};

// Chỉ accept handler đúng chuẩn tại compile-time
template<DiagReadHandler H>
void register_did_handler(std::uint16_t did, H handler) {
    did_registry_[did] = std::make_unique<HandlerWrapper<H>>(std::move(handler));
}
```

---

## 6. Variadic Templates

### 6.1 Parameter pack cơ bản

```cpp
// Tuple-like print (C++17 fold expression)
template<typename... Args>
void print_all(Args&&... args) {
    ((std::cout << std::forward<Args>(args) << ' '), ...);
    std::cout << '\n';
}

print_all(1, 3.14, "hello", true);
// output: 1 3.14 hello 1
```

### 6.2 Recursive parameter pack

```cpp
// Tính tổng tại compile-time
template<typename T>
constexpr T sum(T v) { return v; }

template<typename T, typename... Rest>
constexpr T sum(T first, Rest... rest) {
    return first + sum(rest...);
}

constexpr int total = sum(1, 2, 3, 4, 5);  // = 15
static_assert(total == 15);
```

### 6.3 AP Application – Type-safe event multiplexer

```cpp
// Dispatcher: gọi tất cả handler đã đăng ký với type-safe args
template<typename... EventArgs>
class EventDispatcher {
    using Handler = std::function<void(EventArgs...)>;
    std::vector<Handler> handlers_;
public:
    void subscribe(Handler h)       { handlers_.push_back(std::move(h)); }
    void emit(EventArgs... args) const {
        for (const auto& h : handlers_) h(args...);
    }
};

// Dùng cho SOME/IP event notification
EventDispatcher<std::uint16_t, std::vector<std::uint8_t>> raw_event;
raw_event.subscribe([](std::uint16_t id, const auto& data) {
    std::printf("Event 0x%04X: %zu bytes\n", id, data.size());
});
raw_event.emit(0x0100, payload);
```

---

## 7. if constexpr & Compile-time Branching

```cpp
// Serialize bất kỳ type – zero overhead runtime branch
template<typename T>
std::vector<std::uint8_t> to_bytes(const T& val) {
    std::vector<std::uint8_t> out;
    if constexpr (std::is_same_v<T, std::string>) {
        // Length-prefixed UTF-8
        std::uint16_t len = static_cast<std::uint16_t>(val.size());
        out.push_back(len >> 8);
        out.push_back(len & 0xFF);
        out.insert(out.end(), val.begin(), val.end());
    } else if constexpr (std::is_trivially_copyable_v<T>) {
        out.resize(sizeof(T));
        std::memcpy(out.data(), &val, sizeof(T));
    } else {
        static_assert(always_false<T>, "Unsupported type for serialization");
    }
    return out;
}

// Helper để trigger static_assert trong else branch
template<typename> inline constexpr bool always_false = false;
```

---

## 8. Bài tập thực hành

### Bài 1 – StaticVector (không dùng heap)
Implement `StaticVector<T, N>`: `push_back`, `pop_back`, `operator[]`, `size`, `begin/end`.  
Yêu cầu: Dùng `std::aligned_storage` hoặc `std::array<std::byte, sizeof(T)*N>`, placement new.  
**AP Context:** Dùng cho PDU buffer trong low-latency path của ara::com.

```cpp
template<typename T, std::size_t N>
class StaticVector {
    // TODO: implement
    // Hint: std::aligned_storage_t<sizeof(T), alignof(T)> storage_[N];
};
```

### Bài 2 – TypedResult với Concepts
Implement `TypedResult<T, E>` (giống `ara::core::Result`) với:
- `static TypedResult Ok(T val)`
- `static TypedResult Err(E err)`
- `bool HasValue() const`
- `T Value() const`  — throw nếu là error
- `E Error() const`

Thêm Concept `ResultCompatible<T>` yêu cầu T phải `std::copyable` và có default constructor.

### Bài 3 – Compile-time CRC table
Tạo `constexpr` lookup table CRC-32 (256 entry) tại compile-time dùng template/constexpr.  
Viết `constexpr uint32_t crc32(const char* data, size_t len)`.  
**AP Context:** Verify Software Package integrity trong UCM.

### Bài 4 – Variadic Signal Bus
Implement `SignalBus` nhận subscribe và publish với multiple signal types:
```cpp
SignalBus bus;
bus.subscribe<VehicleSpeed>([](VehicleSpeed s){ ... });
bus.subscribe<EngineRPM>([](EngineRPM r){ ... });
bus.publish(VehicleSpeed{120.0f});  // chỉ gọi VehicleSpeed handlers
```
Hint: dùng `std::type_index` + `std::any` hoặc variadic template registry.

---

## Tóm tắt

| Kỹ thuật | Khi dùng | AP Application |
|---|---|---|
| Function template | Generic algorithm | Serialization, min/max |
| NTTP | Compile-time size | StaticBuffer, StaticVector |
| Type traits | Branch tại compile-time | Serialize any type |
| SFINAE | Conditional overload (C++14/17) | Legacy CP code |
| **Concepts** | Constraint tường minh (C++20) | ara::diag handler constraint |
| Variadic templates | N-ary generic code | EventDispatcher, Signal bus |
| `if constexpr` | Compile-time branching | to_bytes generic |
| Partial specialization | Per-type customization | Container adapters |

**Phần tiếp →** [C++ Nâng cao Phần 2: Memory & RAII](/cpp-memory/)
