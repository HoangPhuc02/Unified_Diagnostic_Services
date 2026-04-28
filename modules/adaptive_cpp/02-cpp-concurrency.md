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

> **Mục tiêu bài này:** Bạn sẽ hiểu cách thread hoạt động từ bên trong, biết tránh các lỗi concurrency kinh điển, xây dựng async pipeline bằng Future/Promise, và viết code async dạng "thẳng" (không callback hell) bằng C++20 Coroutines.  
> **Yêu cầu trước:** Nắm vững Memory Model & RAII.  
> **Compiler:** GCC ≥ 11, Clang ≥ 12 với `-std=c++20 -pthread`

---

## Tổng quan: Các mức độ concurrency trong C++

```
Cao nhất (dễ dùng nhất):
  Coroutine (co_await)      ← C++20: logic tuần tự, suspend/resume tự động
  Future/Promise            ← C++11: giao tiếp one-shot giữa thread
  std::async                ← C++11: chạy task async, trả future
  Thread Pool               ← pattern: tái dùng thread, không tạo mới mỗi task
  Condition Variable        ← C++11: wait cho điều kiện
Thấp nhất (kiểm soát nhất):
  std::thread / std::mutex  ← raw primitives
  std::atomic               ← lock-free, memory ordering
```

**Nguyên tắc chung:** dùng mức cao nhất đủ cho nhu cầu. Regex: "nếu cần giải thích thêm cho reviewer, có lẽ mức thấp hơn quá mức cần thiết".

---

## 1. Thread Basics & Lifetime Management

### Thread lifecycle – quan trọng để hiểu trước

```
Thread lifecycle:

  std::thread t(fn);          ← "Joinable" state
        │
   ┌────┴─────────────────────┐
   │  fn() đang chạy           │
   └────────────────┬─────────┘
                    │
        ┌───────────┴──────────────┐
        │                          │
    t.join()               t.detach()
        │                          │
  Thread kết thúc         Thread chạy độc lập
  t trở thành             t không còn
  "not joinable"          giao tiếp được
        │
  ~std::thread()          ~std::thread():
  → OK (not joinable)     → OK (detached)

  NGUY HIỂM: ~std::thread() khi còn joinable → std::terminate()!
```

---

### 1.1 std::thread – Tạo và quản lý

```cpp
#include <thread>
#include <atomic>
#include <mutex>

// Stop flag: atomic vì đọc và ghi từ hai thread khác nhau
// Không dùng bool thông thường: data race → undefined behavior
std::atomic<bool> stop_flag{false};

// Worker function: nhận argument qua tham số
// QUAN TRỌNG: vector và mutex truyền bằng reference
void sensor_reader(std::vector<float>& out, std::mutex& mtx) {
    while (!stop_flag.load(std::memory_order_relaxed)) {
        // memory_order_relaxed cho stop_flag: ta không cần sync memory khác,
        // chỉ cần đọc giá trị đúng (không torn read)

        float val = read_adc_channel(0);

        {
            // lock_guard: RAII mutex – tự unlock khi ra khỏi {}
            // Cặp {} giới hạn critical section ngắn nhất có thể
            std::lock_guard<std::mutex> lk(mtx);
            out.push_back(val);
        }
        // mtx đã unlock ở đây (lk destroyed)

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

int main() {
    std::vector<float> samples;
    std::mutex mtx;

    // std::ref() BẮTT BUỘC khi truyền reference vào std::thread constructor
    // Không có std::ref → thread nhận COPY (không phải reference)
    std::thread t(sensor_reader, std::ref(samples), std::ref(mtx));

    std::this_thread::sleep_for(std::chrono::seconds(2));

    // Báo thread dừng
    stop_flag.store(true, std::memory_order_relaxed);

    // PHẢI join (hoặc detach) trước khi std::thread destructor chạy
    // join(): chờ thread kết thúc rồi mới tiếp tục
    t.join();

    std::printf("Collected %zu samples\n", samples.size());
}
```

> **⚠️ Lỗi phổ biến nhất:** Quên `t.join()` rồi `t` đi ra scope → `std::terminate()` crash. Hãy dùng `jthread` (mục 1.2) để tránh vấn đề này hoàn toàn.

---

### 1.2 `std::jthread` (C++20) – Thread an toàn hơn

