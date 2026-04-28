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

# Advanced C++ – Phần 1: Templates nâng cao, SFINAE & Concepts

> **Mục tiêu bài này:** Sau khi đọc xong, bạn sẽ hiểu cách compiler xử lý template ở mức sâu hơn, biết viết type traits, áp dụng SFINAE và Concepts để ràng buộc template – kèm ví dụ thực tế từ AUTOSAR Adaptive Platform.  
> **Yêu cầu trước:** Đã đọc [Hướng dẫn C++ Templates từ đầu](/cpp-template-intro/) hoặc quen với function/class template cơ bản.  
> **Compiler:** GCC ≥ 11, Clang ≥ 12 với `-std=c++20`

---

## 1. Function Templates nâng cao

### 1.1 Explicit Specialization – tại sao và khi nào dùng

Template chung hoạt động tốt với hầu hết kiểu dữ liệu, nhưng đôi khi **một kiểu cụ thể cần logic hoàn toàn khác**. Explicit specialization là cách nói với compiler: "với kiểu này, hãy dùng code của tôi thay vì sinh từ template chung".

**Ví dụ điển hình:** So sánh chuỗi C (`const char*`). Nếu dùng `operator>` trên pointer, ta so sánh địa chỉ bộ nhớ, không phải nội dung chuỗi — hoàn toàn sai về mặt logic.

```cpp
// ===== Template chung =====
template<typename T>
T max_val(T a, T b) {
    return (a > b) ? a : b;
    // Với int, double, float: operator> so sánh GIÁ TRỊ → đúng
    // Với const char*: operator> so sánh ĐỊA CHỈ bộ nhớ → SAI!
}

// ===== Explicit specialization cho const char* =====
// Cú pháp: template<> + tên hàm<kiểu cụ thể>
template<>
const char* max_val<const char*>(const char* a, const char* b) {
    // strcmp trả về số âm nếu a < b, 0 nếu bằng, số dương nếu a > b
    return (std::strcmp(a, b) > 0) ? a : b;
}

int main() {
    auto r1 = max_val(3, 7);          // Compiler dùng template chung, T = int → 7
    auto r2 = max_val(3.0, 2.5);      // Compiler dùng template chung, T = double → 3.0
    auto r3 = max_val("abc", "xyz");  // Compiler dùng SPECIALIZATION → "xyz"
    // Nếu không có specialization, r3 sẽ so sánh địa chỉ pointer – undefined behavior!
}
```

> **💡 Quy tắc ưu tiên:** Compiler luôn ưu tiên exact match không-template trước, rồi specialization, sau đó mới sinh từ primary template.

---

### 1.2 Non-Type Template Parameters (NTTP) – truyền giá trị vào template

Thông thường ta truyền **kiểu dữ liệu** vào template (`typename T`). NTTP cho phép truyền **giá trị hằng số** – điều này cực kỳ hữu ích để xác định kích thước buffer tại **compile-time**, không cần cấp phát heap.

**Tại sao quan trọng trong embedded/automotive:**  
- Hệ thống safety-critical (AUTOSAR, RTOS) thường cấm hoặc hạn chế `new`/`malloc` trong safety path vì không thể đảm bảo thời gian
- Buffer kích thước tĩnh → compiler biết dùng bao nhiêu stack/BSS → phân tích static stack usage được
- Kích thước là bất biến → compiler có thể optimize tốt hơn

