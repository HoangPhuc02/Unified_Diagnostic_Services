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

> **Môi trường:** C++17/C++20  
> **AP Context:** Adaptive Applications yêu cầu deterministic memory – tránh fragmentation, tránh unbounded allocation trong safety-critical path

---

## 1. RAII – Resource Acquisition Is Initialization

**RAII** là nguyên tắc cốt lõi của C++: resource được acquire trong constructor, release trong destructor — đảm bảo không bao giờ leak dù có exception.

### 1.1 RAII wrapper cơ bản

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