`jthread` = `j`oinable thread: **tự động join** (gọi `join()`) khi destructor chạy. Kết hợp với `stop_token` để dừng thread đúng cách.

```cpp
#include <stop_token>

// jthread tự join khi bị destroy – không cần gọi join() thủ công
// stop_token: mechanism để yêu cầu dừng từ bên ngoài

std::jthread heartbeat([](std::stop_token stoken) {
    // stop_requested(): true khi ai đó gọi heartbeat.request_stop()
    while (!stoken.stop_requested()) {

        send_alive_message();  // gửi keepalive đến supervisor
        std::this_thread::sleep_for(std::chrono::milliseconds(500));

        // Cách tinh tế hơn: sleep ngắn hơn nhưng kiểm tra stop thường xuyên
        // Hoặc dùng stop_token với condition_variable
    }

    // Cleanup: chạy khi stop được request
    send_shutdown_notification();
    std::puts("[heartbeat] Stopped cleanly");
});

// ... sau 5 giây trong main:
std::this_thread::sleep_for(std::chrono::seconds(5));

// Yêu cầu dừng – stoken.stop_requested() trở thành true
heartbeat.request_stop();

// jthread destructor tự gọi join() – chờ thread finish cleanup
// Không cần viết heartbeat.join() thủ công
```

> **💡 Nguyên tắc:** Dùng `jthread` thay `thread` trong C++20. Dùng `stop_token` thay `atomic<bool>` để dừng thread.

---

## 2. Future & Promise – Giao tiếp one-shot giữa Thread

### Khái niệm cốt lõi

```
Producer Thread                    Consumer Thread
  ┌─────────────┐                   ┌─────────────┐
  │  promise<T> │                   │  future<T>  │
  │             │                   │             │
  │ set_value() ├──→ shared state ←─┤ get()       │
  │ set_exception│                  │ (block cho  │
  └─────────────┘                   │  đến khi    │
                                    │  ready)     │
                                    └─────────────┘

Promise = "đầu ghi" của một kênh one-shot
Future  = "đầu đọc" – block cho đến khi promise set_value/set_exception
```

---

### 2.1 `std::async` – Cách đơn giản nhất

```cpp
#include <future>

// std::launch::async: ĐẢMD BẢO chạy trên thread riêng (không lazy)
// Nếu chỉ std::async(fn): có thể chạy lazy (không khuyến khích)
auto future_snapshot = std::async(std::launch::async, []() {
    // Hàm này chạy trên một thread riêng ngay lập tức
    return compute_dtc_snapshot();  // trả giá trị khi xong
});

// Làm việc khác trong main thread trong khi compute_dtc_snapshot() chạy song song
do_other_work();

// get(): block cho đến khi thread xong, trả kết quả
// Nếu thread throw exception → get() rethrow exception đó
auto snapshot = future_snapshot.get();

// Kiểm tra có ready chưa (không block):
if (future_snapshot.wait_for(std::chrono::milliseconds(0))
        == std::future_status::ready) {
    auto s = future_snapshot.get();
}
```

---

### 2.2 Promise/Future pair – Kiểm soát thủ công

Dùng khi: nhiều tầng giữa "người tạo future" và "người set kết quả", hoặc kết quả được set từ callback.

```cpp
// Tình huống: client gửi request, server response về qua callback
// Muốn caller API nhận future để chờ response

class DemProxy {
    std::mutex                                        mu_;
    std::map<std::uint32_t,
             std::promise<DtcSnapshot>>               pending_;
    std::uint32_t                                     next_token_{0};

public:
    // Client gọi: nhận future, có thể get() bất cứ lúc nào
    std::future<DtcSnapshot> RequestDtcSnapshot(std::uint16_t dtc_group) {
        std::lock_guard lk(mu_);

        // Tạo promise, trả future cho caller
        auto token = next_token_++;
        auto [it, ok] = pending_.emplace(token, std::promise<DtcSnapshot>{});
        auto result_future = it->second.get_future();
        // ↑ get_future() chỉ gọi một lần; promise và future được "link" với nhau

        // Gửi request đi
        send_request_to_dm(token, dtc_group);

        return result_future;  // trả future cho caller ngay
        // Caller có thể get() bất cứ lúc nào, sẽ block cho đến khi response về
    }

    // Receive loop gọi khi response về (có thể trên thread khác)
    void on_dem_response(std::uint32_t token, DtcSnapshot snap) {
        std::lock_guard lk(mu_);
        auto it = pending_.find(token);
        if (it != pending_.end()) {
            // set_value(): unblock bất kỳ thread nào đang get() trên future này
            it->second.set_value(std::move(snap));
            pending_.erase(it);
        }
    }
};

// Cách dùng:
DemProxy dem;
auto future = dem.RequestDtcSnapshot(0xFF);  // trả ngay, không block

// ... làm việc khác ...

auto snap = future.get();  // block ở đây cho đến khi response về
```

