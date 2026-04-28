---
layout: default
title: "Hướng dẫn C++ Templates từ đầu – Tại sao và Làm thế nào"
description: "Hướng dẫn C++ Templates từ zero: tại sao cần templates, cách compiler xử lý, function/class template, NTTP, partial specialization – từng bước có giải thích đầy đủ."
category: adaptive_cpp
module: true
nav_exclude: true
permalink: /adaptive-cpp/cpp-template-intro/
tags: [cpp, templates, beginner, tutorial, generics, type-deduction]
---

# Hướng dẫn C++ Templates từ đầu

> **Mục tiêu:** Hiểu được tại sao templates tồn tại, cách chúng hoạt động bên dưới, và tự viết được function/class template cho bài toán thực tế.  
> **Yêu cầu trước:** Biết C++ cơ bản (functions, classes, pointers).  
> **Compiler:** GCC ≥ 9 hoặc Clang ≥ 10 với flag `-std=c++17`

---

## 1. Vấn đề – Tại sao cần Templates?

Hãy bắt đầu từ một bài toán đơn giản: viết hàm **tính giá trị lớn hơn** giữa hai số.

### Vấn đề với code thông thường

Nếu không có templates, bạn phải viết một hàm riêng cho **mỗi kiểu dữ liệu**:

```cpp
// Phải viết lại cho từng kiểu – DRY violation
int    max_int   (int a,    int b)    { return (a > b) ? a : b; }
double max_double(double a, double b) { return (a > b) ? a : b; }
float  max_float (float a,  float b)  { return (a > b) ? a : b; }
// ... và tiếp tục với long, unsigned int, v.v.
```

**Logic hoàn toàn giống nhau**, chỉ khác kiểu dữ liệu. Nếu logic có bug, phải sửa ở **tất cả các hàm**. Đây là vấn đề templates giải quyết.

---

## 2. Template là gì? – Khái niệm cốt lõi

**Template** = khuôn mẫu (blueprint) để compiler **tự động tạo ra code** cho từng kiểu dữ liệu mà bạn cần.

```
Bạn viết:  template code (1 lần)
             ↓
Compiler:  đọc khuôn mẫu + kiểu dữ liệu được dùng
             ↓
Compiler:  tạo ra code cụ thể cho từng kiểu (gọi là "instantiation")
             ↓
Binary:    chứa code riêng cho int, double, v.v.
```

### Ví dụ đơn giản nhất

```cpp
// Từ khoá "template<typename T>" nghĩa là:
// "T là một placeholder cho kiểu dữ liệu nào đó"
template<typename T>
T max_val(T a, T b) {
    return (a > b) ? a : b;
}

int main() {
    // Compiler ĐỌC: max_val(3, 7)  → T = int  → tạo ra max_val<int>
    int    result1 = max_val(3, 7);        // T được suy luận = int

    // Compiler ĐỌC: max_val(3.0, 2.5) → T = double → tạo ra max_val<double>
    double result2 = max_val(3.0, 2.5);   // T được suy luận = double

    // Bạn cũng có thể chỉ định T rõ ràng:
    float  result3 = max_val<float>(1.0f, 2.0f);
}
```

> **Điểm quan trọng:** Compiler tạo ra **2 hàm riêng biệt** trong binary: `max_val<int>` và `max_val<double>`. Templates không có chi phí runtime – chi phí xảy ra ở **compile time**.

---

## 3. Cú pháp Templates chi tiết

### 3.1 Khai báo template

```cpp
// Cú pháp:
template< danh_sách_tham_số_template >
khai_báo_hàm_hoặc_class
```

Ví dụ:

```cpp
// T là tên ta tự đặt (thường dùng T, U, V, hay tên mô tả như ValueType)
template<typename T>
void print(const T& val) {
    std::cout << val << '\n';
}

// Cũng hợp lệ – "class" và "typename" đều được ở đây
template<class T>
void print_v2(const T& val) {
    std::cout << val << '\n';
}
```

