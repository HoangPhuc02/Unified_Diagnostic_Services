---
layout: default
title: "Advanced C++ – Phần 3: Concurrency & Async Programming"
nav_exclude: true
module: true
category: adaptive_cpp
tags: [cpp, concurrency, async, future, coroutine, thread, cpp20, ara-com]
description: "Lập trình bất đồng bộ và đa luồng nâng cao trong C++17/20: future/promise, coroutine, thread pool, và ứng dụng trực tiếp trong ara::com / ara::diag Adaptive Platform."
permalink: /cpp-concurrency/
---

# Advanced C++ – Phần 3: Concurrency & Async Programming

> **Môi trường:** C++17/C++20 · POSIX threads  
> **AP Context:** ara::com callback, ara::diag handler, UCM transfer – đều là async operations

---

## 1. Thread Basics & Pitfalls

### 1.1 std::thread – tạo và join

```cpp
#include <thread>
#include <atomic>

std::atomic<bool> stop_flag{false};

// Worker thread đọc sensor liên tục
void sensor_reader(std::vector<float>& out, std::mutex& mtx) {
    while (!stop_flag.load(std::memory_order_relaxed)) {
        float val = read_adc_channel(0);
        {
            std::lock_guard<std::mutex> lk(mtx);
            out.push_back(val);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

int main() {
    std::vector<float> samples;
    std::mutex mtx;

    std::thread t(sensor_reader, std::ref(samples), std::ref(mtx));
    std::this_thread::sleep_for(std::chrono::seconds(2));

    stop_flag.store(true, std::memory_order_relaxed);
    t.join();   // MUST join – destructor với joinable thread = std::terminate
}
```

### 1.2 jthread (C++20) – auto-join + stop_token

```cpp
#include <stop_token>

// jthread: tự join khi destructor, tích hợp stop_token
std::jthread heartbeat_thread([](std::stop_token stoken) {
    while (!stoken.stop_requested()) {
        send_alive_check();
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
    // cleanup
    send_shutdown_notification();
});

// Dừng thread: request_stop() + jthread tự join khi out-of-scope
heartbeat_thread.request_stop();
// heartbeat_thread.join() tự động gọi trong ~jthread
```

---

## 2. Future & Promise

### 2.1 std::async – cơ bản

```cpp
#include <future>

// Chạy bất đồng bộ, lấy kết quả sau
auto future_result = std::async(std::launch::async, []() {
    return compute_dtc_snapshot();  // chạy trên thread pool
});

// ... tiếp tục làm việc khác ...

auto snapshot = future_result.get();  // block cho đến khi có kết quả
```

### 2.2 Promise / Future pair – manual control

```cpp
// AP-style: handler đặt kết quả, caller nhận Future
class DemProxy {
    std::mutex                              mu_;
    std::map<std::uint32_t,
             std::promise<DtcSnapshot>>    pending_;
    std::uint32_t                          next_token_{0};

public:
    // Gửi request async, trả future
    std::future<DtcSnapshot> RequestDtcSnapshot(std::uint16_t dtc_group) {
        std::lock_guard lk(mu_);
        auto token = next_token_++;
        auto [it, _] = pending_.emplace(token, std::promise<DtcSnapshot>{});
        send_request(token, dtc_group);
        return it->second.get_future();
    }

    // Gọi bởi receive loop khi response về
    void on_response(std::uint32_t token, DtcSnapshot snap) {
        std::lock_guard lk(mu_);
        if (auto it = pending_.find(token); it != pending_.end()) {
            it->second.set_value(std::move(snap));
            pending_.erase(it);
        }
    }
};
```

### 2.3 shared_future – nhiều consumer

```cpp
std::promise<Config> config_promise;
std::shared_future<Config> config_future = config_promise.get_future().share();

// Nhiều thread chờ cùng config – ok với shared_future
auto t1 = std::async([config_future]() {
    auto& cfg = config_future.get();
    apply_network_config(cfg);
});
auto t2 = std::async([config_future]() {
    auto& cfg = config_future.get();
    apply_diag_config(cfg);
});

config_promise.set_value(load_config_from_file());
```

---

## 3. Thread Pool

### 3.1 Implement Thread Pool đơn giản

