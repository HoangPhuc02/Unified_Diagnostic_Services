---
layout: default
title: "Advanced C++ – Phần 2: Memory Management & RAII"
nav_exclude: true
module: true
category: adaptive_cpp
tags: [cpp, memory, raii, smart-pointers, allocator, memory-model, placement-new]
description: "Quản lý bộ nhớ nâng cao trong C++: RAII, smart pointers sâu, custom allocator, memory model, và ứng dụng trong AUTOSAR Adaptive Platform."
permalink: /cpp-memory/
---

# Advanced C++ – Phần 2: Memory Management & RAII

> **Mục tiêu bài này:** Bạn sẽ nắm vững cách bộ nhớ hoạt động trong C++, biết dùng RAII để không bao giờ leak resource, hiểu smart pointer từ bên trong, và biết cách quản lý bộ nhớ hoàn toàn không dùng heap (critical cho embedded/AUTOSAR).  
> **Yêu cầu trước:** Nắm vững C++ Templates.  
> **Compiler:** GCC ≥ 11, Clang ≥ 12 với `-std=c++20`

---

## Toàn cảnh bộ nhớ trong C++

Trước khi đi vào kỹ thuật, cần hiểu **3 vùng bộ nhớ** quan trọng:

```
┌─────────────────────────────────────────────────────────┐
│                    Process Address Space                 │
├────────────┬────────────┬──────────────┬────────────────┤
│   Stack    │    BSS     │    Heap       │  Code/Text     │
│  (local    │  (global   │ (new/malloc) │  (executable)  │
│  vars)     │  zero-init)│               │                │
├────────────┴────────────┴──────────────┴────────────────┤
│ Tự động    │ Compile-   │  Runtime      │  Read-only     │
│ grow/shrink│ time size  │  grow/shrink  │                │
│ Rất nhanh  │ Nhanh      │  Chậm hơn     │                │
│ Limited    │ Persistent │  Unlimited*   │                │
└─────────────────────────────────────────────────────────┘
```

**Vấn đề trong Automotive/Embedded:**
- Heap có thể **fragment** theo thời gian → `new` fail sau 100 giờ chạy
- `new` và `delete` không có **bounded time guarantee** → không dùng được trong safety path
- Giải pháp: cấp phát trước (pre-allocate), dùng pool, arena, và stack storage

---

## 1. RAII – Resource Acquisition Is Initialization

### Vấn đề RAII giải quyết

Hãy xem đoạn code **không dùng RAII**:

```cpp
// BAD CODE – Dễ leak resource
void process_file(const char* path) {
    FILE* f = std::fopen(path, "r");
    if (!f) throw std::runtime_error("cannot open");

    auto data = read_data(f);    // <<< nếu hàm này throw exception...
    process(data);               // <<< ...hay hàm này throw...

    std::fclose(f);              // ...thì dòng này KHÔNG BAO GIỜ ĐƯỢC CHẠY
    // File descriptor bị leak!
}
```

Vấn đề: code cleanup (`fclose`) bị bỏ qua khi có exception. Phải viết `try/catch` ở khắp nơi.

**RAII** giải quyết bằng cách đặt cleanup vào **destructor**. Destructor **luôn luôn** được gọi khi object ra khỏi scope – dù là bình thường hay vì exception.

```
Object sống trên stack:

{                              ← object được tạo (constructor chạy → acquire resource)
    ScopeGuard guard(...);
    
    throw_something();         ← ngay cả khi exception xảy ra...
    
}                              ← ...destructor VẪN ĐƯỢC GỌI (release resource)
```

---

### 1.1 ScopeGuard – RAII wrapper tổng quát

```cpp
// ScopeGuard nhận bất kỳ "cleanup function" nào và gọi nó khi ra khỏi scope
// Template: Cleanup = kiểu của lambda/function

template<typename Cleanup>
class ScopeGuard {
    Cleanup fn_;          // lưu cleanup function (lambda, function pointer, ...)
    bool    active_;      // false = đã "dismiss" nghĩa là không cần cleanup nữa

public:
    // Constructor: nhận cleanup function, đặt active = true
    explicit ScopeGuard(Cleanup fn) : fn_(std::move(fn)), active_{true} {}

    // Destructor: nếu vẫn active, thực hiện cleanup
    // noexcept vì destructor không được throw exception
    ~ScopeGuard() {
        if (active_) fn_();  // GỌI CLEANUP – luôn chạy trừ khi dismiss()
    }

    // Không cho copy – chỉ một ScopeGuard chịu trách nhiệm một resource
    ScopeGuard(const ScopeGuard&) = delete;
    ScopeGuard& operator=(const ScopeGuard&) = delete;

    // dismiss(): dùng khi ta MUỐN bỏ qua cleanup
    // Ví dụ: commit transaction thành công → không cần rollback
    void dismiss() noexcept { active_ = false; }
};

// Deduction guide (C++17): cho phép ScopeGuard g([]{...}) mà không cần chỉ rõ T
template<typename F>
ScopeGuard(F) -> ScopeGuard<F>;
```

**Sử dụng thực tế:**

```cpp
void open_and_process(const char* path) {
    FILE* f = std::fopen(path, "r");
    if (!f) throw std::runtime_error("cannot open file");

    // Tạo guard NGAY SAU KHI acquire resource
    ScopeGuard guard([f]{ std::fclose(f); });
    //                ↑ lambda capture f để biết cần close cái gì

    auto data = read_data(f);    // nếu throw → guard.~ScopeGuard() → fclose(f)
    process(data);               // nếu throw → guard.~ScopeGuard() → fclose(f)

    // Đến đây là thành công – fclose sẽ được gọi khi } kết thúc
    // (không cần dismiss() trừ khi muốn "keep file open")
}
// guard.~ScopeGuard() chạy → std::fclose(f) → không leak
```

> **💡 Điểm mấu chốt:** RAII chuyển trách nhiệm cleanup từ "nhớ gọi fclose" sang "destructor tự gọi". Destructor luôn chạy → không bao giờ leak.

> **⚠️ Lưu ý:** Đặt ScopeGuard NGAY SAU khi acquire resource. Nếu có code giữa `fopen` và `ScopeGuard`, exception trong đó sẽ vẫn leak.

---

### 1.2 RAII cho Mutex Lock