Phân biệt `typename` vs `class` trong khai báo template:
- Về mặt kỹ thuật: **hoàn toàn tương đương** trong `template<typename T>` và `template<class T>`
- Về convention: nhiều người dùng `typename` để tránh nhầm với `class` khai báo class thực sự
- **Ngoại lệ:** Khi dùng template template parameter thì phải dùng `class` (xem phần 6)

---

### 3.2 Template Type Deduction – Compiler suy luận T như thế nào

Khi gọi hàm template mà không chỉ định T rõ ràng, compiler **suy luận** T từ argument:

```cpp
template<typename T>
void show(T x) { std::cout << x << '\n'; }

show(42);        // T = int    (42 là int literal)
show(3.14);      // T = double (3.14 là double literal)
show(3.14f);     // T = float  (3.14f là float literal)
show("hello");   // T = const char* (chuỗi literal decay thành pointer)

// Khi có const reference:
template<typename T>
void show_ref(const T& x) { std::cout << x << '\n'; }

int n = 5;
show_ref(n);    // T = int    (const reference: T = int, x = const int&)
show_ref(5);    // T = int    (5 là rvalue, nhưng const& có thể bind)
```

**Quy tắc deduction quan trọng:**

```cpp
template<typename T>
void func(T x);       // T nhận kiểu của argument, bỏ qua top-level const/ref

template<typename T>
void func_ref(T& x);  // T = kiểu thực sự, reference KHÔNG bị bỏ qua

template<typename T>
void func_cref(const T& x); // T = kiểu cơ bản (bỏ const/ref), x = const T&

template<typename T>
void func_rref(T&& x);      // Universal reference – phức tạp hơn, xem phần 7
```

Ví dụ minh hoạ:

```cpp
int x = 5;
const int cx = 5;
int& rx = x;

// func(T x):
func(x);   // T = int
func(cx);  // T = int (top-level const bị bỏ)
func(rx);  // T = int (reference bị bỏ)

// func_ref(T& x):
func_ref(x);   // T = int,       x là int&
func_ref(cx);  // T = const int, x là const int&
// func_ref(5);  // LỖI: 5 là rvalue, không bind được vào T&
```

---

## 4. Function Templates – Từng bước thực hành

### 4.1 Viết function template đầu tiên

**Bài toán:** Viết hàm `clamp` – giới hạn giá trị trong đoạn [lo, hi].

**Bước 1:** Viết cho một kiểu cụ thể trước:

```cpp
// Phiên bản cho int
int clamp_int(int value, int lo, int hi) {
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
}
```

**Bước 2:** Nhận ra pattern và tổng quát hoá bằng template:

```cpp
// Thay "int" bằng T → thêm template<typename T>
template<typename T>
T clamp(T value, T lo, T hi) {
    if (value < lo) return lo;  // Yêu cầu: T phải có operator<
    if (value > hi) return hi;  // Yêu cầu: T phải có operator>
    return value;
}
```

**Bước 3:** Kiểm tra:

```cpp
int   i = clamp(15, 0, 10);       // T=int,    trả về 10
float f = clamp(0.5f, 1.0f, 5.0f); // T=float,  trả về 1.0f
// clamp("abc", "aaa", "zzz");    // hoạt động nếu std::string!
```

**Bước 4:** Thêm ràng buộc (C++20 concepts) để lỗi compiler dễ đọc hơn:

```cpp
// Không có concept → lỗi khó hiểu khi dùng sai
// Ví dụ: clamp(std::mutex{}, ...) sẽ cho error dài hàng trang

// Có concept → lỗi ngắn gọn, chỉ thẳng vào vấn đề
#include <concepts>
template<std::totally_ordered T>  // T phải có đủ <, >, ==, v.v.
T clamp(T value, T lo, T hi) {
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
}
```

---

### 4.2 Template với nhiều type parameters