```cpp
// T = kiểu phần tử, N = số phần tử tối đa (NTTP)
// std::size_t là unsigned int thích hợp cho size (không âm)
template<typename T, std::size_t N>
class StaticRingBuffer {
    T           data_[N];          // N phần tử nằm trực tiếp trong struct – không heap
    std::size_t head_{0};          // vị trí đọc tiếp theo
    std::size_t tail_{0};          // vị trí ghi tiếp theo
    std::size_t count_{0};         // số phần tử hiện có

public:
    // push: thêm vào đuôi, trả false nếu đầy
    bool push(const T& val) {
        if (count_ == N) return false;          // kiểm tra TRƯỚC khi ghi
        data_[tail_] = val;
        tail_ = (tail_ + 1) % N;               // % N: wrap around (0,1,2,...,N-1,0,1,...)
        ++count_;
        return true;
    }

    // pop: lấy từ đầu, trả false nếu rỗng
    bool pop(T& out) {
        if (count_ == 0) return false;
        out = data_[head_];
        head_ = (head_ + 1) % N;
        --count_;
        return true;
    }

    std::size_t size()     const noexcept { return count_; }
    bool        empty()    const noexcept { return count_ == 0; }
    bool        full()     const noexcept { return count_ == N; }
};

// Tạo hai buffer – HOÀN TOÀN ĐỘC LẬP, không dùng chung bộ nhớ
StaticRingBuffer<std::array<std::uint8_t, 8>, 16> can_rx_queue;   // 16 CAN frames
StaticRingBuffer<std::uint16_t, 32>               sensor_queue;   // 32 sensor values

// AP context: queue PDU frames mà không cần malloc
// Đây là StaticRingBuffer<array<uint8_t,8>, 16> – toàn bộ nằm trong BSS segment
```

> **⚠️ Lưu ý:** NTTP phải là **giá trị hằng số tại compile-time** (literal, `constexpr`, `enum`). Không thể truyền biến runtime như: `StaticRingBuffer<int, user_input>`.

---

## 2. Class Templates & Partial Specialization

### 2.1 Partial Specialization – "chuyên biệt hoá một phần"

**Khái niệm:** Partial specialization cho phép cung cấp implementation khác cho **nhóm kiểu** (không phải một kiểu cụ thể). Ví dụ: code khác cho tất cả pointer types, code khác khi hai tham số trùng nhau, v.v.

**Cách compiler quyết định dùng cái nào:**
```
Compiler nhìn vào tất cả specialization có sẵn
      ↓
Tìm cái "khớp nhất" (most specialized)
      ↓
Nếu không có → dùng primary template
```

```cpp
// ===== PRIMARY TEMPLATE – khuôn mẫu gốc =====
// Dùng khi không có specialization nào khớp hơn
template<typename T, typename U>
struct TypePair {
    using first_type  = T;
    using second_type = U;
    static constexpr bool same = false;  // mặc định: T và U khác nhau
};

// ===== PARTIAL SPECIALIZATION – khi cả hai tham số là cùng kiểu T =====
// Chỉ có một tham số template (T), nhưng dùng T cho cả hai vị trí
template<typename T>
struct TypePair<T, T> {                  // <- compiler đọc: "khi U == T"
    using first_type  = T;
    using second_type = T;
    static constexpr bool same = true;   // override: biết chúng như nhau
};

// Kiểm tra tại compile-time với static_assert
static_assert(!TypePair<int, double>::same);  // không khớp partial spec → same=false
static_assert( TypePair<int, int>::same);     // khớp partial spec T=int → same=true
static_assert( TypePair<float, float>::same); // khớp partial spec T=float → same=true
```

> **💡 Phân biệt:**
> - **Explicit specialization** `template<>`: fix HẾT tham số (cho một kiểu cụ thể)
> - **Partial specialization**: fix MỘT PHẦN tham số (cho một nhóm kiểu)

---

### 2.2 Template Template Parameters – truyền template vào template

Đây là tính năng nâng cao: thay vì truyền kiểu cụ thể như `std::vector<int>`, ta truyền **bản thân template** `std::vector` để class có thể "lắp" kiểu `T` vào sau.

**Khi nào cần:** Khi bạn muốn người dùng quyết định container backing store, nhưng logic wrapper vẫn chung.

```cpp
// Cú pháp: template<typename...> class Container
//                   ↑ các tham số mà Container cần  ↑ từ khoá "class" (bắt buộc ở đây)
template<template<typename...> class Container, typename T>
class TypedStore {
    Container<T> data_;       // Đây là nơi Container + T được "lắp" lại thành kiểu đầy đủ
                               // Ví dụ: Container=vector, T=int → data_ là std::vector<int>
public:
    void insert(T val)       { data_.push_back(std::move(val)); }
    std::size_t size() const { return data_.size(); }
    const T& at(std::size_t i) const { return data_.at(i); }
};

// Sử dụng – truyền template (không phải instance) làm tham số đầu tiên:
TypedStore<std::vector, int>         vec_store;    // data_ = std::vector<int>
TypedStore<std::deque, std::string>  deq_store;    // data_ = std::deque<std::string>
TypedStore<std::list, double>        lst_store;    // data_ = std::list<double>

// AP context: TypedStore<std::pmr::vector, ara::diag::Event> với PMR allocator
```