```cpp
#include <queue>
#include <functional>
#include <condition_variable>

class ThreadPool {
    std::vector<std::thread>          workers_;
    std::queue<std::function<void()>> tasks_;
    std::mutex                        mtx_;
    std::condition_variable           cv_;
    bool                              stop_{false};

public:
    explicit ThreadPool(std::size_t n_threads) {
        workers_.reserve(n_threads);
        for (std::size_t i = 0; i < n_threads; ++i) {
            workers_.emplace_back([this] {
                for (;;) {
                    std::function<void()> task;
                    {
                        std::unique_lock lk(mtx_);
                        cv_.wait(lk, [this] {
                            return stop_ || !tasks_.empty();
                        });
                        if (stop_ && tasks_.empty()) return;
                        task = std::move(tasks_.front());
                        tasks_.pop();
                    }
                    task();
                }
            });
        }
    }

    ~ThreadPool() {
        {
            std::lock_guard lk(mtx_);
            stop_ = true;
        }
        cv_.notify_all();
        for (auto& w : workers_) w.join();
    }

    // Submit task, trả future cho kết quả
    template<typename F, typename... Args>
    auto submit(F&& f, Args&&... args)
        -> std::future<std::invoke_result_t<F, Args...>>
    {
        using R = std::invoke_result_t<F, Args...>;
        auto task = std::make_shared<std::packaged_task<R()>>(
            [f = std::forward<F>(f),
             ...args = std::forward<Args>(args)]() mutable {
                return f(args...);
            }
        );
        auto fut = task->get_future();
        {
            std::lock_guard lk(mtx_);
            if (stop_) throw std::runtime_error("pool stopped");
            tasks_.emplace([task]{ (*task)(); });
        }
        cv_.notify_one();
        return fut;
    }
};

// AP: pool xử lý nhiều diagnostic request song song
ThreadPool diag_pool(4);

auto fut = diag_pool.submit([](UdsRequest req) {
    return process_uds_request(req);
}, incoming_request);
```

---

## 4. Condition Variable Patterns

### 4.1 Bounded blocking queue

```cpp
template<typename T>
class BlockingQueue {
    std::deque<T>           q_;
    std::mutex              mtx_;
    std::condition_variable not_empty_;
    std::condition_variable not_full_;
    const std::size_t       max_size_;
    bool                    closed_{false};

public:
    explicit BlockingQueue(std::size_t max) : max_size_(max) {}

    // Push: block nếu đầy, return false nếu queue đã close
    bool push(T val) {
        std::unique_lock lk(mtx_);
        not_full_.wait(lk, [this] {
            return closed_ || q_.size() < max_size_;
        });
        if (closed_) return false;
        q_.push_back(std::move(val));
        not_empty_.notify_one();
        return true;
    }

    // Pop: block nếu rỗng, return false nếu queue đóng và rỗng
    bool pop(T& out) {
        std::unique_lock lk(mtx_);
        not_empty_.wait(lk, [this] {
            return closed_ || !q_.empty();
        });
        if (q_.empty()) return false;   // closed + empty
        out = std::move(q_.front());
        q_.pop_front();
        not_full_.notify_one();
        return true;
    }

    void close() {
        std::lock_guard lk(mtx_);
        closed_ = true;
        not_empty_.notify_all();
        not_full_.notify_all();
    }
};

// AP: pipeline – receiver → queue → processor
BlockingQueue<RawFrame> rx_queue(256);

std::jthread receiver([&](std::stop_token st) {
    while (!st.stop_requested()) {
        if (auto frame = read_from_driver(); frame)
            rx_queue.push(*frame);
    }
    rx_queue.close();
});

std::jthread processor([&](std::stop_token) {
    RawFrame f;
    while (rx_queue.pop(f)) {
        process_eth_frame(f);
    }
});
```

---

## 5. C++20 Coroutines

### 5.1 Generator – lazy sequence