```cpp
// Hàm convert một kiểu sang kiểu khác, giống static_cast nhưng
// tường minh hơn về intent
template<typename To, typename From>
To narrow_cast(From val) {
    auto result = static_cast<To>(val);
    // debug check: trong debug build, kiểm tra giá trị không bị mất
    assert(static_cast<From>(result) == val && "narrow_cast: value loss detected");
    return result;
}

// Cách dùng – phải chỉ định To vì compiler không thể suy luận return type:
uint8_t byte_val = narrow_cast<uint8_t>(255);  // OK
uint8_t bad_val  = narrow_cast<uint8_t>(300);  // assert fails in debug!
```

**Tại sao `To` phải chỉ định rõ?**  
Compiler suy luận `From` từ argument (`300` → `int`), nhưng `To` là return type – không có argument nào để suy luận từ đó.

---

### 4.3 Template specialization – Tuỳ chỉnh cho một kiểu cụ thể

Đôi khi template chung không hoạt động đúng cho một kiểu cụ thể. Dùng **explicit specialization**:

```cpp
// Template chung
template<typename T>
bool are_equal(T a, T b) {
    return a == b;
}

// Vấn đề: so sánh float/double bằng == thường không đúng do floating point error
// 0.1 + 0.2 == 0.3 là FALSE trong floating point!
// Explicit specialization cho double:
template<>
bool are_equal<double>(double a, double b) {
    constexpr double EPSILON = 1e-9;
    return std::fabs(a - b) < EPSILON;
}

template<>
bool are_equal<float>(float a, float b) {
    constexpr float EPSILON = 1e-6f;
    return std::fabsf(a - b) < EPSILON;
}

// Test:
are_equal(1, 1);             // template chung → true
are_equal(0.1 + 0.2, 0.3);  // specialization → true (tolerance-based)
```

---

## 5. Class Templates – Blueprint cho cấu trúc dữ liệu

### 5.1 Concept – Class template là gì

Class template cho phép tạo cấu trúc dữ liệu generic. `std::vector<T>`, `std::pair<A,B>` đều là class template.

### 5.2 Xây dựng Stack từ đầu

Ta sẽ xây dựng class `Stack<T>` từng bước:

**Bước 1 – Skeleton:**

```cpp
template<typename T>           // ← đây là class template
class Stack {
    // Dữ liệu thực sự lưu trữ – dùng std::vector để quản lý memory
    std::vector<T> data_;      // T được dùng ở đây

public:
    // Constructor mặc định – vector tự khởi tạo empty
    Stack() = default;

    // Thêm phần tử vào đỉnh
    void push(const T& val);

    // Lấy và xóa phần tử ở đỉnh
    T pop();

    // Xem phần tử ở đỉnh mà không xóa
    const T& top() const;

    // Kiểm tra rỗng
    bool empty() const;

    // Số phần tử
    std::size_t size() const;
};
```

**Bước 2 – Implement từng method:**

```cpp
template<typename T>
class Stack {
    std::vector<T> data_;

public:
    Stack() = default;

    // ------- push -------
    // const T& val: nhận bằng const reference để tránh copy khi không cần
    void push(const T& val) {
        data_.push_back(val);   // vector append vào cuối
    }

    // Move overload: nếu caller truyền rvalue, move thay vì copy
    void push(T&& val) {
        data_.push_back(std::move(val));
    }

    // ------- pop -------
    T pop() {
        // Kiểm tra trước khi pop
        if (data_.empty()) {
            throw std::underflow_error("Stack::pop() called on empty stack");
        }
        T val = std::move(data_.back());  // lấy phần tử cuối (di chuyển, không copy)
        data_.pop_back();                 // xóa khỏi vector
        return val;
    }

    // ------- top -------
    const T& top() const {
        if (data_.empty()) {
            throw std::underflow_error("Stack::top() called on empty stack");
        }
        return data_.back();   // reference đến phần tử cuối, không copy
    }

    // ------- empty / size -------
    bool        empty() const { return data_.empty(); }
    std::size_t size()  const { return data_.size();  }
};
```

**Bước 3 – Sử dụng:**

