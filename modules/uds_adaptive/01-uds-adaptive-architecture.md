---
layout: default
title: "UDS Adaptive – Phần 2: Kiến trúc & Thành phần"
nav_exclude: true
module: true
category: uds_adaptive
tags: [autosar-adaptive, ara-diag, diagnostic-manager, doip, conversation, dem-adaptive]
description: "Kiến trúc Diagnostic Manager (DM), ara::diag C++ API, Conversation lifecycle, và DoIP transport trong AUTOSAR Adaptive Platform."
permalink: /uds-adaptive/uds-adaptive-p2/
---

# UDS Adaptive – Phần 2: Kiến trúc & Thành phần

> **Nguồn tham chiếu:**
> - [AUTOSAR AP SWS Diagnostics R25-11](https://www.autosar.org/fileadmin/standards/R25-11/AP/AUTOSAR_AP_SWS_Diagnostics.pdf) – Section 7 (API), Section 8 (Behavior)
> - ISO 14229-1:2020, ISO 13400-2:2019

---

## 1. Diagnostic Manager (DM) – Trái tim của AP Diagnostics

**Diagnostic Manager (DM)** là một **Adaptive Application process** chạy nền trên AP node.
Nó triển khai toàn bộ logic UDS (ISO 14229-1) và expose C++ API `ara::diag` để các
Adaptive Applications (AA) tích hợp.

> Trong AUTOSAR Classic, vai trò này được đảm nhiệm bởi **DCM** (BSW module tĩnh).
> Trong AP, DM là một **process động** – thư viện `ara::diag` link vào AA để gọi DM qua IPC.

### 1.1 Chức năng chính của DM

| Chức năng | Mô tả |
|---|---|
| **UDS Protocol Engine** | Xử lý toàn bộ SID: decode request, validate, route đến handler |
| **Conversation Management** | Quản lý multi-tester session, security level per-connection |
| **DoIP Interface** | Nhận/gửi data qua DoIP (ISO 13400-2) qua Ethernet |
| **Service Routing** | Điều hướng request đến đúng AA handler đã đăng ký |
| **DEM Bridge** | Cầu nối với DEM để đọc/xóa DTC qua 0x14, 0x19 |
| **Timing Management** | Quản lý P2, P2* server timer (response timeout) |
| **Security / Authentication** | Xử lý SecurityAccess (0x27) hoặc Authentication (0x29) |

### 1.2 Kiến trúc nội bộ DM

```mermaid
flowchart TB
    subgraph EXT["External"]
        TESTER["Tester / DiagClient\n(ODX, diagnostics tool)"]
    end

    subgraph TRANSPORT["Transport Layer"]
        DOIP["DoIP Stack (ISO 13400-2)\nEthernet / UDP+TCP"]
    end

    subgraph DM["Diagnostic Manager Process"]
        direction TB
        UDS_ENGINE["UDS Protocol Engine\n(Session ctrl, SID routing, timing)"]
        CONV_MGR["Conversation Manager\n(Session state, SecurityLevel per tester)"]
        SVC_ROUTER["Service Router\n(Route request → registered handler)"]
        AUTH_MGR["Security / Auth Manager\n(0x27 SecurityAccess / 0x29 Authentication)"]
        DEM_BRIDGE["DEM Bridge\n(DTC read/clear/report)"]
    end

    subgraph AA["Adaptive Applications"]
        HANDLER1["ReadDataByIdentifier Handler\n(ara::diag::DiagnosticService)"]
        HANDLER2["RoutineControl Handler\n(ara::diag::DiagnosticRoutine)"]
        HANDLER3["Custom UDS Handler\n(ara::diag::GenericUDSService)"]
    end

    subgraph DEM["DEM Process"]
        DEM_PROC["DEM Adaptive\n(DTC storage, event status)"]
    end

    TESTER -->|IP/Ethernet| DOIP
    DOIP --> UDS_ENGINE
    UDS_ENGINE --> CONV_MGR
    UDS_ENGINE --> SVC_ROUTER
    UDS_ENGINE --> AUTH_MGR
    SVC_ROUTER -->|IPC / ara::com| HANDLER1
    SVC_ROUTER -->|IPC / ara::com| HANDLER2
    SVC_ROUTER -->|IPC / ara::com| HANDLER3
    DEM_BRIDGE <-->|IPC| DEM_PROC

    style DM fill:#f0f7ff,stroke:#0a6cf1,stroke-width:2px
    style AA fill:#f0fff4,stroke:#16a34a,stroke-width:2px
```

---

## 2. `ara::diag` – C++ API Overview

`ara::diag` là C++ namespace chứa toàn bộ các class/interface mà AUTOSAR AP SWS Diagnostics
định nghĩa. AA link vào thư viện này để:
- **Đăng ký service handler** với DM
- **Nhận UDS request** và trả về response (sync hoặc async)
- **Lấy thông tin Conversation** (session, security level)
- **Report diagnostic events** (DTC)

### 2.1 Các class quan trọng nhất

| Class / Type | SID liên quan | Vai trò |
|---|---|---|
| `ara::diag::Conversation` | N/A | Đại diện một diagnostic session, có session state + security level |
| `ara::diag::GenericUDSService` | Bất kỳ SID | Base class cho handler tự do (custom SID hoặc standard SID) |
| `ara::diag::DiagnosticService` | Standard SIDs | Base class cho các standard service đã cấu hình qua manifest |
| `ara::diag::DiagnosticRoutine` | 0x31 RoutineControl | Handler tác vụ: Start/Stop/RequestResult |
| `ara::diag::DiagnosticSecurityAccess` | 0x27 SecurityAccess | Seed/Key challenge-response |
| `ara::diag::DiagnosticAuthentication` | 0x29 Authentication | PKI-based authentication (mới trong AP) |
| `ara::diag::DiagnosticDataIdentifier` | 0x22 / 0x2E | ReadDataByIdentifier / WriteDataByIdentifier |
| `ara::diag::DiagnosticEvent` | 0x14 / 0x19 | Report và query DTC/event status |
| `ara::core::Future<T>` | — | Async response mechanism |

### 2.2 Pattern tổng quát: OfferService

Tất cả handler trong AP theo pattern **offer/stop-offer** (giống `ara::com` service):

```cpp
// ===== Cấu trúc tổng quát một ara::diag handler =====

#include "ara/diag/generic_uds_service.h"
#include "ara/core/future.h"
#include "ara/core/promise.h"

class MyServiceHandler : public ara::diag::GenericUDSService {
public:
    // Cấu hình SID và sub-function mask qua constructor (từ manifest)
    MyServiceHandler(const ara::core::InstanceSpecifier& specifier)
        : ara::diag::GenericUDSService(specifier)
    {}

    // DM gọi hàm này khi nhận UDS request khớp với SID đã đăng ký
    ara::core::Future<ara::diag::OperationOutput> HandleMessage(
        const ara::diag::RequestData&       request,       // Raw UDS bytes
        ara::diag::MetaInfo&               metaInfo,      // Conversation, session...
        ara::diag::CancellationHandler&    cancelHandler  // Hủy nếu tester ngắt kết nối
    ) override;
};

// Trong main() hoặc Init():
MyServiceHandler handler(ara::core::InstanceSpecifier{"MyService"});
handler.Offer();    // Đăng ký với DM → DM bắt đầu routing request đến handler này
// ...
handler.StopOffer(); // Hủy đăng ký
```

---

## 3. Conversation – Quản lý Session đa tester

`ara::diag::Conversation` là object đại diện cho **một kết nối diagnostic** đang hoạt động.
DM tự động tạo/xóa Conversation khi tester connect/disconnect qua DoIP.

### 3.1 Thông tin có trong một Conversation

```cpp
// Lấy Conversation từ MetaInfo (trong handler callback)
ara::diag::Conversation& conv = metaInfo.GetConversation();

// Session state hiện tại (DefaultSession / ExtendedSession / ProgrammingSession...)
ara::diag::DiagnosticSessionType session = conv.GetDiagnosticSession();

// Security level (kLocked = chưa unlock, kUnlocked = đã pass SecurityAccess/Auth)
ara::diag::SecurityLevelType secLevel = conv.GetDiagnosticSecurityLevel();

// Địa chỉ nguồn (source address) của tester
uint16_t testerAddr = conv.GetSourceAddress();

// Target address của request
uint16_t targetAddr = conv.GetTargetAddress();
```

### 3.2 Conversation Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle : DM đang chờ kết nối

    Idle --> Connected : Tester gởi DoIP Routing Activation\n→ Conversation được tạo

    Connected --> DefaultSession : DiagnosticSessionControl 0x10 01\n(hoặc mặc định sau khi connect)

    DefaultSession --> ExtendedSession : 0x10 03 ExtendedDiagnosticSession
    DefaultSession --> ProgrammingSession : 0x10 02 ProgrammingSession

    ExtendedSession --> DefaultSession : 0x10 01 hoặc timeout S3Server
    ProgrammingSession --> DefaultSession : 0x10 01 hoặc timeout S3Server

    ExtendedSession --> SecurityUnlocked : 0x27 SecurityAccess – seed/key OK
    ProgrammingSession --> SecurityUnlocked : 0x27/0x29 Auth OK

    SecurityUnlocked --> ExtendedSession : Timeout hoặc 0x10 session change

    Connected --> Idle : Tester ngắt kết nối / DoIP disconnect\n→ Conversation bị hủy
```

> **Lưu ý:** Mỗi Conversation có trạng thái **độc lập**. Tester A ở ExtendedSession không
> ảnh hưởng tới Tester B ở DefaultSession. Đây là khác biệt lớn nhất so với CP.

---

## 4. DoIP – Transport Layer trong AP

**DoIP (Diagnostics over IP)** theo **ISO 13400-2** là transport protocol thay thế CanTP
trong môi trường Ethernet. DM sử dụng DoIP để nhận/gửi UDS messages.

### 4.1 DoIP Stack

```mermaid
flowchart LR
    subgraph Tester
        T_APP["Tester Application\n(UDS frames)"]
        T_DOIP["DoIP Client\nISO 13400-2"]
        T_TCP["TCP/IP Stack"]
    end

    subgraph AP_Node["AP ECU Node"]
        DM_DOIP["DoIP Server\n(ISO 13400-2)"]
        DM_PROC["Diagnostic Manager\n(ara::diag)"]
        ETH_DRIVER["Ethernet Driver"]
    end

    T_APP -->|UDS bytes| T_DOIP
    T_DOIP -->|TCP port 13400| T_TCP
    T_TCP -->|Ethernet frame| ETH_DRIVER
    ETH_DRIVER --> DM_DOIP
    DM_DOIP -->|Extracted UDS payload| DM_PROC
```

### 4.2 DoIP Message Flow – kết nối từ đầu đến cuối

```mermaid
sequenceDiagram
    participant Client as Tester (DoIP Client)
    participant Server as AP Node (DoIP Server)
    participant DM as Diagnostic Manager

    Note over Client,Server: Phase 1 – Vehicle Discovery (UDP Broadcast)
    Client->>Server: UDP 13400 – Vehicle Identification Request
    Server-->>Client: Vehicle Identification Response (VIN, EID, GID, LogicalAddr)

    Note over Client,Server: Phase 2 – TCP Connection
    Client->>Server: TCP Connect to port 13400
    Server-->>Client: TCP ACK

    Note over Client,Server: Phase 3 – Routing Activation
    Client->>Server: Routing Activation Request (sourceAddr=0x0E80, activationType=0x00)
    Server-->>Client: Routing Activation Response (0x10 Successful)
    Note over DM: Conversation tạo cho sourceAddr=0x0E80

    Note over Client,DM: Phase 4 – UDS Diagnostic Messages
    Client->>Server: DoIP Diagnostic Message (targetAddr=0x0001, UDS=0x10 03)
    Server->>DM: Route UDS payload to DM
    DM-->>Server: UDS Response (0x50 03)
    Server-->>Client: DoIP Diagnostic Message (UDS=0x50 03)
```

### 4.3 Cấu trúc DoIP frame

| Field | Size | Mô tả |
|---|---|---|
| Protocol Version | 1 byte | Phiên bản DoIP (0xFD = ISO 13400-2:2019) |
| Inverse Protocol Version | 1 byte | XOR của Protocol Version |
| Payload Type | 2 bytes | Loại message (0x8001 = Diagnostic Message) |
| Payload Length | 4 bytes | Độ dài phần payload |
| Source Address | 2 bytes | Địa chỉ tester |
| Target Address | 2 bytes | Địa chỉ ECU đích |
| **UDS Data** | N bytes | Toàn bộ UDS request/response frame |

---

## 5. DEM Adaptive – Quản lý DTC

Trong AP, quản lý DTC được thực hiện qua **DEM Adaptive** (Diagnostic Event Manager).
AA report sự kiện lỗi; DEM lưu trữ và làm sẵn sàng cho DM khi tester truy vấn 0x19.

```mermaid
flowchart LR
    subgraph AA["Adaptive Application"]
        MON["Monitor Function\n(kiểm tra điều kiện lỗi)"]
        API["ara::diag::DiagnosticEvent\n.ReportMonitorAction()"]
    end

    subgraph DEM["DEM Process (Adaptive)"]
        STORAGE["DTC Storage\n(EventMemory)"]
        STATUS["EventStatusByte\nper DTC"]
    end

    subgraph DM["Diagnostic Manager"]
        SID19["SID 0x19 Handler\n(ReadDTCInformation)"]
        SID14["SID 0x14 Handler\n(ClearDiagInfo)"]
    end

    TESTER["Tester"]

    MON -->|Phát hiện lỗi| API
    API -->|IPC / ara::com| STORAGE
    STORAGE --> STATUS

    SID19 <-->|Query DTC list| DEM
    SID14 -->|Clear DTC| DEM

    TESTER -->|0x19 / 0x14 request| DM
    DM -->|Response| TESTER
```

```cpp
// Ví dụ: AA report một diagnostic event (lỗi cảm biến)
#include "ara/diag/diagnostic_event.h"

// Khởi tạo với InstanceSpecifier từ manifest (maps đến DTC cụ thể)
ara::diag::DiagnosticEvent voltageEvent(
    ara::core::InstanceSpecifier{"SensorVoltageEvent"}
);

// Report trạng thái: kPassed / kFailed / kPrepassed / kPrefailed
void CheckVoltageSensor(float voltage) {
    if (voltage < 4.5f || voltage > 5.5f) {
        voltageEvent.ReportMonitorAction(
            ara::diag::MonitorAction::kFailed
        );
    } else {
        voltageEvent.ReportMonitorAction(
            ara::diag::MonitorAction::kPassed
        );
    }
}
```

---

## Tóm tắt thành phần

```mermaid
mindmap
    root((UDS Adaptive\nAP Stack))
        Diagnostic Manager
            UDS Protocol Engine
            Conversation Manager
            Service Router
            Security/Auth Manager
            DEM Bridge
        ara diag API
            GenericUDSService
            DiagnosticRoutine
            DiagnosticDataIdentifier
            DiagnosticEvent
            Conversation
        Transport
            DoIP - ISO 13400-2
            Ethernet TCP/IP
        External
            Tester / DiagClient
            SOME/IP middleware
```

---

**Xem tiếp:**
[Phần 3 – Dịch vụ UDS & Ví dụ Code]({{ '/uds-adaptive-p3/' | relative_url }}) –
mapping service CP→AP, ví dụ C++ ReadDataByIdentifier, RoutineControl, Authentication.