---

### 2.3 `shared_future` – Nhiều consumer chờ cùng kết quả

```cpp
// Vấn đề: future<T>::get() chỉ gọi được MỘT lần (rvalue, có thể move-only)
// shared_future<T>: có thể copy, nhiều thread cùng get()

std::promise<Config> cfg_promise;
// .share() chuyển future thành shared_future
std::shared_future<Config> cfg_future = cfg_promise.get_future().share();

// Nhiều subsystem chờ cùng config – OK với shared_future
auto net_task = std::async([cfg_future]() {
    const auto& cfg = cfg_future.get();  // mỗi thread gọi get() riêng
    apply_network_config(cfg);
});
auto diag_task = std::async([cfg_future]() {
    const auto& cfg = cfg_future.get();  // chờ cùng promise
    apply_diag_config(cfg);
});

// Sau khi config load xong: unblock TẤT CẢ thread đang chờ
cfg_promise.set_value(load_config_from_file());
```

---

## 3. Thread Pool – Tái dùng Thread, Không Tạo Mới

### Tại sao dùng Thread Pool?

Tạo thread mới tốn ~1ms (tạo kernel thread, setup stack). Nếu mỗi diagnostic request tạo một thread → overhead lớn.

Thread Pool: tạo N thread một lần, giữ sẵn. Khi task mới đến, "thuê" một thread trong pool, task xong trả thread về pool.

```
Thread Pool architecture:

   Task queue             Worker threads
  ┌───────────┐          ┌──────────────┐
  │ task_1    │←─pull────│  Worker 1    │
  │ task_2    │←─pull────│  Worker 2    │
  │ task_3    │          │  Worker 3    │ ← đang busy
  │ ...       │←─pull────│  Worker 4    │
  └───────────┘          └──────────────┘
  cv_.notify_one()         cv_.wait() khi idle
```

```cpp
#include <queue>
#include <functional>
#include <condition_variable>

class ThreadPool {
    std::vector<std::thread>           workers_;
    std::queue<std::function<void()>>  tasks_;
    std::mutex                         mtx_;
    std::condition_variable            cv_;
    bool                               stop_{false};

public:
    // Constructor: khởi tạo N worker threads
    explicit ThreadPool(std::size_t n_threads) {
        workers_.reserve(n_threads);

        for (std::size_t i = 0; i < n_threads; ++i) {
            workers_.emplace_back([this] {
                // Vòng lặp worker: chờ task, thực hiện, lặp lại
                for (;;) {
                    std::function<void()> task;

                    {
                        // unique_lock vì cần unlock trong cv_.wait()
                        std::unique_lock lk(mtx_);

                        // wait(lk, pred): unlock mtx_, ngủ, khi được notify
                        // acquire mtx_ lại, kiểm tra pred. Nếu false: ngủ tiếp
                        // Pred: "stop_ = true" hoặc "tasks_ không rỗng"
                        cv_.wait(lk, [this] {
                            return stop_ || !tasks_.empty();
                        });

                        // Điều kiện thoát: stop được request VÀ không còn task
                        if (stop_ && tasks_.empty()) return;

                        // Lấy task từ queue (move để tránh copy std::function)
                        task = std::move(tasks_.front());
                        tasks_.pop();
                    }
                    // mtx_ được release trước khi chạy task
                    // Quan trọng: task có thể tốn thời gian,
                    // không muốn hold mutex trong khi đó

                    task();  // Chạy task
                }
            });
        }
    }

    // Destructor: báo stop, đợi tất cả worker kết thúc
    ~ThreadPool() {
        {
            std::lock_guard lk(mtx_);
            stop_ = true;  // set flag
        }
        cv_.notify_all();  // đánh thức tất cả worker đang wait
        for (auto& w : workers_) w.join();  // chờ từng worker xong
    }

    // submit: thêm task, trả future cho kết quả
    // F = callable type, Args = argument types
    template<typename F, typename... Args>
    auto submit(F&& f, Args&&... args)
        -> std::future<std::invoke_result_t<F, Args...>>
    {
        // R = kiểu trả về của f(args...)
        using R = std::invoke_result_t<F, Args...>;

        // packaged_task: wrap callable, kết nối với future
        // shared_ptr vì task được capture trong lambda dưới
        auto task = std::make_shared<std::packaged_task<R()>>(
            // Capture f và args bằng perfect forward
            [f = std::forward<F>(f),
             ...args = std::forward<Args>(args)]() mutable {
                return f(args...);
            }
        );

        auto fut = task->get_future();  // lấy future TRƯỚC khi move task

        {
            std::lock_guard lk(mtx_);
            if (stop_) throw std::runtime_error("ThreadPool stopped");
            // Đẩy lambda vào queue – khi worker chạy, nó gọi (*task)()
            tasks_.emplace([task]{ (*task)(); });
        }

        cv_.notify_one();  // đánh thức MỘT worker đang idle
        return fut;
    }
};

// Sử dụng:
ThreadPool pool(4);  // 4 worker threads

auto fut1 = pool.submit([](UdsRequest req) {
    return process_uds_request(req);
}, incoming_req);

auto fut2 = pool.submit([] { return read_vin(); });

// Lấy kết quả khi cần:
auto response = fut1.get();   // block cho đến khi xong
auto vin      = fut2.get();
```