```cpp
// SpinLock: thay vì đợi OS signal (như mutex), liên tục "nhìn" flag
// Phù hợp cho critical section rất ngắn (<100ns) vì không có context switch

class SpinLockGuard {
    std::atomic_flag& flag_;   // reference đến flag (không sở hữu)

public:
    explicit SpinLockGuard(std::atomic_flag& f) : flag_(f) {
        // Spin cho đến khi grab lock
        // test_and_set: atomically set flag và return giá trị CŨ
        // Nếu old value = false → ta grab được lock → thoát loop
        // Nếu old value = true  → ai đó đang hold lock → tiếp tục spin
        while (flag_.test_and_set(std::memory_order_acquire)) {
            // __builtin_ia32_pause(): KHÔNG là sleep, là CPU hint
            // Nói CPU biết "ta đang spin-wait", CPU giảm power consumption
            // và tránh messing up branch predictor
#if defined(__x86_64__)
            __builtin_ia32_pause();
#elif defined(__aarch64__)
            asm volatile("yield");  // ARM equivalent
#endif
        }
        // Khi thoát while: flag_ = true (ta hold lock), memory_order_acquire
        // đảm bảo tất cả writes của thread trước (khi release) đều VISIBLE với ta
    }

    ~SpinLockGuard() noexcept {
        // clear = atomically set flag về false = release lock
        // memory_order_release: đảm bảo tất cả writes của ta visible với thread tiếp theo
        flag_.clear(std::memory_order_release);
    }

    SpinLockGuard(const SpinLockGuard&) = delete;
    SpinLockGuard& operator=(const SpinLockGuard&) = delete;
};

// Cách dùng:
std::atomic_flag state_lock = ATOMIC_FLAG_INIT;  // khởi tạo = cleared (unlocked)
VehicleState     shared_state{};

void update_state(VehicleState new_state) {
    SpinLockGuard g(state_lock);  // constructor: acquire lock
    shared_state = new_state;     // chỉ một thread tại một thời điểm
}                                 // destructor: release lock
```

> **⚠️ Không dùng SpinLock cho critical section dài** – nếu hold lock lâu, tất cả thread khác đang spin → lãng phí CPU. Dùng `std::mutex` cho trường hợp đó.

---

## 2. Smart Pointers – Hiểu từ bên trong

### Tại sao cần smart pointer?

```cpp
// TRƯỜNG HỢP BAD: manual memory management
DiagSession* session = new DiagSession(session_id);

if (early_exit_condition) {
    return;  // LEAK! session không được delete
}

process(session);  // nếu throw: session không được delete

delete session;    // chỉ được chạy khi mọi thứ OK
```

Smart pointer áp dụng RAII cho heap memory: **destructor tự gọi delete**.

---

### 2.1 `unique_ptr` – ownership duy nhất

```
  unique_ptr<T>
  ┌──────────┐
  │  ptr_ ───┼──→  [T object trên heap]
  └──────────┘
  Chỉ một unique_ptr trỏ đến object
  Khi unique_ptr destroyed → delete object
  Không thể copy (vì chỉ một owner), chỉ move
```

```cpp
// Custom deleter – dùng khi "cleanup" không phải là delete
// Ví dụ: file descriptor cần đóng bằng ::close(), không phải delete

struct FdDeleter {
    // operator(): được gọi như hàm khi unique_ptr destroyed
    // nhận "pointer" (ở đây là int* lưu fd value)
    void operator()(int* fd) const noexcept {
        if (fd && *fd >= 0) {
            ::close(*fd);  // đóng fd ở OS level
        }
        delete fd;  // giải phóng bộ nhớ của int object
    }
};

// unique_ptr<int, FdDeleter>: khi destroyed, gọi FdDeleter::operator()(ptr)
using UniqueFd = std::unique_ptr<int, FdDeleter>;

UniqueFd open_doip_socket(const char* host_ip, std::uint16_t port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return nullptr;  // unique_ptr với nullptr: không deleter được gọi

    // ... thiết lập kết nối ...
    // sockaddr_in addr; connect(fd, ...);

    return UniqueFd(new int(fd));  // trả về unique ownership của fd
}

// Cách dùng:
auto sock = open_doip_socket("192.168.1.10", 13400);
if (sock) {
    // sử dụng *sock là fd value
    write(*sock, data, len);
}
// khi sock ra khỏi scope → FdDeleter::operator()(*sock) → ::close(fd), delete fd
```

---

### 2.2 `shared_ptr` – Hiểu control block

```
  shared_ptr<T>              shared_ptr<T>
  (copy 1)                   (copy 2)
  ┌────────────┐             ┌────────────┐
  │  ptr_  ────┼──┐     ┌───┼──  ptr_    │
  │  ctrl_ ────┼──┼─────┼───┼──  ctrl_   │
  └────────────┘  │     │   └────────────┘
                  ▼     ▼
             [T object]  [Control Block]
                         ┌──────────────┐
                         │ ref_count = 2│ ← 2 shared_ptr trỏ đến
                         │ weak_count= 0│
                         │ deleter      │
                         └──────────────┘
  Khi ref_count = 0 → T object bị delete
  Khi weak_count = 0 → Control Block bị delete
```

```cpp
// BAD: 2 allocation (object + control block riêng)
auto s1 = std::shared_ptr<DiagSession>(new DiagSession(1));
//        ↑ 1 heap alloc cho DiagSession, 1 heap alloc cho control block

// GOOD: make_shared = 1 allocation (gộp object + control block)
auto s2 = std::make_shared<DiagSession>(1);
// 1 heap alloc: [DiagSession data | ref_count | weak_count | deleter]
// Tiết kiệm 1 allocation + locality tốt hơn (cùng cache line)
```

```cpp
// weak_ptr: "quan sát" mà không "sở hữu"
// Không tăng ref_count → không giữ object alive

class ServiceRegistry {
    std::vector<std::weak_ptr<DiagSession>> sessions_;
    // Dùng weak_ptr vì registry không "own" session
    // Session tồn tại khi client code hold shared_ptr đến nó

public:
    void register_session(std::shared_ptr<DiagSession> session) {
        sessions_.push_back(session);  // weak_ptr: ref_count KHÔNG tăng
    }

    void cleanup_expired() {
        // expired(): true nếu object đã bị delete (ref_count đã về 0)
        std::erase_if(sessions_, [](const auto& wp) {
            return wp.expired();  // loại bỏ weak_ptr đến object đã chết
        });
    }

    void broadcast_message(const std::string& msg) {
        for (auto& wp : sessions_) {
            // lock(): tăng ref_count và trả shared_ptr
            // Nếu object còn sống: trả shared_ptr hợp lệ
            // Nếu object đã chết: trả nullptr
            // Thread-safe: không có race giữa "check alive" và "use"
            if (auto sp = wp.lock()) {
                sp->send_message(msg);  // sử dụng an toàn
            }
            // sp ra scope → ref_count giảm. Nếu ai đó delete session
            // trong khi ta dùng sp: object sẽ chỉ bị delete SAU KHI sp ra scope
        }
    }
};
```

---

### 2.3 `enable_shared_from_this` – tạo `shared_ptr` từ `this`