```cpp
// Stack<int> hoàn toàn độc lập với Stack<std::string>
Stack<int> int_stack;
int_stack.push(10);
int_stack.push(20);
int_stack.push(30);

std::cout << int_stack.top();  // 30
int_stack.pop();
std::cout << int_stack.top();  // 20

Stack<std::string> str_stack;
str_stack.push("hello");
str_stack.push("world");
std::cout << str_stack.pop();  // "world"
```

**Bước 4 – Thêm NTTP: compile-time capacity limit:**

```cpp
// NTTP (Non-Type Template Parameter): N là số kiểu size_t
template<typename T, std::size_t MaxSize = 64>
class BoundedStack {
    std::vector<T> data_;

public:
    void push(const T& val) {
        if (data_.size() >= MaxSize) {
            throw std::overflow_error("BoundedStack: capacity exceeded");
        }
        data_.push_back(val);
    }
    // ... các method khác giống Stack<T>

    static constexpr std::size_t capacity() { return MaxSize; }
};

BoundedStack<int, 8>  small_stack;   // tối đa 8 phần tử
BoundedStack<float>   big_stack;     // tối đa 64 phần tử (default)

// MaxSize là compile-time constant → có thể static_assert
static_assert(BoundedStack<int, 8>::capacity() == 8);
```

---

## 6. Non-Type Template Parameters (NTTP) sâu hơn

NTTP cho phép truyền **giá trị** (không phải kiểu) vào template tại compile-time.

### 6.1 Các loại NTTP hợp lệ

```cpp
// NTTP có thể là:
template<int N>              struct A {};  // integer
template<std::size_t N>      struct B {};  // unsigned integer
template<bool Flag>          struct C {};  // boolean
template<char C>             struct D {};  // character
template<auto Val>           struct E {};  // C++17: bất kỳ NTTP literal type
template<const char* Str>    struct F {};  // pointer to string literal (C++20)
```

### 6.2 Ứng dụng thực tế: Bitmask flags tại compile-time

```cpp
// Ví dụ trong automotive: DTC status byte là bitmask
// Dùng NTTP để tạo named flag accessors
template<std::uint8_t BitPosition>
struct DtcFlag {
    static_assert(BitPosition < 8, "Bit position must be 0-7");

    static constexpr std::uint8_t MASK = (1u << BitPosition);

    static bool get(std::uint8_t status_byte) {
        return (status_byte & MASK) != 0;
    }
    static std::uint8_t set(std::uint8_t status_byte, bool val) {
        return val ? (status_byte | MASK) : (status_byte & ~MASK);
    }
};

// Named flags với NTTP – zero overhead, tên mô tả
using TestFailed    = DtcFlag<0>;  // bit 0
using TestPassed    = DtcFlag<1>;  // bit 1
using PendingDTC    = DtcFlag<2>;  // bit 2
using ConfirmedDTC  = DtcFlag<3>;  // bit 3

std::uint8_t status = 0b00001001;  // bit 0 và 3 = 1
TestFailed::get(status);    // → true
ConfirmedDTC::get(status);  // → true
PendingDTC::get(status);    // → false
```

---

## 7. Partial Specialization – Tuỳ chỉnh cho một nhóm kiểu

**Partial specialization** khác với explicit specialization: thay vì chỉ định hoàn toàn một kiểu, ta chỉ định **một phần**.

### 7.1 Ví dụ với pointer types

```cpp
// Template chung
template<typename T>
struct Formatter {
    static std::string format(const T& val) {
        std::ostringstream oss;
        oss << val;
        return oss.str();
    }
};

// Partial specialization: chỉ cho T* (bất kỳ pointer nào)
template<typename T>
struct Formatter<T*> {               // ← T* là phần partial spec
    static std::string format(T* ptr) {
        if (!ptr) return "nullptr";
        std::ostringstream oss;
        oss << "0x" << std::hex << reinterpret_cast<std::uintptr_t>(ptr)
            << " → " << Formatter<T>::format(*ptr);  // deref và format giá trị
        return oss.str();
    }
};

int n = 42;
Formatter<int>::format(n);    // "42"
Formatter<int*>::format(&n);  // "0x7ff... → 42"
Formatter<int*>::format(nullptr); // "nullptr"
```