---

## 3. Type Traits – "hỏi thăm" kiểu dữ liệu tại compile-time

### 3.1 Type traits là gì?

**Type traits** là các struct template mà `::value` (hoặc `::type`) trả lời câu hỏi về kiểu dữ liệu **tại compile-time**. Header `<type_traits>` cung cấp hàng chục traits có sẵn.

```
Hỏi: "T có phải integer không?"     → std::is_integral<T>::value
Hỏi: "T có phải pointer không?"    → std::is_pointer<T>::value
Hỏi: "T có thể copy không?"        → std::is_copy_constructible<T>::value
Hỏi: "Kiểu T không có const là gì?" → std::remove_const<T>::type
```

Kết hợp với `if constexpr`, ta có thể **chọn code khác nhau cho từng kiểu** mà không tốn chi phí runtime nào:

```cpp
#include <type_traits>
#include <cstring>   // std::memcpy
#include <cstdint>

// Ví dụ thực tế: serialize bất kỳ kiểu cơ bản thành bytes
// Mỗi kiểu cần cách encode khác nhau
template<typename T>
void serialize(const T& val) {
    // if constexpr: compiler CHỌN một branch, các branch khác KHÔNG ĐƯỢC COMPILE
    // Điều này quan trọng: các branch chứa code không hợp lệ cho T sẽ bị bỏ qua hoàn toàn

    if constexpr (std::is_integral_v<T>) {
        // std::is_integral_v<T> là true cho: bool, char, int, long, uint8_t, ...
        // _v là shorthand của ::value (C++17)
        std::uint8_t buf[sizeof(T)];                    // sizeof(T) là compile-time constant
        std::memcpy(buf, &val, sizeof(T));              // copy raw bytes
        send_bytes(buf, sizeof(T));

    } else if constexpr (std::is_floating_point_v<T>) {
        // true cho: float (4 bytes), double (8 bytes), long double
        // IEEE 754: float và double có format chuẩn, safe để truyền thẳng
        static_assert(sizeof(T) == 4 || sizeof(T) == 8,
                      "Only float32 and float64 supported");
        send_bytes(reinterpret_cast<const std::uint8_t*>(&val), sizeof(T));

    } else {
        // Nhánh fallback cho struct, enum, v.v.
        // std::is_trivially_copyable: đảm bảo safe để copy bytes (không có deep pointer)
        static_assert(std::is_trivially_copyable_v<T>,
                      "T must be trivially copyable for raw serialization");
        send_bytes(reinterpret_cast<const std::uint8_t*>(&val), sizeof(T));
    }
    // Toàn bộ hàm này compile thành code tối ưu cho từng T cụ thể
    // Không có runtime if/else, không có overhead
}
```

---

### 3.2 Viết Custom Type Trait

Đôi khi ta cần hỏi những câu hỏi mà STL chưa có sẵn: "type này có method `.value()` không?" Đây là kỹ thuật dùng `std::void_t` (C++17):

**Cách hoạt động của `void_t` trick:**  
`std::void_t<Expr>` luôn là `void` nếu `Expr` hợp lệ. Nếu `Expr` không hợp lệ → substitution failure → compiler chọn primary template (false_type).