---

## 4. Condition Variable – Chờ Điều Kiện Đúng Cách

### Tại sao không dùng busy-wait?

```cpp
// BAD: busy-wait (spinning) – lãng phí 100% CPU
while (queue.empty()) { /* nothing */ }
auto item = queue.front();

// BAD: sleep loop – phản hồi chậm
while (queue.empty()) std::this_thread::sleep_for(1ms);

// GOOD: condition variable – ngủ đến khi có item, được đánh thức ngay
std::unique_lock lk(mtx);
cv.wait(lk, [&]{ return !queue.empty(); });
auto item = queue.front();
```

---

### 4.1 Bounded BlockingQueue

```cpp
// Queue có giới hạn kích thước: full → push block; empty → pop block
template<typename T>
class BlockingQueue {
    std::deque<T>            q_;
    std::mutex               mtx_;
    std::condition_variable  not_empty_;  // báo khi có item mới
    std::condition_variable  not_full_;   // báo khi có chỗ trống
    const std::size_t        max_size_;
    bool                     closed_{false};

public:
    explicit BlockingQueue(std::size_t max) : max_size_(max) {}

    // push: ghi từ producer thread
    // Trả false nếu queue đã closed (không ghi được nữa)
    bool push(T val) {
        std::unique_lock lk(mtx_);

        // Chờ cho đến khi có chỗ trống HOẶC queue được đóng
        // Predicate bảo vệ khỏi spurious wakeups:
        // mỗi lần wakeup, kiểm tra lại điều kiện thật sự
        not_full_.wait(lk, [this] {
            return closed_ || q_.size() < max_size_;
        });

        if (closed_) return false;  // queue đóng → từ chối ghi

        q_.push_back(std::move(val));
        not_empty_.notify_one();  // báo consumer "có item mới"
        return true;
    }

    // pop: đọc từ consumer thread
    // Trả false nếu queue đóng VÀ rỗng (không còn gì để đọc)
    bool pop(T& out) {
        std::unique_lock lk(mtx_);

        not_empty_.wait(lk, [this] {
            return closed_ || !q_.empty();
        });

        if (q_.empty()) return false;  // closed + empty → hết dữ liệu

        out = std::move(q_.front());
        q_.pop_front();
        not_full_.notify_one();  // báo producer "có chỗ trống"
        return true;
    }

    // close(): đánh thức tất cả waiter để họ biết không còn item mới
    void close() {
        std::lock_guard lk(mtx_);
        closed_ = true;
        not_empty_.notify_all();  // đánh thức tất cả consumer
        not_full_.notify_all();   // đánh thức tất cả producer
    }
};

// Ứng dụng: producer/consumer pipeline
BlockingQueue<EthFrame> eth_rx_queue(256);

// Producer: nhận frame từ driver
std::jthread eth_receiver([&](std::stop_token st) {
    while (!st.stop_requested()) {
        if (auto frame = read_eth_driver())
            eth_rx_queue.push(*frame);
    }
    eth_rx_queue.close();  // báo consumer không còn item mới
});

// Consumer: xử lý frame
std::jthread eth_processor([&](std::stop_token) {
    EthFrame frame;
    while (eth_rx_queue.pop(frame)) {  // pop trả false khi empty + closed
        process_someip_frame(frame);
    }
    std::puts("[processor] Done – queue closed");
});
```