```cpp
// VẤN ĐỀ: muốn truyền shared_ptr của this vào callback async
class DiagSession {
    void start_timeout() {
        // BAD: std::shared_ptr<DiagSession>(this)
        // Tạo shared_ptr MỚI với control block MỚI → khi nó destroyed, xóa this
        // Nhưng ai đó khác có shared_ptr với control block khác cũng sẽ xóa this
        // → DOUBLE DELETE = undefined behavior
    }
};
```

```cpp
// GIẢI PHÁP: kế thừa enable_shared_from_this
// Nó lưu weak_ptr<DiagSession> trong object, shared_from_this() dùng weak_ptr đó
// → shared_from_this() trả shared_ptr dùng CÙNG control block với original

class DiagSession : public std::enable_shared_from_this<DiagSession> {
    std::uint32_t session_id_;

public:
    explicit DiagSession(std::uint32_t id) : session_id_(id) {}

    void start_timeout_timer(std::chrono::milliseconds wait_ms) {
        // shared_from_this() trả shared_ptr đến this, sử dụng existing control block
        // ĐIỀU KIỆN: DiagSession phải đang được quản lý bởi shared_ptr khi gọi
        // (tức là: phải có shared_ptr<DiagSession> tồn tại trước đó)
        auto self = shared_from_this();

        std::thread([self, wait_ms]() {
            // Lambda capture self (shared_ptr) → ref_count tăng
            // → DiagSession KHÔNG thể bị delete trong khi thread này chạy
            std::this_thread::sleep_for(wait_ms);
            if (self->is_still_active()) {  // safe: self còn sống
                self->on_timeout();
            }
        }).detach();
        // self ra ngoài scope của start_timeout_timer, nhưng thread lambda vẫn hold nó
    }

private:
    bool is_still_active() { /* ... */ return true; }
    void on_timeout() { /* ... */ }
};

// Sử dụng đúng:
auto session = std::make_shared<DiagSession>(42);  // phải là shared_ptr
session->start_timeout_timer(std::chrono::seconds(5));
```

> **⚠️ Không gọi `shared_from_this()` trong constructor** – lúc đó chưa có shared_ptr nào quản lý object → throw `std::bad_weak_ptr`.

---

## 3. Memory Layout & Placement New

### 3.1 alignas / alignof – Alignment có ý nghĩa gì?

**Alignment** là yêu cầu địa chỉ memory phải là bội số của một số nhất định. Ví dụ: `int` thường cần align 4 (địa chỉ chia hết cho 4).

```
Memory với int misaligned ở địa chỉ 0x01:
0x00  0x01  0x02  0x03  0x04  0x05
[pad] [B0]  [B1]  [B2]  [B3]  ...
       ↑
  int bắt đầu ở đây (địa chỉ lẻ → CHẬM hoặc crash trên một số CPU)

Memory với int aligned ở địa chỉ 0x04:
0x04  0x05  0x06  0x07
[B0]  [B1]  [B2]  [B3]
 ↑
int bắt đầu ở đây (địa chỉ chia hết cho 4 → NHANH, một lần đọc)
```

```cpp
// alignas(64): đảm bảo struct bắt đầu ở địa chỉ chia hết cho 64
// 64 = kích thước cache line trên x86/ARM
// Mục đích: ngăn "false sharing" giữa các CPU thread

struct alignas(64) ThreadLocalStats {
    std::atomic<std::uint64_t> rx_frames{0};   // 8 bytes
    std::atomic<std::uint64_t> tx_frames{0};   // 8 bytes
    std::atomic<std::uint64_t> errors{0};       // 8 bytes
    std::uint8_t padding[64 - 3*8];            // fill đủ 64 bytes
    // Không có padding: các thread khác nhau có thể có rx/tx trong CÙNG cache line
    // → khi thread 1 write rx_frames, cache line bị invalidated cho thread 2
    // → thread 2 phải reload cache line dù nó chỉ cần tx_frames
    // → FALSE SHARING: hiệu năng giảm nặng trên multi-core
};

// Mỗi element trên cache line riêng → không false sharing
std::array<ThreadLocalStats, 4> per_cpu_stats;
per_cpu_stats[0].rx_frames++;  // CPU 0: cache line 0
per_cpu_stats[1].rx_frames++;  // CPU 1: cache line 1, KHÔNG invalidate cache line 0
```

---

### 3.2 Placement New – Tách biệt "cấp phát memory" và "khởi tạo object"

Bình thường `new T()` làm 2 việc: (1) hỏi OS/heap lấy memory, (2) gọi constructor. Placement new chỉ làm việc (2), sử dụng memory mà ta đã cấp phát.

```
Bình thường:
  new DiagMessage(args...)
       │
  ┌────┴────────────────────┐
  │ 1. malloc/heap alloc    │  ← tốn thời gian, có thể fail
  │ 2. call constructor     │  ← khởi tạo object
  └─────────────────────────┘

Placement new:
  new (pre_allocated_ptr) DiagMessage(args...)
       │
  ┌────┴────────────────────┐
  │ (skip alloc – đã có!)   │
  │ 2. call constructor     │  ← chỉ khởi tạo, không heap alloc
  └─────────────────────────┘
```

```cpp
// ObjectPool: pre-allocate storage cho N objects, không dynamic allocation
template<typename T, std::size_t Capacity>
class ObjectPool {
    // alignas(T): đảm bảo storage aligned đúng cho T
    // std::byte[sizeof(T)*N]: raw bytes, KHÔNG phải T objects
    // (construction xảy ra sau via placement new, không phải ở đây)
    alignas(T) std::byte storage_[sizeof(T) * Capacity];

    // used_: track slot nào đang sử dụng (0 = free, 1 = occupied)
    std::uint8_t used_[Capacity]{};  // zero-initialized

public:
    // acquire: tìm slot trống, construction object tại đó
    template<typename... Args>
    T* acquire(Args&&... args) {
        for (std::size_t i = 0; i < Capacity; ++i) {
            if (!used_[i]) {                     // tìm slot trống
                used_[i] = 1;
                // new (địa_chỉ) T(args...): placement new
                // Gọi T::T(args...) tại địa chỉ &storage_[i * sizeof(T)]
                // Không có heap allocation
                return new (&storage_[i * sizeof(T)])
                           T(std::forward<Args>(args)...);
            }
        }
        return nullptr;  // pool đầy
    }

    // release: gọi destructor explicit rồi đánh dấu slot trống
    void release(T* ptr) noexcept {
        if (!ptr) return;

        // PHẢI gọi destructor explicit khi dùng placement new
        // delete ptr; sẽ SAI vì ptr không trỏ đến heap
        ptr->~T();

        // Tính index của slot
        auto idx = (reinterpret_cast<std::byte*>(ptr) - storage_) / sizeof(T);
        used_[idx] = 0;   // đánh dấu slot trống
    }
};
```