### 7.2 Phân biệt Primary / Partial / Explicit specialization

```cpp
// (1) PRIMARY template – khuôn mẫu gốc
template<typename T, typename U>
struct IsConvertible { static constexpr bool value = false; };

// (2) PARTIAL specialization – khi T == U (một phần của tham số được fix)
template<typename T>
struct IsConvertible<T, T> { static constexpr bool value = true; };

// (3) EXPLICIT specialization – fix hoàn toàn hai tham số
template<>
struct IsConvertible<int, double> { static constexpr bool value = true; };
template<>
struct IsConvertible<double, int> { static constexpr bool value = true; };

// Kết quả:
IsConvertible<int, int>::value;     // (2) → true
IsConvertible<int, double>::value;  // (3) → true
IsConvertible<int, char*>::value;   // (1) → false
```

---

## 8. Template Template Parameters – Template nhận Template

Đây là tính năng nâng cao: truyền **một template** vào template khác như tham số.

```cpp
// Container là một template, không phải kiểu cụ thể
// Cú pháp: template<typename...> class Container
template<template<typename...> class Container, typename T>
class TypedStore {
    Container<T> data_;   // Tạo Container<T> cụ thể từ template + type

public:
    void add(T val) {
        data_.push_back(std::move(val));
    }
    std::size_t size() const { return data_.size(); }
    const T& get(std::size_t i) const { return data_[i]; }
};

// Sử dụng – truyền std::vector, std::deque như là template:
TypedStore<std::vector, int>       vec_store;   // data_ = std::vector<int>
TypedStore<std::deque,  double>    deq_store;   // data_ = std::deque<double>
TypedStore<std::list,   std::string> lst_store; // data_ = std::list<std::string>
```

**Khi nào dùng:** Khi muốn cho phép người dùng quyết định container backing store, nhưng vẫn muốn wrap logic chung.

---

## 9. Trình tự tìm kiếm của Compiler – Hiểu để tránh lỗi

Khi compiler thấy một function call như `foo(val)`, nó tìm kiếm theo thứ tự:

```
1. Exact match (hàm không phải template với đúng signature)
        ↓ (không tìm thấy)
2. Template instantiation (compiler thử sinh ra code từ template)
        ↓ (không hợp lệ → SFINAE: không phải lỗi, tiếp tục)
3. Implicit conversion + non-template
        ↓
4. Nếu tất cả đều thất bại → LỖI COMPILER
```

**Ví dụ minh hoạ:**

```cpp
template<typename T>
void process(T val) {
    std::cout << "Template version: " << val << '\n';
}

// Non-template overload
void process(int val) {
    std::cout << "Non-template int version: " << val << '\n';
}

process(42);     // → "Non-template int version" (exact match ưu tiên)
process(42.0);   // → "Template version: 42"   (T=double)
process<int>(42); // → "Template version: 42"  (rõ ràng yêu cầu template)
```

---

## 10. Lỗi thường gặp và Cách khắc phục

### Lỗi 1: Gọi template với kiểu không hỗ trợ operator

```cpp
template<typename T>
T max_val(T a, T b) {
    return (a > b) ? a : b;  // Yêu cầu operator>
}

struct Point { int x, y; };
Point p1{1, 2}, p2{3, 4};

// max_val(p1, p2);
// COMPILER ERROR: no match for 'operator>' (phức tạp, khó đọc)
```

**Khắc phục:** Thêm Concept để lỗi rõ ràng hơn:

```cpp
// C++20: std::totally_ordered yêu cầu >, <, >=, <=, ==, !=
template<std::totally_ordered T>
T max_val(T a, T b) { return (a > b) ? a : b; }

// max_val(p1, p2);
// COMPILER ERROR: "Point does not satisfy totally_ordered" — rõ hơn nhiều!
```

---

### Lỗi 2: Template definition phải nằm trong header