```cpp
// Bước 1: Primary template – kết quả "không có method"
// Tham số thứ hai là void, dùng để SFINAE trick
template<typename T, typename = void>
struct has_value_method : std::false_type {};
//                        ↑ kế thừa false_type → ::value = false

// Bước 2: Specialization – chỉ hợp lệ khi T CÓ method .value()
// std::void_t<...> chỉ tồn tại nếu expression bên trong hợp lệ
template<typename T>
struct has_value_method<T,
    std::void_t<                                    // luôn là void NẾU ... hợp lệ
        decltype(std::declval<T>().value())         // "giả sử có T t; gọi t.value()"
    >>
    : std::true_type {};                            // kế thừa true_type → ::value = true
// Nếu T không có .value() → decltype(...) gây lỗi → void_t fail → specialization bị loại
// → compiler dùng primary template → ::value = false

// Ứng dụng với if constexpr
template<typename T>
void log_result(const T& r) {
    if constexpr (has_value_method<T>::value) {
        // Nhánh này chỉ compile khi T có method .value()
        // Nếu không có if constexpr, compiler sẽ compile CẢ HAI nhánh
        // và báo lỗi khi T không có .value()
        std::cout << "Value: " << r.value() << '\n';
    } else {
        std::cout << "Raw: " << r << '\n';
    }
}

// std::optional<int> có .value() → has_value_method = true
// int không có .value()          → has_value_method = false
log_result(std::optional<int>{42});  // "Value: 42"
log_result(42);                      // "Raw: 42"
```

---

## 4. SFINAE – Substitution Failure Is Not An Error

### Hiểu SFINAE từ gốc rễ

**SFINAE** là cơ chế compiler C++ dùng để lựa chọn overload. Khi compiler thử dùng một function template và quá trình "điền T vào template" tạo ra code không hợp lệ, thay vì báo lỗi, compiler **lặng lẽ bỏ qua** hàm đó và thử lựa chọn khác.

```
Biểu đồ luồng xử lý overload:

gọi foo(42)
       │
       ▼
Tìm tất cả candidates tên "foo"
       │
   ┌───┴───┐
   │       │
template  template
foo<T=int> foo<T=int>
version 1  version 2
   │           │
"điền T=int"  "điền T=int"
   │           │
hợp lệ?    hợp lệ?
   │           │
  YES          NO  ← Substitution Failure → KHÔNG phải lỗi, bỏ qua
   │
chọn version 1
```

### 4.1 `enable_if` pattern – bật/tắt overload theo điều kiện

`std::enable_if_t<Condition>` là `void` khi Condition = true, và **không tồn tại** khi Condition = false (gây SFINAE).

```cpp
// ===== Overload 1: chỉ cho arithmetic types (int, float, double, ...) =====
// typename = std::enable_if_t<...>  là tham số template ẩn danh
// nếu Condition = true  → tham số là "typename = void" → hợp lệ → overload được chọn
// nếu Condition = false → enable_if_t không tồn tại → SFINAE: overload bị loại
template<typename T,
         typename = std::enable_if_t<std::is_arithmetic_v<T>>>
T clamp(T value, T lo, T hi) {
    return std::max(lo, std::min(value, hi));
    // std::max/min hoạt động tốt cho arithmetic types
}

// ===== Overload 2: fallback cho non-arithmetic (dùng operator<) =====
// Dùng thêm "typename = void" thứ ba để tránh "redefinition" với overload 1
// (vì signature giống hệt nếu chỉ nhìn vào tên các tham số)
template<typename T,
         typename = std::enable_if_t<!std::is_arithmetic_v<T>>,
         typename = void>
T clamp(T value, T lo, T hi) {
    if (value < lo) return lo;   // dùng operator< thay vì std::max
    if (hi < value) return hi;
    return value;
}

// Cách dùng:
clamp(15, 0, 10);              // overload 1 (int là arithmetic)
clamp(0.5f, 1.0f, 5.0f);      // overload 1 (float là arithmetic)
// clamp với std::string sẽ dùng overload 2 nếu có operator<
```

> **⚠️ SFINAE chỉ áp dụng cho phần "immediate context"**: Lỗi xảy ra BÊN TRONG thân hàm (sau khi bắt đầu compile) vẫn là lỗi thật, không phải SFINAE.

---

### 4.2 SFINAE qua Trailing Return Type

Cách khác để SFINAE: đặt điều kiện vào **return type** bằng `decltype`:

```cpp
// Hàm chỉ compile khi Container có .begin() và .end() VÀ có value_type
// Nếu Container không có những thứ đó → decltype fail → SFINAE → hàm bị loại
template<typename Container>
auto container_sum(const Container& c)
    -> decltype(                              // return type được suy luận từ đây
        std::begin(c),                        // Container phải có begin()
        std::end(c),                          // Container phải có end()
        typename Container::value_type{}      // Container phải có value_type
        // Trick: comma operator – chỉ lấy giá trị của expression cuối cùng
        // → return type là Container::value_type{}
    )
{
    typename Container::value_type total{};   // khởi tạo về "zero" cho kiểu đó
    for (const auto& elem : c) total += elem;
    return total;
}

// Hoạt động với std::vector, std::array, std::list, ...
// KHÔNG hoạt động với int, std::map, ... → SFINAE loại bỏ, không báo lỗi
std::vector<int> nums = {1, 2, 3, 4, 5};
container_sum(nums);   // → 15
```

---

## 5. C++20 Concepts – SFINAE được viết lại rõ ràng

### Vấn đề với SFINAE

SFINAE hoạt động nhưng có nhược điểm lớn:
1. **Cú pháp khó đọc** – `enable_if<is_integral_v<T>, void>` không nói lên ý nghĩa
2. **Lỗi compiler khủng khiếp** – khi sai, compiler báo `no matching function call` với traceback dài hàng trang
3. **Không thể reuse** – mỗi constraint phải viết lại từ đầu

**Concepts giải quyết cả 3 vấn đề**: cú pháp tường minh, lỗi ngắn gọn, có thể định nghĩa 1 lần dùng nhiều nơi.

---

### 5.1 Định nghĩa Concept

```cpp
#include <concepts>

// Concept = "tập hợp các yêu cầu" mà một type phải đáp ứng
// Syntax: concept TênConcept = biểu_thức_boolean_compile_time;

// ===== Concept đơn giản: dùng std::bool constant =====
template<typename T>
concept Numeric = std::is_arithmetic_v<T>;   // đúng nếu T là số học

// ===== Concept với requires expression =====
// requires(T val, ...) { ... } → tạo "sandbox" kiểm tra các expression
template<typename T>
concept Serializable = requires(T val, std::vector<std::uint8_t>& buf) {
    // Yêu cầu 1: T phải có method serialize(buf) trả void
    { val.serialize(buf) } -> std::same_as<void>;

    // Yêu cầu 2: T phải có static method deserialize(buf) trả T
    { T::deserialize(buf) } -> std::same_as<T>;

    // Yêu cầu 3: kích thước T không quá 1024 bytes (compile-time constraint)
    requires sizeof(T) <= 1024;
};

// ===== Concept kết hợp với || và && =====
template<typename T>
concept ArithmeticOrEnum = std::is_arithmetic_v<T> || std::is_enum_v<T>;

// ===== Concept kết hợp nhiều concept khác =====
template<typename T>
concept SafeToSend = Serializable<T> && std::is_trivially_copyable_v<T>;
```

---

### 5.2 Áp dụng Concept – 4 cách viết

C++20 có 4 cú pháp để áp dụng concept, từ tường minh nhất đến ngắn gọn nhất:

```cpp
// ===== Cách 1: requires clause (tường minh nhất) =====
template<typename T>
    requires Serializable<T>    // đặt sau template<>
void send_over_someip(const T& msg) {
    std::vector<std::uint8_t> buf;
    msg.serialize(buf);
    someip_transport_.send(buf);
}

// ===== Cách 2: Constrained template parameter =====
template<Serializable T>        // đặt concept trực tiếp thay typename
void send_over_someip_v2(const T& msg) { /* ... */ }

// ===== Cách 3: Abbreviated function template (C++20) =====
// "const std::integral auto" nghĩa là: auto với constraint std::integral
void log_integer(const std::integral auto& v) {
    std::printf("INT: %" PRId64 "\n", static_cast<std::int64_t>(v));
}
// Tương đương với:
// template<std::integral T> void log_integer(const T& v) { ... }

// ===== Cách 4: Constrained auto trong lambda =====
auto sum_range = [](const std::ranges::range auto& r) {
    // std::ranges::range: T phải có begin() và end()
    using V = std::ranges::range_value_t<decltype(r)>;
    return std::accumulate(std::begin(r), std::end(r), V{});
};
```

---

### 5.3 Ứng dụng trong AUTOSAR AP – Concept cho ara::diag handler