> **⚠️ Quy tắc placement new:** Mọi object được tạo bằng `new (ptr) T()` đều phải được destroy bằng explicit destructor call `ptr->~T()`. **Không** dùng `delete ptr` trên pointer placement-new.

---

## 4. Custom Allocator – Kiểm soát hoàn toàn bộ nhớ

### 4.1 PMR (Polymorphic Memory Resource) – C++17

**Vấn đề truyền thống:** `std::vector<int>` sử dụng global heap. Không thể thay đổi allocator sau khi định nghĩa biến. Với PMR, ta truyền allocator vào **runtime** qua pointer.

```
std::pmr::vector sử dụng:
  ┌──────────────────────────────────────┐
  │ std::pmr::memory_resource* resource_ │ ← pointer đến allocator bất kỳ
  └──────────────────────────────────────┘
        │
        ├── std::pmr::new_delete_resource()  → dùng global heap (default)
        ├── std::pmr::pool_resource()        → pool của PMR
        └── LinearAllocator (custom)         → linear arena của ta
```

```cpp
#include <memory_resource>

// LinearAllocator: allocate từ pre-allocated buffer
// Không có free() → allocation là O(1), không fragment
// Toàn bộ buffer được giải phóng một lần bằng reset()

class LinearAllocator : public std::pmr::memory_resource {
    std::byte*  buf_;        // con trỏ đầu buffer
    std::size_t capacity_;   // tổng kích thước buffer
    std::size_t offset_{0};  // offset hiện tại (tăng dần)

protected:
    // do_allocate: được gọi khi container cần memory
    void* do_allocate(std::size_t bytes, std::size_t align) override {
        // Bước 1: tính địa chỉ aligned tiếp theo
        // (offset_ + align - 1) & ~(align - 1) = round up to multiple of align
        std::size_t aligned_offset = (offset_ + align - 1) & ~(align - 1);

        // Bước 2: kiểm tra có đủ space không
        if (aligned_offset + bytes > capacity_) {
            throw std::bad_alloc();  // hết space trong arena
        }

        // Bước 3: bump offset và trả pointer
        // "Bump allocator" = CHỈ tăng offset, không cần free list
        offset_ = aligned_offset + bytes;
        return buf_ + aligned_offset;
    }

    // do_deallocate: NO-OP vì ta không free từng block
    // Chỉ reset() toàn bộ arena khi xử lý xong
    void do_deallocate(void*, std::size_t, std::size_t) noexcept override {}

    bool do_is_equal(const memory_resource& other) const noexcept override {
        return this == &other;  // hai allocator equal nếu là cùng object
    }

public:
    LinearAllocator(std::byte* buf, std::size_t cap)
        : buf_(buf), capacity_(cap) {}

    // reset: giải phóng TOÀN BỘ arena trong O(1)
    // Chỉ đặt lại offset về 0 – không làm gì với memory
    void reset() noexcept { offset_ = 0; }
};
```

**Sử dụng trong UDS request handler:**

```cpp
void handle_uds_request(const UdsRequest& req) {
    // Arena sống trên stack – không heap allocation
    alignas(std::max_align_t) std::byte arena_buf[4096];
    LinearAllocator arena(arena_buf, sizeof(arena_buf));

    // std::pmr::vector nhận pointer đến allocator
    // Tất cả allocation của vector này dùng arena, không động vào heap
    std::pmr::vector<std::uint8_t> response(&arena);
    std::pmr::string               dtc_info(&arena);
    std::pmr::vector<DtcEntry>     dtc_list(&arena);

    build_response(req, response, dtc_info, dtc_list);
    send_can_response(response);

    // arena.reset() không bắt buộc ở đây vì arena là local variable
    // sẽ tự destroy khi hàm trả về
    // Nhưng nếu muốn reuse buffer: arena.reset()
}
```

> **💡 Điểm mấu chốt:** PMR cho phép code business logic (dùng `std::pmr::vector<T>`) không cần biết memory đến từ đâu – heap, arena, hay pool. Chỉ cần thay thế `memory_resource*` là đổi allocator.

---

### 4.2 STL-compatible Allocator (C++11 style)

Cách cũ hơn nhưng vẫn dùng: cho phép container STL cụ thể dùng custom allocator:

```cpp
template<typename T>
class PoolAllocator {
    static ObjectPool<T, 256> pool_;  // chia sẻ pool cho tất cả PoolAllocator<T>

public:
    using value_type = T;  // bắt buộc cho STL allocator concept

    T* allocate(std::size_t n) {
        if (n != 1) throw std::bad_alloc();  // chỉ hỗ trợ single object
        T* p = pool_.acquire();
        if (!p) throw std::bad_alloc();
        return p;
    }

    void deallocate(T* p, std::size_t) noexcept {
        pool_.release(p);
    }

    // Hai allocator bằng nhau nếu có thể deallocate lẫn nhau
    template<typename U>
    bool operator==(const PoolAllocator<U>&) const noexcept { return false; }
    // (false vì mỗi PoolAllocator<T> có pool riêng)
};

// Dùng với std::list – vì list allocate từng node riêng lẻ (phù hợp với pool)
std::list<DiagMessage, PoolAllocator<DiagMessage>> pending_messages;
// Mỗi push_back → PoolAllocator::allocate(1) → lấy từ pool
// Mỗi removal → PoolAllocator::deallocate(ptr, 1) → trả về pool
```

---

## 5. Move Semantics nâng cao

### 5.1 Perfect Forwarding – Hiểu forwarding reference

```
Bình thường:
  void foo(const T& x)  → copy T
  void foo(T&& x)       → move T (nhưng chỉ nhận rvalue)

Perfect forwarding:
  template<typename T>
  void foo(T&& x)       → nếu caller truyền lvalue: T = int& → T&& = int& (lvalue ref)
                          nếu caller truyền rvalue: T = int  → T&& = int&& (rvalue ref)
  std::forward<T>(x)    → convert về đúng value category
```

```cpp
// Factory function: tạo object với forwarded arguments
// Không copy khi user truyền rvalue, không force-move khi user truyền lvalue
template<typename T, typename... Args>
std::unique_ptr<T> make_diag_object(Args&&... args) {
    // std::forward<Args>(args)...:
    // nếu args[i] là lvalue → forward như lvalue (constructor nhận const ref)
    // nếu args[i] là rvalue → forward như rvalue (constructor nhận rvalue ref → move)
    return std::make_unique<T>(std::forward<Args>(args)...);
}

// Ví dụ:
std::string name = "DiagSession";
auto s1 = make_diag_object<DiagSession>(name, 42);       // name copied (lvalue)
auto s2 = make_diag_object<DiagSession>(std::move(name), 42); // name moved (rvalue)
auto s3 = make_diag_object<DiagSession>("DirectStr", 42);     // temporary moved
```