```cpp
// SALAÌ: không làm thế này!
// math_utils.h
template<typename T>
T square(T x);          // chỉ declaration

// math_utils.cpp
template<typename T>
T square(T x) { return x * x; }   // definition trong .cpp
```

**Vấn đề:** Compiler cần thấy **toàn bộ template definition** khi instantiate. Nếu definition nằm trong `.cpp`, các translation unit khác không thấy → linker error `undefined reference`.

**Khắc phục:** Luôn đặt template **definition** trong header (`.h` hoặc `.hpp`):

```cpp
// math_utils.h – đặt DEFINITION ở đây
template<typename T>
T square(T x) { return x * x; }  // ✓ compile được từ mọi nơi
```

---

### Lỗi 3: Template argument deduction thất bại với mixed types

```cpp
template<typename T>
T add(T a, T b) { return a + b; }

add(1, 2.0);
// ERROR: deduced conflicting types for T: int vs double
```

**Khắc phục – Cách 1:** Chỉ định T rõ:

```cpp
add<double>(1, 2.0);  // T = double, 1 được convert sang double
```

**Khắc phục – Cách 2:** Dùng hai type parameters:

```cpp
template<typename T, typename U>
auto add(T a, U b) -> decltype(a + b) {
    return a + b;
}

add(1, 2.0);   // T=int, U=double, return type = double
```

**Khắc phục – Cách 3 (C++14+):** Dùng `auto` return type:

```cpp
template<typename T, typename U>
auto add(T a, U b) {
    return a + b;  // compiler suy luận return type từ a+b
}
```

---

### Lỗi 4: Phụ thuộc tên trong template (typename keyword)

```cpp
template<typename Container>
std::size_t get_first_size(const Container& c) {
    // Container::iterator là "dependent name" (phụ thuộc vào T)
    // Cần "typename" để nói với compiler đây là type, không phải static member
    Container::iterator it = c.begin();   // ERROR!
    typename Container::iterator it = c.begin();  // ✓
    return it->size();
}
```

**Quy tắc:** Khi access một type member (`::SomeType`) từ template parameter, phải thêm `typename` trước.

---

## 11. Mini Project – Generic Result Type

Áp dụng tất cả kiến thức trên để xây dựng `Result<T, E>` – một kiểu giống `std::expected` (C++23) nhưng đơn giản hơn.

### Yêu cầu:
- `Result<T, E>` chứa một trong hai: giá trị `T` hoặc lỗi `E`
- `Result::ok(val)` – tạo kết quả thành công
- `Result::err(error)` – tạo kết quả lỗi
- `has_value()` – kiểm tra
- `value()` – lấy giá trị (throw nếu là lỗi)
- `error()` – lấy lỗi (throw nếu là thành công)
- Hỗ trợ `operator*` và `operator->` như smart pointer

### Triển khai từng bước:

```cpp
#include <variant>
#include <stdexcept>
#include <string>

// Bước 1: Dùng std::variant để lưu T hoặc E
template<typename T, typename E = std::string>
class Result {
    // std::variant<T, E> lưu một trong hai, tại run-time biết loại nào đang được lưu
    std::variant<T, E> data_;

    // Private constructors – chỉ dùng static factories
    explicit Result(T&& val) : data_(std::forward<T>(val)) {}
    explicit Result(E&& err, bool) : data_(std::forward<E>(err)) {}
    // bool param thứ hai chỉ để phân biệt hai constructor

public:
    // ---- Factory methods ----
    static Result ok(T val) {
        return Result(std::move(val));
    }
    static Result err(E error) {
        return Result(std::move(error), false);
    }

    // ---- Query ----
    bool has_value() const noexcept {
        return std::holds_alternative<T>(data_);
    }
    explicit operator bool() const noexcept { return has_value(); }

    // ---- Access ----
    const T& value() const {
        if (!has_value()) {
            throw std::runtime_error("Result::value() called on error result");
        }
        return std::get<T>(data_);
    }

    T& value() {
        if (!has_value()) {
            throw std::runtime_error("Result::value() called on error result");
        }
        return std::get<T>(data_);
    }

    const E& error() const {
        if (has_value()) {
            throw std::runtime_error("Result::error() called on success result");
        }
        return std::get<E>(data_);
    }

    // ---- Smart pointer style ----
    const T& operator*()  const { return value(); }
    T&       operator*()        { return value(); }
    const T* operator->() const { return &value(); }
    T*       operator->()       { return &value(); }

    // ---- Monadic operations (C++23 style) ----
    // map: transform T → U nếu có value, giữ nguyên error
    template<typename F>
    auto map(F&& f) const -> Result<std::invoke_result_t<F, const T&>, E> {
        using U = std::invoke_result_t<F, const T&>;
        if (has_value()) {
            return Result<U, E>::ok(f(value()));
        }
        return Result<U, E>::err(error());
    }
};
```