```cpp
#include <coroutine>

template<typename T>
struct Generator {
    struct promise_type {
        T current_value;

        Generator get_return_object() {
            return Generator{std::coroutine_handle<promise_type>::from_promise(*this)};
        }
        std::suspend_always initial_suspend() noexcept { return {}; }
        std::suspend_always final_suspend()   noexcept { return {}; }
        std::suspend_always yield_value(T v) noexcept {
            current_value = std::move(v);
            return {};
        }
        void return_void() {}
        void unhandled_exception() { std::terminate(); }
    };

    std::coroutine_handle<promise_type> handle_;

    explicit Generator(std::coroutine_handle<promise_type> h) : handle_(h) {}
    ~Generator() { if (handle_) handle_.destroy(); }

    // Iterator interface
    struct iterator {
        std::coroutine_handle<promise_type> h;
        bool operator!=(std::default_sentinel_t) const { return !h.done(); }
        iterator& operator++() { h.resume(); return *this; }
        T& operator*() { return h.promise().current_value; }
    };
    iterator begin() { handle_.resume(); return {handle_}; }
    std::default_sentinel_t end() { return {}; }
};

// Coroutine: generate Fibonacci lazily
Generator<std::uint64_t> fibonacci() {
    std::uint64_t a = 0, b = 1;
    for (;;) {
        co_yield a;
        auto tmp = a + b;
        a = b;
        b = tmp;
    }
}

// AP context: generate DTC entries một cái một lúc, tránh load toàn bộ
Generator<DtcEntry> iter_dtc_memory(std::uint8_t group) {
    for (std::size_t i = 0; i < dem_get_count(group); ++i) {
        co_yield dem_get_entry(group, i);  // lazy – chỉ đọc khi cần
    }
}
```

### 5.2 Async Task (Task coroutine)

```cpp
// Minimal Task<T> coroutine – single-use awaitable
template<typename T>
struct Task {
    struct promise_type {
        std::optional<T>         result;
        std::exception_ptr        exception;
        std::coroutine_handle<>   continuation;

        Task get_return_object() {
            return Task{std::coroutine_handle<promise_type>::from_promise(*this)};
        }
        std::suspend_never  initial_suspend() noexcept { return {}; }
        std::suspend_always final_suspend()   noexcept { return {}; }
        void return_value(T v) { result = std::move(v); }
        void unhandled_exception() { exception = std::current_exception(); }
    };

    std::coroutine_handle<promise_type> handle_;

    // Awaitable interface – cho phép co_await Task
    bool await_ready() const noexcept { return handle_.done(); }
    void await_suspend(std::coroutine_handle<> c) {
        handle_.promise().continuation = c;
    }
    T await_resume() {
        if (handle_.promise().exception)
            std::rethrow_exception(handle_.promise().exception);
        return std::move(*handle_.promise().result);
    }

    ~Task() { if (handle_) handle_.destroy(); }
};

// Ví dụ: chain async operations trong AP
Task<DiagResponse> handle_read_did(std::uint16_t did) {
    // co_await: suspend hiện tại, resume khi future sẵn sàng
    auto raw_data = co_await read_eeprom_async(did);
    auto validated = co_await validate_data_async(raw_data);
    co_return build_positive_response(0x22, did, validated);
}
```

---

## 6. Synchronization Primitives nâng cao

### 6.1 std::latch và std::barrier (C++20)

```cpp
#include <latch>
#include <barrier>

// Latch: một lần – chờ N event rồi tiếp tục
void initialize_subsystems() {
    constexpr int N = 3;
    std::latch ready(N);

    auto init = [&](const char* name, auto fn) {
        std::thread([&ready, name, fn] {
            fn();
            std::printf("%s ready\n", name);
            ready.count_down();     // giảm counter
        }).detach();
    };

    init("Network",    init_network);
    init("Crypto",     init_crypto);
    init("Filesystem", init_filesystem);

    ready.wait();   // block cho đến khi cả 3 xong
    std::puts("All subsystems initialized");
}

// Barrier: tái sử dụng – đồng bộ nhiều phase
void pipeline_processing(std::size_t n_workers) {
    auto on_phase_complete = []() noexcept {
        std::puts("Phase complete – swap buffers");
        swap_work_buffers();
    };
    std::barrier sync(n_workers, on_phase_complete);

    auto worker = [&](std::size_t id) {
        for (int phase = 0; phase < 10; ++phase) {
            do_phase_work(id, phase);
            sync.arrive_and_wait();   // barrier tại cuối mỗi phase
        }
    };
    // launch n_workers threads
}
```

### 6.2 Semaphore (C++20)

```cpp
#include <semaphore>

// Giới hạn concurrent access vào tài nguyên giới hạn
std::counting_semaphore<8> connection_limit(8);  // max 8 connections

void handle_client_connection(int client_fd) {
    connection_limit.acquire();     // decrement (block nếu 0)
    ScopeGuard release_guard([&] { connection_limit.release(); });

    // xử lý kết nối – tối đa 8 cùng lúc
    serve_client(client_fd);
}
```

---

## 7. ara::com Async Pattern

### 7.1 Method call async (AP style)