---

### 5.2 Copy-and-Swap – Idiom an toàn cho assignment

```cpp
class DiagBuffer {
    std::byte*  data_{nullptr};
    std::size_t size_{0};

public:
    DiagBuffer() = default;

    explicit DiagBuffer(std::size_t n)
        : data_(new std::byte[n])  // allocate n bytes
        , size_(n) {}

    ~DiagBuffer() { delete[] data_; }  // luôn deallocate

    // Copy constructor: deep copy
    DiagBuffer(const DiagBuffer& other)
        : DiagBuffer(other.size_)           // delegate constructor: alloc same size
    {
        std::memcpy(data_, other.data_, size_);  // copy bytes
    }

    // Move constructor: "steal" resources từ other
    DiagBuffer(DiagBuffer&& other) noexcept
        : data_(std::exchange(other.data_, nullptr))  // steal pointer, other.data_ = null
        , size_(std::exchange(other.size_, 0))         // steal size, other.size_ = 0
    {}
    // std::exchange(a, b): set a = b, trả về giá trị cũ của a
    // Dùng thay vì: data_ = other.data_; other.data_ = nullptr; (2 lines → 1)

    // Unified assignment operator – nhận tham số BY VALUE (không by ref)
    // Tại sao by value? Vì:
    // - nếu caller copy-assign: other được copy-constructed (gọi copy ctor)
    // - nếu caller move-assign: other được move-constructed (gọi move ctor)
    // Sau đó swap với this, destructor của "other" (local copy) cleanup old data
    DiagBuffer& operator=(DiagBuffer other) noexcept {
        // swap tất cả members với "other"
        std::swap(data_, other.data_);
        std::swap(size_, other.size_);
        return *this;
        // other ra scope → other.~DiagBuffer() → delete[] (old data của this)
        // An toàn kể cả self-assignment: this == &other → swap với chính mình → không đổi
    }
};
```

---

## 6. Memory Model & Lock-Free Programming

### Khái niệm memory ordering

Modern CPU và compiler có thể **reorder** memory operations để tối ưu. Điều này an toàn trong single-thread nhưng tạo ra vấn đề trong multi-thread.

```
Thread 1:                     Thread 2 (có thể thấy theo thứ tự khác):
  data[0] = 42;               while (!ready) {}
  data[1] = 43;               // Thấy ready = true
  ready.store(true);          use(data[0]);  // CÓ THỂ là 0! (chưa visible!)
                              use(data[1]);  // CÓ THỂ là 0! (chưa visible!)
```

`std::memory_order` kiểm soát **visibility đảm bảo** khi dùng atomic:

```
memory_order_relaxed:   không có ordering guarantee, chỉ atomic (không torn read/write)
memory_order_acquire:   tất cả reads/writes TRƯỚC store release đều visible SAU acquire
memory_order_release:   tất cả reads/writes TRƯỚC tôi đều visible với thread acquire
memory_order_seq_cst:   sequential consistent – mạnh nhất, chậm nhất (default)
```

---

### 6.1 Lock-Free SPSC Queue

```cpp
// Single Producer Single Consumer (SPSC) Queue
// Không cần mutex vì chỉ có một writer và một reader
// Dùng acquire/release để đảm bảo data visibility

template<typename T, std::size_t N>
class LockFreeQueue {
    std::array<T, N>          buf_;
    std::atomic<std::size_t>  head_{0};  // consumer đọc từ đây
    std::atomic<std::size_t>  tail_{0};  // producer ghi vào đây

public:
    // push: chỉ PRODUCER gọi (một thread)
    bool push(T val) {
        // relaxed: ta chỉ cần giá trị của tail_ cho logic của ta (không sync với ai)
        std::size_t t = tail_.load(std::memory_order_relaxed);
        std::size_t next = (t + 1) % N;

        // Kiểm tra có full không: acquire vì ta cần thấy giá trị head_ mới nhất
        // (consumer có thể đã advance head_)
        if (next == head_.load(std::memory_order_acquire)) {
            return false;  // full
        }

        buf_[t] = std::move(val);  // ghi data TRƯỚC KHI update tail_

        // release: báo consumer "data tại buf_[t] đã sẵn sàng"
        // consumer dùng acquire trên tail_ sẽ thấy tất cả writes ở trên
        tail_.store(next, std::memory_order_release);
        return true;
    }

    // pop: chỉ CONSUMER gọi (một thread)
    bool pop(T& out) {
        std::size_t h = head_.load(std::memory_order_relaxed);

        // acquire: đảm bảo ta thấy tất cả data producer đã write trước tail_ store
        if (h == tail_.load(std::memory_order_acquire)) {
            return false;  // empty
        }

        out = std::move(buf_[h]);

        // release: báo producer "slot h đã trống, có thể ghi lại"
        head_.store((h + 1) % N, std::memory_order_release);
        return true;
    }
};

// AP: truyền data từ ISR/interrupt sang main processing thread
// ISR không được gọi mutex (có thể chạy trong interrupt context)
LockFreeQueue<CanFrame, 64> isr_to_main;
```

---

### 6.2 Compare-Exchange (CAS) – thay đổi atomic có điều kiện

```cpp
// Atomic max: update chỉ khi val lớn hơn current max
// Cần CAS vì: read-then-write không phải atomic

class LatencyTracker {
    std::atomic<std::uint64_t> max_us_{0};

public:
    void record(std::uint64_t latency_us) noexcept {
        // CAS loop pattern:
        // 1. Load current value
        // 2. Nếu new value tốt hơn, thử swap
        // 3. Nếu CAS fail (ai đó đã thay đổi), reload và thử lại

        std::uint64_t cur = max_us_.load(std::memory_order_relaxed);
        while (latency_us > cur) {
            // compare_exchange_weak:
            //   Nếu max_us_ == cur: set max_us_ = latency_us, trả true → thoát
            //   Nếu max_us_ != cur: set cur = max_us_ hiện tại, trả false → loop lại
            // "_weak" cho phép spurious fail → phải dùng trong loop
            if (max_us_.compare_exchange_weak(
                    cur,                          // expected (update nếu fail)
                    latency_us,                   // desired
                    std::memory_order_relaxed,    // success ordering
                    std::memory_order_relaxed)) { // failure ordering
                break;  // CAS thành công
            }
            // Nếu fail: cur đã được update với giá trị mới từ atomic
            // loop kiểm tra lại latency_us > cur
        }
    }

    std::uint64_t get() const noexcept {
        return max_us_.load(std::memory_order_relaxed);
    }
};
```

---

## 7. Bài tập thực hành

### Bài 1 – UniqueResource (generic RAII)