### Cách dùng và kiểm tra:

```cpp
// Hàm đọc file – trả Result thay vì throw exception
Result<std::string> read_file(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) {
        return Result<std::string>::err("Cannot open: " + path);
    }
    std::string content((std::istreambuf_iterator<char>(f)),
                          std::istreambuf_iterator<char>());
    return Result<std::string>::ok(std::move(content));
}

// Sử dụng
auto res = read_file("config.json");

if (res) {                          // operator bool
    std::cout << "Content:\n" << *res << '\n';  // operator*
} else {
    std::cerr << "Error: " << res.error() << '\n';
}

// Monadic chaining: map chỉ chạy nếu có value
auto upper = read_file("data.txt")
    .map([](const std::string& s) {
        std::string result = s;
        std::transform(result.begin(), result.end(),
                       result.begin(), ::toupper);
        return result;
    });
```

---

## 12. Bài tập tổng hợp

### Bài 1 – Generic Pair
Implement `Pair<A, B>` tương tự `std::pair`:
- Constructor `Pair(A a, B b)`
- `first()`, `second()` getter
- Hàm helper `make_pair(a, b)` dùng CTAD (C++17 deduction guide)
- Partial specialization `Pair<T, T>` thêm method `are_equal() const`

### Bài 2 – Compile-time Fibonacci
Viết `constexpr` function và class template tính số Fibonacci tại compile-time:
```cpp
static_assert(Fibonacci<10>::value == 55);
static_assert(fib(10) == 55);  // constexpr function version
```

### Bài 3 – Type List
Implement `TypeList<T1, T2, ..., Tn>` với:
- `TypeList<int, double, char>::size` = 3 (constexpr)
- `TypeAt<1, TypeList<int, double, char>>::type` = `double`
- `Contains<double, TypeList<int, double, char>>::value` = true

### Bài 4 – Mở rộng Result: `and_then`
Thêm method `and_then` vào `Result<T, E>`:
```cpp
// and_then: F nhận T, trả về Result<U, E> – cho phép chain nhiều bước
auto final_result = parse_int("42")          // Result<int>
    .and_then([](int n) -> Result<double> {
        if (n < 0) return Result<double>::err("negative");
        return Result<double>::ok(std::sqrt(n));
    })
    .map([](double d) { return std::to_string(d); }); // Result<string>
```

---

## Tóm tắt – Những điều cần nhớ

| Khái niệm | Trọng tâm | Cạm bẫy |
|---|---|---|
| **Function template** | Compiler suy luận T từ argument | Mixed types gây ambiguous deduction |
| **Class template** | Khuôn mẫu cho struct/class | Definition phải ở trong header |
| **NTTP** | Giá trị tại compile-time | Chỉ hỗ trợ integral, pointer, floating-point |
| **Specialization** | Tuỳ chỉnh cho kiểu cụ thể | Partial > Explicit trong độ ưu tiên |
| **Dependent name** | Access `Container::type` | Phải thêm `typename` |
| **Two-phase lookup** | Compiler parse template 2 lần | Tên trong template phải khai báo trước |

**Phần tiếp theo →** [Templates nâng cao: SFINAE & Concepts C++20](/adaptive-cpp/cpp-templates/)