---

## 5. C++20 Coroutines – Async Mà Không Callback Hell

### Vấn đề của callback-based async

```cpp
// BAD: callback hell – logic bị đảo ngược, exception handling khó
void handle_diagnostic_request(UdsRequest req) {
    read_security_level([req](SecurityLevel sec) {
        if (sec < 3) {
            send_error_response(0x33);
        } else {
            read_snapshot_data(req.dtc, [req](SnapshotData snap) {
                validate_data(snap, [req, snap](bool valid) {
                    if (valid) {
                        build_response(snap, [](Response r) {
                            send_response(r);
                        });
                    }
                });
            });
        }
    });
}
// Logic thật sự: 4 bước tuần tự
// Code: 4 callback lồng nhau, khó đọc, khó debug
```

```cpp
// GOOD: coroutine – logic tuần tự, compiler tự xử lý suspend/resume
Task<void> handle_diagnostic_request(UdsRequest req) {
    auto sec  = co_await read_security_level();
    if (sec < 3) { co_await send_error_response(0x33); co_return; }

    auto snap = co_await read_snapshot_data(req.dtc);
    bool valid = co_await validate_data(snap);
    if (!valid) { co_return; }

    auto resp = co_await build_response(snap);
    co_await send_response(resp);
}
// Logic = 4 bước tuần tự, code = 4 dòng
```

---

### 5.1 Generator – Dãy Lazy

**Lazy** nghĩa là: chỉ tính giá trị khi được yêu cầu. Hãy nghĩ đến "streaming từng phần tử" thay vì "load toàn bộ vào vector".

```
Generator lifecycle:

  for (auto v : gen) { ... }
         │
  gen.begin() → resume coroutine cho đến co_yield
         │
  co_yield value;        ← coroutine DỪNG ở đây, trả value về caller
         │
  caller dùng value      ← main thread xử lý
         │
  ++iter → resume lại từ sau co_yield
         │
  co_yield value2        ← dừng lại, trả value2
         ...
  hết coroutine → done() = true → range loop kết thúc
```

```cpp
#include <coroutine>

// Skeleton của Generator<T> – cần promise_type để compiler xử lý co_yield
template<typename T>
struct Generator {
    // promise_type: compiler dùng để sinh code cho coroutine frame
    struct promise_type {
        T current_value;  // giá trị hiện tại được co_yield

        // get_return_object: được gọi khi coroutine được tạo
        // trả Generator<T> object cho caller
        Generator get_return_object() {
            return Generator{
                std::coroutine_handle<promise_type>::from_promise(*this)};
        }

        // initial_suspend: suspend ngay sau khi tạo (lazy – không chạy cho đến khi begin())
        std::suspend_always initial_suspend() noexcept { return {}; }
        // final_suspend: suspend sau khi coroutine kết thúc (để caller check done())
        std::suspend_always final_suspend()   noexcept { return {}; }

        // yield_value: chạy khi coroutine reaches co_yield expr
        // lưu value, trả suspend_always (dừng coroutine)
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

    // Iterator interface cho range-based for
    struct Iter {
        std::coroutine_handle<promise_type> h;
        bool operator!=(std::default_sentinel_t) const { return !h.done(); }
        Iter& operator++() { h.resume(); return *this; }  // resume coroutine
        T& operator*() { return h.promise().current_value; }
    };

    Iter begin() { handle_.resume(); return {handle_}; }  // resume đến co_yield đầu tiên
    std::default_sentinel_t end() { return {}; }
};

// ===== Sử dụng =====

// Sinh số Fibonacci vô hạn, lazy (không cần vector)
Generator<std::uint64_t> fibonacci() {
    std::uint64_t a = 0, b = 1;
    for (;;) {  // vô hạn – nhưng caller dừng khi cần
        co_yield a;
        auto tmp = a + b;
        a = b;
        b = tmp;
    }
}

// Chỉ lấy 10 số đầu – không tính các số còn lại
int count = 0;
for (auto n : fibonacci()) {
    std::printf("%" PRIu64 " ", n);
    if (++count >= 10) break;  // dừng generator
}

// AP context: iterate DTC entries lazy – không load toàn bộ vào memory
Generator<DtcEntry> iter_dtc_memory(DtcGroup group) {
    for (std::size_t i = 0; i < dem_get_count(group); ++i) {
        co_yield dem_get_entry(group, i);
        // dem_get_entry chỉ được gọi khi caller yêu cầu entry tiếp theo
    }
}
```