Implement `UniqueResource<T, D>` tương tự `std::unique_ptr` nhưng cho resource handle bất kỳ (int fd, HANDLE, GLuint, …). Resource không phải pointer:

```cpp
// Cách dùng mong muốn:
UniqueResource<int, FdCloser> fd{open("file.txt", O_RDONLY), FdCloser{}};
// khi fd ra scope → FdCloser{}(fd.get()) được gọi

// Hint: lưu {handle, deleter, is_valid} – không dùng pointer
```

**Yêu cầu:** `get()`, `reset()`, `release()`, move-only, correct noexcept.

---

### Bài 2 – StackAllocator cho STL

Implement `StackAllocator<T, N>` tương thích C++11 STL Allocator:
- Quản lý pre-allocated stack array
- Overflow → throw `std::bad_alloc` (hoặc fallback lên global heap)
- Test: `std::vector<int, StackAllocator<int,128>> v` – verify không dùng heap cho 128 phần tử đầu tiên

---

### Bài 3 – MPSC Lock-Free Queue

Mở rộng `LockFreeQueue` từ mục 6.1 thành **Multi-Producer Single-Consumer** dùng `compare_exchange_strong` cho tail:
- Multiple producer threads gọi `push()` song song
- Một consumer thread gọi `pop()`
- Test: 4 producer threads, 1M operations mỗi thread → consumer đọc đủ 4M items, không mất item nào

---

### Bài 4 – PoolPtr với RAII return

Implement `PoolPtr<T>` – smart pointer trả object về pool khi destroy:

```cpp
ObjectPool<DiagMessage, 32> pool;

{
    auto msg = pool.acquire_unique();  // trả PoolPtr<DiagMessage>
    // ... dùng msg như unique_ptr ...
}  // msg ra scope → tự gọi pool.release(ptr)

// Gợi ý: unique_ptr<T, PoolDeleter<T>> với PoolDeleter lưu pointer về pool
```

---

### Bài 5 – Memory Budget Monitor

Viết `MemoryBudget` theo dõi memory usage của một subsystem:

```cpp
MemoryBudget budget(64 * 1024);  // 64KB budget
void* p = budget.allocate(1024); // OK
budget.deallocate(p, 1024);      // trả lại
budget.allocate(65 * 1024);      // throw std::bad_alloc (vượt budget)
budget.usage();                  // hiện đang dùng bao nhiêu bytes
```

**AP Context:** Mỗi Adaptive Application có memory budget. `MemoryBudget` có thể wrapper trên top của `std::pmr::memory_resource` để enforce limit.

---

## Tóm tắt – Khi nào dùng kỹ thuật nào?

| Kỹ thuật | Vấn đề giải quyết | AP Application |
|---|---|---|
| **ScopeGuard** | Cleanup bất kỳ resource khi scope exit | FD, lock, timer, transaction |
| **SpinLockGuard** | Mutex RAII cho critical section ngắn | ISR shared data |
| **unique_ptr + custom deleter** | OS resource ownership | Socket, FD, mmap, GPU buffer |
| **shared_ptr / weak_ptr** | Shared + observer ownership | Session objects, registry |
| **enable_shared_from_this** | this → shared_ptr safely | Async callback lifetime |
| **ObjectPool + placement new** | Zero heap alloc hot path | PDU, DiagMessage pool |
| **LinearAllocator (PMR)** | Per-request scratch, no fragment | UDS request arena |
| **STL Allocator** | Per-container pool | `std::list` với custom pool |
| **Perfect forwarding** | Factory không copy khi không cần | `make_diag_object<T>(...)` |
| **Copy-and-swap** | Exception-safe assignment | Buffer, string-like types |
| **SPSC LockFreeQueue** | ISR → thread data (no mutex) | CAN frames, sensor data |
| **CAS pattern** | Atomic update với điều kiện | Max latency tracker |

**← Phần trước:** [C++ Nâng cao Phần 1: Templates & Concepts](/cpp-templates/)  
**Phần tiếp →:** [C++ Nâng cao Phần 3: Concurrency & Async](/cpp-concurrency/)

```cpp
// Generic RAII guard – wrap bất kỳ cleanup function
template<typename Cleanup>
class ScopeGuard {
    Cleanup fn_;
    bool    active_{true};
public:
    explicit ScopeGuard(Cleanup fn) : fn_(std::move(fn)) {}
    ~ScopeGuard() { if (active_) fn_(); }

    // Không thể copy; có thể dismiss để huỷ cleanup
    ScopeGuard(const ScopeGuard&) = delete;
    ScopeGuard& operator=(const ScopeGuard&) = delete;
    void dismiss() noexcept { active_ = false; }
};

// Deduction guide (C++17)
template<typename F>
ScopeGuard(F) -> ScopeGuard<F>;

// Ví dụ
void open_file_and_process(const char* path) {
    FILE* f = std::fopen(path, "r");
    if (!f) throw std::runtime_error("cannot open");

    ScopeGuard guard([f]{ std::fclose(f); });  // đảm bảo fclose dù exception

    // ... xử lý ...
    // guard tự gọi fclose khi ra khỏi scope
}
```

### 1.2 RAII cho mutex lock

```cpp
// std::lock_guard là RAII – nhưng đây là custom fine-grained version
class SpinLockGuard {
    std::atomic_flag& flag_;
public:
    explicit SpinLockGuard(std::atomic_flag& f) : flag_(f) {
        while (flag_.test_and_set(std::memory_order_acquire)) {
            // pause hint – giảm power consumption khi spin
#if defined(__x86_64__)
            __builtin_ia32_pause();
#endif
        }
    }
    ~SpinLockGuard() noexcept {
        flag_.clear(std::memory_order_release);
    }
    SpinLockGuard(const SpinLockGuard&) = delete;
    SpinLockGuard& operator=(const SpinLockGuard&) = delete;
};

// AP context: bảo vệ shared state giữa ara::com callback và main thread
std::atomic_flag state_lock = ATOMIC_FLAG_INIT;
VehicleState     shared_state{};

void update_state(VehicleState new_state) {
    SpinLockGuard g(state_lock);
    shared_state = new_state;
}
```

---

## 2. Smart Pointers – Sâu hơn std

### 2.1 unique_ptr với custom deleter

```cpp
// Custom deleter – dùng cho OS resource (file descriptor, socket)
struct FdDeleter {
    void operator()(int* fd) const noexcept {
        if (fd && *fd >= 0) {
            ::close(*fd);
        }
        delete fd;
    }
};

using UniqueFd = std::unique_ptr<int, FdDeleter>;

UniqueFd open_socket(const char* addr, std::uint16_t port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return nullptr;
    // ... connect ...
    return UniqueFd(new int(fd));
}

// AP Context: DoIP socket lifetime tied to UniqueFd
auto doip_sock = open_socket("192.168.1.10", 13400);
// socket tự close khi doip_sock ra khỏi scope
```