Đây là ứng dụng thực tế: `ara::diag` yêu cầu Read handler phải có exact signature. Nếu người dùng implement sai, ta muốn báo lỗi ngay tại dòng `register_did_handler`, không phải sâu trong implementation.

```cpp
// Concept mô phỏng contract mà ara::diag yêu cầu
// Handler phải có method Read với đúng signature
template<typename Handler>
concept DiagReadHandler = requires(
    Handler h,                           // giả sử có object handler h
    ara::diag::MetaInfo meta,            // giả sử có MetaInfo
    ara::diag::CancellationHandler cancel)
{
    // Kiểm tra: h.Read(meta, cancel) phải trả ara::core::Future<vector<uint8_t>>
    { h.Read(meta, cancel) }
        -> std::same_as<ara::core::Future<std::vector<std::uint8_t>>>;
    // Nếu Return type khác → lỗi NGAY TẠI đây với message rõ ràng
};

// Hàm đăng ký handler – chỉ chấp nhận handler đúng chuẩn
template<DiagReadHandler H>     // compiler kiểm tra H trước khi bắt đầu instantiate
void register_did_handler(std::uint16_t did, H handler) {
    did_registry_[did] = std::make_unique<HandlerWrapper<H>>(std::move(handler));
}

// === Ví dụ: handler đúng ===
struct SpeedDIDHandler {
    ara::core::Future<std::vector<std::uint8_t>>
    Read(ara::diag::MetaInfo, ara::diag::CancellationHandler) {
        // đọc tốc độ từ sensor, return future
    }
};
register_did_handler(0xF190, SpeedDIDHandler{});  // OK

// === Handler sai (trả void thay vì Future) ===
struct BadHandler {
    void Read(ara::diag::MetaInfo, ara::diag::CancellationHandler) {}
};
// register_did_handler(0xF190, BadHandler{});
// → Lỗi: "BadHandler does not satisfy DiagReadHandler"
// → Rõ ràng hơn nhiều so với SFINAE!
```

---

## 6. Variadic Templates – template với số lượng tham số không cố định

### Tại sao cần?

Đôi khi ta muốn hàm nhận **bất kỳ số lượng** argument thuộc **bất kỳ kiểu** nào. Ví dụ: `printf`, `std::tuple`, `std::make_unique`. Variadic template giải quyết điều này một cách type-safe.

**Khái niệm "parameter pack":**  
`typename... Args` là một gói (pack) kiểu. `Args...` khi dùng sẽ được "mở ra" (expand) thành danh sách.

```cpp
// ===== Cơ bản: fold expression (C++17) =====
// ((expr), ...) là fold expression với comma operator
// Nó expand thành: (expr_with_arg1), (expr_with_arg2), ...
template<typename... Args>
void print_all(Args&&... args) {
    // ((std::cout << args << ' '), ...) tương đương:
    // (std::cout << arg1 << ' '), (std::cout << arg2 << ' '), ...
    ((std::cout << std::forward<Args>(args) << ' '), ...);
    std::cout << '\n';
}

print_all(1, 3.14, "hello", true);
// output: 1 3.14 hello 1

// ===== Nâng cao: recursive parameter pack =====
// Base case: chỉ còn một phần tử → trả nó
template<typename T>
constexpr T sum(T v) { return v; }

// Recursive case: tách phần tử đầu tiên, đệ quy với phần còn lại
template<typename T, typename... Rest>   // T = đầu tiên, Rest... = phần còn lại
constexpr T sum(T first, Rest... rest) {
    return first + sum(rest...);         // sum(rest...) gọi đệ quy
    // Quá trình:
    // sum(1, 2, 3, 4, 5)
    // = 1 + sum(2, 3, 4, 5)
    // = 1 + 2 + sum(3, 4, 5)
    // = 1 + 2 + 3 + sum(4, 5)
    // = 1 + 2 + 3 + 4 + sum(5)
    // = 1 + 2 + 3 + 4 + 5 = 15
}

constexpr int total = sum(1, 2, 3, 4, 5);  // tính tại COMPILE TIME
static_assert(total == 15);                 // verify không cần chạy
```

---