---

### 5.2 Task Coroutine – Async Chain

```cpp
// Task<T>: coroutine trả T khi xong
// co_await Task<U>: tạm dừng coroutine hiện tại cho đến khi Task<U> hoàn thành
template<typename T>
struct Task {
    struct promise_type {
        std::optional<T>        result_;
        std::exception_ptr      exception_;
        std::coroutine_handle<> continuation_;  // ai đang co_await Task này

        Task get_return_object() {
            return Task{std::coroutine_handle<promise_type>::from_promise(*this)};
        }
        std::suspend_never  initial_suspend() noexcept { return {}; }  // bắt đầu ngay
        std::suspend_always final_suspend()   noexcept {
            // Khi Task kết thúc: resume coroutine đang chờ (continuation)
            if (continuation_) continuation_.resume();
            return {};
        }
        void return_value(T v)      { result_ = std::move(v); }
        void unhandled_exception()  { exception_ = std::current_exception(); }
    };

    std::coroutine_handle<promise_type> handle_;
    explicit Task(std::coroutine_handle<promise_type> h) : handle_(h) {}
    ~Task() { if (handle_) handle_.destroy(); }

    // Awaitable interface – cho phép: co_await some_task
    bool await_ready() const noexcept { return handle_.done(); }
    void await_suspend(std::coroutine_handle<> awaiter) {
        // Lưu lại coroutine đang chờ, để resume khi ta xong
        handle_.promise().continuation_ = awaiter;
    }
    T await_resume() {
        if (handle_.promise().exception_)
            std::rethrow_exception(handle_.promise().exception_);
        return std::move(*handle_.promise().result_);
    }
};

// ===== Ví dụ chuỗi async =====
// Mỗi co_await nói: "đợi task này xong, lấy result, tiếp tục"

Task<DiagResponse> handle_read_did(std::uint16_t did) {
    // Bước 1: đọc security level (async – không block thread)
    auto security = co_await read_security_async();
    if (security < 0x03) {
        co_return DiagResponse::nrc(0x33);  // security access denied
    }

    // Bước 2: đọc data từ storage (async)
    auto raw = co_await read_eeprom_async(did);

    // Bước 3: validate (có thể async nếu cần crypto verify)
    auto ok = co_await validate_did_async(raw);
    if (!ok) {
        co_return DiagResponse::nrc(0x31);  // request out of range
    }

    // Bước 4: build response
    co_return DiagResponse::positive(0x62, did, raw);
}
// Logic rõ ràng như code đồng bộ,
// nhưng mỗi co_await không block thread – coroutine suspend và resume
```

---

## 6. Synchronization Primitives C++20

### 6.1 `std::latch` – Rendezvous một lần

```cpp
#include <latch>

// Latch: chờ N thread/event, sau đó tất cả tiếp tục
// Dùng cho: khởi tạo song song, startup synchronization

void initialize_ap_subsystems() {
    constexpr int NUM_SUBSYSTEMS = 3;

    // Latch khởi tạo với count = 3
    // Mỗi lần gọi count_down() → count = count - 1
    // Khi count = 0: tất cả thread đang wait() được unblock
    std::latch all_ready(NUM_SUBSYSTEMS);

    auto init_async = [&](const char* name, auto init_fn) {
        std::thread([&all_ready, name, init_fn] {
            init_fn();
            std::printf("[init] %s ready\n", name);
            all_ready.count_down();  // báo "tôi xong rồi"
        }).detach();
    };

    init_async("Network Stack", init_network);
    init_async("Crypto Module", init_crypto);
    init_async("Filesystem",    init_filesystem);

    all_ready.wait();  // block cho đến khi cả 3 count_down() được gọi
    std::puts("All AP subsystems ready – starting main loop");
}
```