```cpp
// ara::com proxy gọi method trả ara::core::Future
void DiagClientApp::Run() {
    // Non-blocking request
    auto future = proxy_->ReadDTCInformation(
        ara::diag::sid0x19::SubFunction::kReportDtcByStatusMask,
        0xFF  // all status
    );

    // Kết hợp với timer – timeout handling
    auto timeout = std::async(std::launch::async, []{
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    });

    // Chờ cả hai với future::wait_for
    if (future.wait_for(std::chrono::milliseconds(200))
            == std::future_status::timeout) {
        logger_.LogError() << "ReadDTC timeout";
        return;
    }

    auto result = future.get();
    if (result.HasValue()) {
        process_dtc_list(result.Value());
    } else {
        logger_.LogError() << "Error: " << result.Error().Message();
    }
}
```

### 7.2 Event Subscribe Pattern

```cpp
// Subscribe SOME/IP event – callback chạy trên ara::com executor thread
void DiagMonitor::subscribe_vehicle_speed() {
    proxy_->VehicleSpeed.Subscribe(
        ara::com::EventCacheUpdatePolicy::kLastN, 1
    );

    proxy_->VehicleSpeed.SetReceiveHandler([this] {
        // Chạy trên ara::com thread – marshal về main executor
        auto samples = proxy_->VehicleSpeed.GetNewSamples(
            [](auto& sample) { return sample.speed_kph; }
        );
        for (auto& s : samples) {
            main_executor_.post([this, v = *s] {
                on_speed_update(v);
            });
        }
    });
}
```

---

## 8. Bài tập thực hành

### Bài 1 – ThreadPool nâng cao
Mở rộng ThreadPool ở mục 3.1:
- **Work stealing**: thread nhàn rỗi lấy task từ queue của thread khác
- **Priority queue**: task có priority, task cao chạy trước
- **Timeout submit**: reject task nếu queue đầy sau `timeout` ms

### Bài 2 – Active Object Pattern
Implement `ActiveObject<T>` – object có thread riêng, nhận method call qua queue:
```cpp
ActiveObject<Sensor> obj;
obj.async_invoke(&Sensor::read);     // enqueue, không block
auto fut = obj.async_call(&Sensor::get_calibration);  // trả future
```
**AP context:** mỗi Adaptive Application chạy như Active Object, giao tiếp qua ara::com message.

### Bài 3 – Coroutine Pipeline
Dùng `Generator` để implement pipeline:
```cpp
auto pipeline = source()
              | transform([](auto x) { return x * 2; })
              | filter([](auto x) { return x > 10; })
              | take(100);
for (auto v : pipeline) { process(v); }
```
Hint: `operator|` trả `Generator`, mỗi stage là một coroutine.

### Bài 4 – Deadline-aware Scheduler
Implement `DeadlineScheduler` chạy tasks theo EDF (Earliest Deadline First):
```cpp
scheduler.submit(task_A, deadline_100ms);
scheduler.submit(task_B, deadline_50ms);
// task_B chạy trước dù submit sau
```
Thread-safe. Verify với test 3 thread submit đồng thời.

### Bài 5 – Async Retry with Backoff
Implement:
```cpp
template<typename F>
auto async_retry(F fn, int max_attempts, std::chrono::milliseconds base_delay)
    -> std::future<std::invoke_result_t<F>>;
```
Thử lại khi exception, delay tăng theo exponential backoff, log attempt count.  
**AP context:** retry UCM `TransferData` khi network lỗi tạm thời.

---

## Tóm tắt

| Kỹ thuật | Khi dùng | AP Application |
|---|---|---|
| std::jthread + stop_token | Long-running background task | Heartbeat, sensor poll |
| Future/Promise | One-shot async result | DEM request, ECU reset |
| Thread Pool | Concurrent request handling | Diagnostic session pool |
| BlockingQueue | Producer/consumer pipeline | RX frame → parser |
| Coroutine Generator | Lazy data source | DTC iteration |
| Coroutine Task | Async chain without callback hell | Multi-step diag flow |
| std::latch | One-time rendezvous | Subsystem init |
| std::barrier | Repeated phase synchronization | Multi-phase pipeline |
| Semaphore | Resource count limit | Connection pool |

**Phần trước ←** [C++ Nâng cao Phần 2: Memory & RAII](/cpp-memory/)  
**Phần tiếp →** [C++ Nâng cao Phần 4: Design Patterns & AP Architecture](/cpp-patterns/)