### 6.3 Ứng dụng AP: Type-safe Event Dispatcher

```cpp
// EventDispatcher<Args...> là dispatcher cho event với signature (Args...)
// Args... là tham số của event – type-safe, không dùng void*

template<typename... EventArgs>
class EventDispatcher {
    // Mỗi handler là hàm nhận đúng (EventArgs...)
    using Handler = std::function<void(EventArgs...)>;
    std::vector<Handler> handlers_;

public:
    void subscribe(Handler h) {
        handlers_.push_back(std::move(h));
    }

    // emit: gọi tất cả handler với args được truyền vào
    // const: không thay đổi danh sách handlers
    void emit(EventArgs... args) const {
        // args... được "copy" vào từng lần gọi handler
        for (const auto& h : handlers_) h(args...);
    }
};

// Dùng cho SOME/IP event – type-safe: compiler đảm bảo argument đúng
EventDispatcher<std::uint16_t, std::vector<std::uint8_t>> raw_event;

raw_event.subscribe([](std::uint16_t id, const std::vector<std::uint8_t>& data) {
    std::printf("Event 0x%04X: %zu bytes\n", id, data.size());
});

// Nếu gọi sai kiểu → compile error (không phải runtime crash)
raw_event.emit(0x0100, some_payload);   // OK
// raw_event.emit("wrong", 42);         // compile error!
```

---

## 7. `if constexpr` – rẽ nhánh tại compile-time

### Tại sao không dùng `if` thông thường?

Trong template, compiler compile **tất cả các branch** của `if` thông thường. Nếu một branch chứa code không hợp lệ cho T, compiler sẽ báo lỗi dù branch đó không được thực thi.

`if constexpr` nói với compiler: "chỉ compile branch nào điều kiện là true, branch còn lại hãy bỏ qua hoàn toàn".

```cpp
// Helper cho trick "always-false static_assert trong else"
// Phải là template để delay evaluation
template<typename> inline constexpr bool always_false = false;

// Serialize bất kỳ kiểu – mỗi kiểu có format khác nhau
template<typename T>
std::vector<std::uint8_t> to_bytes(const T& val) {
    std::vector<std::uint8_t> out;

    if constexpr (std::is_same_v<T, std::string>) {
        // Nhánh này CHỈ ĐƯỢC COMPILE khi T = std::string
        // std::string cần length prefix để receiver biết kết thúc
        std::uint16_t len = static_cast<std::uint16_t>(val.size());
        out.push_back(len >> 8);           // high byte của length
        out.push_back(len & 0xFF);         // low byte của length
        out.insert(out.end(), val.begin(), val.end());  // data

    } else if constexpr (std::is_trivially_copyable_v<T>) {
        // Nhánh này CHỈ ĐƯỢC COMPILE khi T không phải string nhưng có thể copy bytes
        // int, float, uint32_t, struct với POD data, v.v.
        out.resize(sizeof(T));
        std::memcpy(out.data(), &val, sizeof(T));

    } else {
        // Nhánh này: T không được hỗ trợ
        // always_false<T> là false nhưng phụ thuộc vào T
        // → static_assert chỉ fire khi nhánh này được instantiate
        // → không fire khi T là string hay trivially copyable
        static_assert(always_false<T>, "Unsupported type for to_bytes()");
    }
    return out;
    // Lưu ý: không có runtime overhead – mỗi instantiation chỉ chứa đúng một nhánh
}

// Test:
to_bytes(42);              // T=int: trivially copyable → 4 bytes raw
to_bytes(std::string("hi")); // T=string: length-prefixed
// to_bytes(std::mutex{});  // → static_assert: Unsupported type
```

---

## 8. Bài tập thực hành

### Bài 1 – StaticVector (không dùng heap)

Implement `StaticVector<T, N>` sử dụng NTTP và placement new – một vector không bao giờ cấp phát heap.