### 2.2 shared_ptr internals & weak_ptr

```cpp
// shared_ptr dùng control block – có thể dùng make_shared để gộp allocation
struct SomeipServiceEntry {
    std::string service_name;
    std::uint16_t instance_id;
};

// BAD: 2 heap allocations (object + control block)
auto e1 = std::shared_ptr<SomeipServiceEntry>(new SomeipServiceEntry{"Diag", 0x01});

// GOOD: 1 heap allocation (gộp)
auto e2 = std::make_shared<SomeipServiceEntry>(SomeipServiceEntry{"Diag", 0x01});

// weak_ptr: observer không gia hạn lifetime
class ServiceRegistry {
    std::vector<std::weak_ptr<SomeipServiceEntry>> entries_;
public:
    void add(std::shared_ptr<SomeipServiceEntry> e) {
        entries_.push_back(e);   // không tăng ref count
    }
    void cleanup_stale() {
        std::erase_if(entries_, [](const auto& wp) { return wp.expired(); });
    }
    void visit_all(auto fn) {
        for (auto& wp : entries_) {
            if (auto sp = wp.lock()) {  // thread-safe upgrade
                fn(*sp);
            }
        }
    }
};
```

### 2.3 enable_shared_from_this

```cpp
// Vấn đề: object cần tạo shared_ptr từ `this` an toàn
class DiagSession : public std::enable_shared_from_this<DiagSession> {
    std::uint32_t session_id_;
public:
    explicit DiagSession(std::uint32_t id) : session_id_(id) {}

    // WRONG: std::shared_ptr<DiagSession>(this) – double delete!
    // CORRECT:
    std::shared_ptr<DiagSession> get_self() {
        return shared_from_this();
    }

    // AP: lưu self vào async callback để đảm bảo lifetime
    void start_timeout_timer(std::chrono::milliseconds timeout) {
        auto self = shared_from_this();         // capture shared ownership
        timer_.async_wait([self](auto ec) {     // self giữ session alive
            if (!ec) self->on_timeout();
        });
    }

private:
    void on_timeout();
    AsyncTimer timer_;
};
```

---

## 3. Memory Layout & Alignment

### 3.1 alignas / alignof

```cpp
// Đảm bảo struct aligned đúng cho SIMD hoặc DMA
struct alignas(64) CacheLinePadded {      // 1 cache line = 64 bytes
    std::atomic<std::uint64_t> counter;
    std::uint8_t padding[56];             // fill to 64 bytes
};

// AP context: tránh false sharing giữa các thread
struct alignas(64) ThreadLocalStats {
    std::uint64_t rx_count{0};
    std::uint64_t tx_count{0};
};

std::array<ThreadLocalStats, 4> per_thread_stats;
// mỗi instance trên cache line riêng – không false sharing
```

### 3.2 Placement new & manual lifecycle

```cpp
// Object pool – tránh heap allocation trong hot path
template<typename T, std::size_t Capacity>
class ObjectPool {
    alignas(T) std::byte storage_[sizeof(T) * Capacity];
    std::uint8_t          used_[Capacity]{};    // 0 = free

public:
    template<typename... Args>
    T* acquire(Args&&... args) {
        for (std::size_t i = 0; i < Capacity; ++i) {
            if (!used_[i]) {
                used_[i] = 1;
                return new (&storage_[i * sizeof(T)])    // placement new
                           T(std::forward<Args>(args)...);
            }
        }
        return nullptr;  // pool exhausted
    }

    void release(T* ptr) noexcept {
        ptr->~T();        // explicit destructor – MUST call with placement new
        auto idx = (reinterpret_cast<std::byte*>(ptr) - storage_) / sizeof(T);
        used_[idx] = 0;
    }
};

// AP context: pool cho DoIP diagnostic message objects
ObjectPool<DiagMessage, 32> diag_msg_pool;

auto* msg = diag_msg_pool.acquire(src_addr, dst_addr, payload);
// ... process ...
diag_msg_pool.release(msg);
```

---

## 4. Custom Allocator

### 4.1 PMR – Polymorphic Memory Resource (C++17)

```cpp
#include <memory_resource>

// LinearAllocator: allocate từ pre-allocated buffer, O(1), không fragment
class LinearAllocator : public std::pmr::memory_resource {
    std::byte*  buf_;
    std::size_t capacity_;
    std::size_t offset_{0};

protected:
    void* do_allocate(std::size_t bytes, std::size_t align) override {
        // align offset
        std::size_t aligned = (offset_ + align - 1) & ~(align - 1);
        if (aligned + bytes > capacity_) {
            throw std::bad_alloc();
        }
        offset_ = aligned + bytes;
        return buf_ + aligned;
    }
    void do_deallocate(void*, std::size_t, std::size_t) noexcept override {
        // no-op: liên tục – chỉ reset toàn bộ
    }
    bool do_is_equal(const memory_resource& other) const noexcept override {
        return this == &other;
    }

public:
    LinearAllocator(std::byte* buf, std::size_t cap) : buf_(buf), capacity_(cap) {}
    void reset() noexcept { offset_ = 0; }
};

// AP: phân bổ scratch memory cho một request – reset sau khi response gửi đi
alignas(64) std::byte request_arena[4096];
LinearAllocator arena_alloc(request_arena, sizeof(request_arena));

void handle_uds_request(const UdsRequest& req) {
    // Tất cả allocation trong scope này dùng arena – không touch global heap
    std::pmr::vector<std::uint8_t> response_buf{&arena_alloc};
    std::pmr::string               debug_info{&arena_alloc};

    build_response(req, response_buf, debug_info);
    send_response(response_buf);

    arena_alloc.reset();   // giải phóng toàn bộ trong O(1)
}
```

### 4.2 STL-compatible allocator

```cpp
template<typename T>
class PoolAllocator {
    static ObjectPool<T, 256> pool_;  // shared pool per type
public:
    using value_type = T;

    T* allocate(std::size_t n) {
        if (n != 1) throw std::bad_alloc(); // only single-object
        T* p = pool_.acquire();
        if (!p) throw std::bad_alloc();
        return p;
    }
    void deallocate(T* p, std::size_t) noexcept {
        pool_.release(p);
    }

    template<typename U>
    bool operator==(const PoolAllocator<U>&) const noexcept { return true; }
};

// Dùng với STL container
std::list<DiagMessage, PoolAllocator<DiagMessage>> pending_diag;
```

---

## 5. Move Semantics – nâng cao

### 5.1 Perfect forwarding