---

### 6.2 `std::barrier` – Rendezvous lặp lại

```cpp
#include <barrier>

// Barrier: tái sử dụng sau mỗi phase – phù hợp cho pipeline nhiều bước

void run_parallel_pipeline(std::size_t n_workers) {
    // Completion function: chạy sau khi TẤT CẢ worker đến barrier
    // Chạy trên một trong các worker thread, dùng để swap buffers, log, etc.
    auto on_phase_done = []() noexcept {
        std::puts("Phase complete – swapping buffers");
        swap_processing_buffers();
    };

    // Barrier với n_workers participants + completion callback
    std::barrier sync(n_workers, on_phase_done);

    auto worker = [&sync](std::size_t worker_id) {
        for (int phase = 0; phase < NUM_PHASES; ++phase) {
            // Mỗi worker xử lý phần của mình
            process_chunk(worker_id, phase);

            // arrive_and_wait: "tôi xong phase này, đợi tất cả worker khác"
            // Khi tất cả n_workers đều gọi arrive_and_wait:
            //   1. on_phase_done() được gọi
            //   2. TẤT CẢ worker được unblock, tiếp tục phase tiếp theo
            sync.arrive_and_wait();
        }
    };

    std::vector<std::thread> threads;
    for (std::size_t i = 0; i < n_workers; ++i)
        threads.emplace_back(worker, i);
    for (auto& t : threads) t.join();
}
```

---

### 6.3 `std::counting_semaphore` – Giới hạn số lượng đồng thời

```cpp
#include <semaphore>

// Semaphore(N): cho phép tối đa N thread vào critical section cùng lúc
// acquire(): giảm count (block nếu count = 0)
// release(): tăng count (unblock một waiter nếu có)

// Giới hạn số connection DoIP đồng thời (tránh quá tải ECU)
std::counting_semaphore<8> doip_connection_limit{8};  // max 8 connections

void handle_doip_connection(int client_fd) {
    doip_connection_limit.acquire();  // "lấy một slot"
    // Nếu đã có 8 connections → block cho đến khi ai đó release

    // RAII: tự release khi scope exits
    ScopeGuard release_guard([&] {
        doip_connection_limit.release();  // "trả lại slot"
    });

    // Xử lý kết nối – tối đa 8 connections chạy đồng thời
    serve_doip_client(client_fd);
}
// release_guard: gọi release() khi hàm trả về (kể cả exception)
```

---

## 7. ara::com Async Pattern

### 7.1 Method call và timeout handling

```cpp
void DiagClientApp::Run() {
    // RequestDTCInformation: returns ara::core::Future (non-blocking)
    auto future = proxy_->ReadDTCInformation(
        ara::diag::sid0x19::SubFunction::kReportDtcByStatusMask,
        0xFF  // all DTC groups
    );

    // wait_for: kiểm tra ready trong giới hạn thời gian
    // KHÔNG block vô hạn – quan trọng trong safety-critical code
    auto status = future.wait_for(std::chrono::milliseconds(200));

    if (status == std::future_status::timeout) {
        logger_.LogError() << "ReadDTC timeout after 200ms";
        notify_timeout_fault();
        return;
    }

    if (status == std::future_status::ready) {
        auto result = future.get();  // không block vì đã ready
        if (result.HasValue()) {
            process_dtc_list(result.Value());
        } else {
            logger_.LogError() << "DTC read error: " << result.Error().Message();
        }
    }
}
```

---

### 7.2 Event Subscribe – Marshal về main thread