```cpp
template<typename T, std::size_t N>
class StaticVector {
    // Gợi ý: std::aligned_storage_t đảm bảo alignment đúng cho T
    std::aligned_storage_t<sizeof(T), alignof(T)> storage_[N];
    std::size_t size_{0};

public:
    // TODO: implement các methods sau:
    // push_back(const T& val)     – placement new, tăng size_
    // pop_back()                  – gọi destructor explicit, giảm size_
    // operator[](std::size_t i)   – cast storage về T*
    // size(), empty(), full()     – query methods
    // begin(), end()              – iterator (trả T*)
    // ~StaticVector()             – gọi destructor cho tất cả phần tử còn lại
};
```

**AP Context:** Dùng cho PDU buffer trong low-latency path của `ara::com` – không được gọi `new` trong interrupt context.

---

### Bài 2 – TypedResult với Concepts

Implement `TypedResult<T, E>` mô phỏng `ara::core::Result` với một Concept để đảm bảo T hợp lệ:

```cpp
// Concept: T phải copyable và có default constructor
template<typename T>
concept ResultCompatible = std::copyable<T> && std::default_initializable<T>;

template<ResultCompatible T, typename E = std::string>
class TypedResult {
    // TODO: dùng std::variant<T, E> bên trong
public:
    static TypedResult Ok(T val);
    static TypedResult Err(E err);
    bool HasValue() const;
    T    Value()   const;   // throw nếu là error
    E    Error()   const;   // throw nếu là success
};
```

---

### Bài 3 – Compile-time CRC32 Table

Tạo lookup table CRC-32 tại compile-time dùng `constexpr`:

```cpp
// Gợi ý: tạo mảng 256 entry bằng constexpr function hoặc template
constexpr std::array<std::uint32_t, 256> make_crc32_table() { /* ... */ }
constexpr auto CRC32_TABLE = make_crc32_table();

constexpr std::uint32_t crc32(const char* data, std::size_t len) {
    std::uint32_t crc = 0xFFFFFFFF;
    for (std::size_t i = 0; i < len; ++i)
        crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    return crc ^ 0xFFFFFFFF;
}

// Verify tại compile-time:
static_assert(crc32("123456789", 9) == 0xCBF43926);
```

**AP Context:** UCM dùng CRC để verify integrity của Software Package trước khi install.

---

### Bài 4 – Variadic Signal Bus

Implement `SignalBus` cho phép subscribe/publish theo kiểu type-safe:

```cpp
SignalBus bus;
bus.subscribe<VehicleSpeed>([](VehicleSpeed s){ /* ... */ });
bus.subscribe<EngineRPM>([](EngineRPM r){ /* ... */ });
bus.publish(VehicleSpeed{120.0f});  // chỉ gọi VehicleSpeed handlers, không gọi EngineRPM

// Gợi ý nội bộ:
// std::unordered_map<std::type_index, std::vector<std::any>> handlers_;
// subscribe<T>: thêm handler vào handlers_[typeid(T)]
// publish<T>(val): lấy handlers_[typeid(T)], cast each to function<void(T)>, gọi
```

---

## Tóm tắt – Khi nào dùng kỹ thuật nào?

| Kỹ thuật | Vấn đề giải quyết | Ví dụ AP thực tế |
|---|---|---|
| **Explicit specialization** | Logic khác cho một kiểu cụ thể | So sánh `const char*` vs giá trị số |
| **NTTP** | Kích thước cố định, không cần heap | `StaticRingBuffer<Frame, 16>` |
| **Partial specialization** | Logic khác cho nhóm kiểu | Pointer types, same-type pairs |
| **Type traits + if constexpr** | Chọn code theo đặc tính kiểu | Generic serializer |
| **Custom type trait** | Kiểm tra interface của type | `has_value_method`, `has_serialize` |
| **SFINAE (enable_if)** | Conditional overload – C++14/17 | Legacy code, library compatibility |
| **Concepts (C++20)** | Ràng buộc tường minh, lỗi rõ | `DiagReadHandler`, `Serializable` |
| **Variadic templates** | N tham số, N kiểu | `EventDispatcher`, `SignalBus` |
| **`if constexpr`** | Compile-time branching | `to_bytes<T>`, `serialize<T>` |

**← Xem thêm:** [Hướng dẫn Templates từ đầu](/cpp-template-intro/) cho nền tảng  
**Phần tiếp →** [C++ Nâng cao Phần 2: Memory & RAII](/cpp-memory/)