```cpp
// Factory function: forward constructor args không copy
template<typename T, typename... Args>
std::unique_ptr<T> make_unique_init(Args&&... args) {
    return std::make_unique<T>(std::forward<Args>(args)...);
}

// Phân biệt forwarding reference vs rvalue reference:
template<typename T>
void foo(T&& x);        // forwarding reference (T deduced)

void bar(std::string&& x); // rvalue reference (T fixed)
```

### 5.2 Move-only types trong AP

```cpp
// ara::core::Future là move-only – không thể copy
ara::core::Future<std::vector<std::uint8_t>> ReadDTC() {
    ara::core::Promise<std::vector<std::uint8_t>> promise;
    auto future = promise.get_future();

    std::thread([p = std::move(promise)]() mutable {
        // p là move-only, capture by move
        std::vector<std::uint8_t> dtc_data = read_dem_dtc();
        p.set_value(std::move(dtc_data));
    }).detach();

    return future;  // return by move (NRVO hoặc explicit move)
}
```

### 5.3 Copy-and-swap idiom

```cpp
class Buffer {
    std::byte*  data_{nullptr};
    std::size_t size_{0};
public:
    Buffer() = default;
    explicit Buffer(std::size_t n)
        : data_(new std::byte[n]), size_(n) {}

    ~Buffer() { delete[] data_; }

    // Copy constructor
    Buffer(const Buffer& other) : Buffer(other.size_) {
        std::memcpy(data_, other.data_, size_);
    }

    // Move constructor
    Buffer(Buffer&& other) noexcept
        : data_(std::exchange(other.data_, nullptr))
        , size_(std::exchange(other.size_, 0)) {}

    // Unified assignment via copy-and-swap
    Buffer& operator=(Buffer other) noexcept {
        std::swap(data_, other.data_);
        std::swap(size_, other.size_);
        return *this;  // other destructor cleans up old data
    }

    std::byte* data() noexcept { return data_; }
    std::size_t size() const noexcept { return size_; }
};
```

---

## 6. Memory Model & Atomic Operations

### 6.1 Memory ordering

```cpp
// Lock-free single-producer single-consumer queue
template<typename T, std::size_t N>
class LockFreeQueue {
    std::array<T, N>            buf_;
    std::atomic<std::size_t>    head_{0};   // consumer reads
    std::atomic<std::size_t>    tail_{0};   // producer writes

public:
    // Producer: chỉ một thread gọi push
    bool push(T val) {
        std::size_t t = tail_.load(std::memory_order_relaxed);
        std::size_t next = (t + 1) % N;
        if (next == head_.load(std::memory_order_acquire)) {
            return false;   // full
        }
        buf_[t] = std::move(val);
        tail_.store(next, std::memory_order_release);
        return true;
    }

    // Consumer: chỉ một thread gọi pop
    bool pop(T& out) {
        std::size_t h = head_.load(std::memory_order_relaxed);
        if (h == tail_.load(std::memory_order_acquire)) {
            return false;   // empty
        }
        out = std::move(buf_[h]);
        head_.store((h + 1) % N, std::memory_order_release);
        return true;
    }
};

// AP: ISR → main thread data transfer không dùng mutex
LockFreeQueue<RawFrame, 64> isr_to_main;
```

### 6.2 Compare-exchange pattern

```cpp
// Atomic counter với CAS – thread-safe without mutex
class AtomicStats {
    std::atomic<std::uint64_t> bytes_sent_{0};
    std::atomic<std::uint64_t> packets_sent_{0};
public:
    void record_send(std::size_t bytes) noexcept {
        bytes_sent_.fetch_add(bytes, std::memory_order_relaxed);
        packets_sent_.fetch_add(1,     std::memory_order_relaxed);
    }

    // Atomic max: update chỉ khi val > current max
    void update_max_latency(std::uint64_t val) noexcept {
        std::uint64_t cur = max_latency_.load(std::memory_order_relaxed);
        // CAS loop – giải quyết race giữa nhiều reporter
        while (val > cur &&
               !max_latency_.compare_exchange_weak(
                   cur, val,
                   std::memory_order_relaxed,
                   std::memory_order_relaxed)) { /* retry */ }
    }
private:
    std::atomic<std::uint64_t> max_latency_{0};
};
```

---

## 7. Bài tập thực hành

### Bài 1 – UniqueResource (generic RAII)
Implement `UniqueResource<T, D>` tương tự `std::unique_ptr` nhưng nhận resource handle bất kỳ (int fd, HANDLE, GLuint, …):
- `get()`, `reset()`, `release()`
- Move-only, correct noexcept spec
- Dùng custom deleter concept

### Bài 2 – StackAllocator
Implement `StackAllocator<T, N>` tương thích STL:
- Quản lý pre-allocated stack array, O(1) allocate/deallocate
- Gặp overflow → fallback lên `std::allocator`
- **Test:** dùng với `std::vector<int, StackAllocator<int,128>>` – verify không có heap alloc trong 128 đầu

### Bài 3 – Ring Buffer Lock-Free
Mở rộng `LockFreeQueue` ở mục 6.1 thành **multi-producer single-consumer** dùng `compare_exchange_strong`.  
**Test:** 4 producer thread, 1 consumer, 1 triệu operations, verify không mất item.

### Bài 4 – Object Pool với Smart Pointer
Implement `PoolPtr<T>` – smart pointer trả object về pool khi destroy:
```cpp
auto msg = pool.acquire();  // trả PoolPtr<DiagMessage>
// ... dùng msg ...
// khi msg ra scope: tự gọi pool.release()
```
Hint: `unique_ptr` với custom deleter trỏ về pool.

### Bài 5 – AP Memory Budget Checker
Viết class `MemoryBudget` với:
- Constructor nhận max bytes
- `allocate(n)` → tăng counter, ném `std::bad_alloc` khi vượt budget
- `deallocate(n)` → giảm counter
- Thread-safe dùng atomics
- **AP context:** monitor memory usage của một Adaptive Application process

---

## Tóm tắt

| Kỹ thuật | Khi dùng | AP Application |
|---|---|---|
| RAII / ScopeGuard | Mọi resource cleanup | FD, lock, timer |
| unique_ptr + custom deleter | OS resource | Socket, file, mmap |
| shared_ptr / weak_ptr | Shared ownership | Session objects, registry |
| Placement new + pool | Zero heap alloc hot path | PDU pool, message pool |
| PMR LinearAllocator | Per-request scratch | UDS request handler |
| LockFreeQueue | ISR↔thread, producer↔consumer | CAN frame, sensor data |
| Memory ordering | Fine-grained sync | Stats, flag, lock-free |

**Phần trước ←** [C++ Nâng cao Phần 1: Templates & Concepts](/cpp-templates/)  
**Phần tiếp →** [C++ Nâng cao Phần 3: Concurrency & Async](/cpp-concurrency/)