```cpp
void DiagMonitor::setup_vehicle_speed_subscription() {
    // Subscribe: nhận tối đa 1 sample cached
    proxy_->VehicleSpeed.Subscribe(
        ara::com::EventCacheUpdatePolicy::kLastN, 1
    );

    // SetReceiveHandler: callback chạy trên ara::com INTERNAL thread
    // KHÔNG xử lý trực tiếp trong callback nếu nó không thread-safe
    proxy_->VehicleSpeed.SetReceiveHandler([this] {
        // Đọc samples ngay trong callback (nhanh, thread-safe)
        auto samples = proxy_->VehicleSpeed.GetNewSamples(
            [](auto& sample) { return sample.speed_kph; }
        );

        for (auto& s : samples) {
            // Post sang main executor để xử lý trong main thread context
            // main_executor_ là single-threaded → không cần mutex trong on_speed_update
            main_executor_.post([this, v = *s] {
                on_speed_update(v);
            });
        }
        // Pattern này tách biệt "ara::com thread" và "application logic thread"
    });
}
```

---

## 8. Bài tập thực hành

### Bài 1 – Thread Pool với Work Stealing

Mở rộng ThreadPool từ mục 3:
- **Work stealing**: worker nhàn rỗi lấy task từ queue của worker bận nhất
- Mỗi worker có queue riêng, khi hết → steal từ worker khác
- **Benchmark:** so sánh throughput vs single global queue với 8 workers, 100k tasks

---

### Bài 2 – Active Object Pattern

Implement `ActiveObject<T>` – object có thread riêng, nhận method call qua queue:

```cpp
ActiveObject<DemClient> dem;
dem.async_invoke(&DemClient::ReportEvent, 0xA001);  // enqueue, không block
auto fut = dem.async_call(&DemClient::GetDtcCount);  // trả future
auto count = fut.get();
```

`async_invoke`: fire-and-forget. `async_call`: trả future cho kết quả.  
**AP context:** mỗi Adaptive Application chạy như Active Object.

---

### Bài 3 – Coroutine Generator Pipeline

Dùng `Generator` để tạo pipeline lazy:

```cpp
auto result = source_dtc_entries()
            | filter([](const DtcEntry& e) { return e.is_active(); })
            | transform([](const DtcEntry& e) { return e.to_bytes(); })
            | take(50);

for (auto bytes : result) { send_over_can(bytes); }
```

`operator|` trả `Generator`, mỗi stage là một coroutine.  
Không có intermediate vector – streaming thuần túy.

---

### Bài 4 – Deadline Scheduler (EDF)

Implement `DeadlineScheduler` chạy tasks theo **Earliest Deadline First**:

```cpp
DeadlineScheduler sched;
sched.submit(task_A, std::chrono::milliseconds(100));  // deadline: +100ms
sched.submit(task_B, std::chrono::milliseconds(50));   // deadline: +50ms
// task_B được chạy trước dù submit sau
```

Thread-safe với `std::priority_queue` + mutex. Verify với 3 producer threads.

---

### Bài 5 – Async Retry với Exponential Backoff

```cpp
template<typename F>
auto async_retry(F fn, int max_attempts, std::chrono::milliseconds base_delay)
    -> std::future<std::invoke_result_t<F>>;
```

Khi `fn()` throw: chờ `base_delay * 2^attempt`, thử lại. Cuối cùng rethrow nếu vẫn fail.  
**AP context:** retry `TransferData` UCM khi Ethernet link ngắt tạm thời.

---

## Tóm tắt – Khi nào dùng gì?

| Kỹ thuật | Vấn đề giải quyết | AP Application |
|---|---|---|
| **jthread + stop_token** | Background task an toàn | Heartbeat, sensor polling |
| **std::async** | One-shot async, đơn giản | Compute-heavy task |
| **Promise/Future** | One-shot với manual control | DEM async request |
| **shared_future** | Multiple consumers same result | Config broadcast |
| **Thread Pool** | Reuse threads, bounded concurrency | Diagnostic session handler |
| **BlockingQueue** | Producer/consumer pipeline | ETH frame → parser |
| **Generator coroutine** | Lazy sequence, streaming | DTC iterator |
| **Task coroutine** | Async chain không callback hell | Multi-step diag flow |
| **std::latch** | One-time N-party sync | Startup init |
| **std::barrier** | Repeated phase sync | Pipeline stages |
| **Semaphore** | Bound concurrent access | Connection pool |

**← Phần trước:** [C++ Nâng cao Phần 2: Memory & RAII](/cpp-memory/)  
**Phần tiếp →:** [C++ Nâng cao Phần 4: Design Patterns & AP Architecture](/cpp-patterns/)

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
