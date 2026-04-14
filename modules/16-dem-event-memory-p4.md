---
layout: default
title: "DEM - Event Memory Part 4: Fault Confirmation, Combination and Conditions"
nav_exclude: true
module: true
tags: [autosar, dem, fault-confirmation, event-combination, obd, enable-conditions, storage-conditions]
description: "DEM Event Memory phần 4 – Xác nhận lỗi, Event Combination, Enable/Storage Conditions và OBD grouping."
permalink: /dem-event-memory-p4/
---

# DEM – Event Memory (Part 4): Fault Confirmation, Event Combination & Conditions

> Tài liệu này mô tả các phần **7.7.4 Fault Confirmation**, **7.7.5 Event Combination** và **7.7.6 Enable and Storage Conditions** – ba cơ chế kiểm soát **khi nào DTC được xác nhận chính thức**, **cách nhiều event gộp thành một DTC** và **điều kiện môi trường để chẩn đoán hoạt động**.

---

## 7.7.4 Fault Confirmation

**Fault confirmation** là quá trình nâng trạng thái DTC từ "đã phát hiện" lên "đã xác nhận chính thức". Đây là cột mốc quan trọng trong vòng đời DTC vì:

1. `confirmedDTC` (CDTC bit) được set.
2. Dữ liệu freeze frame có thể được chốt lưu.
3. Indicator (MIL) có thể được kích hoạt.
4. DTC được coi là có độ tin cậy cao về sự tồn tại lỗi thực sự.

**Sự khác biệt giữa pending và confirmed**:

```mermaid
stateDiagram-v2
    direction LR
    [*] --> NoDTC: No fault
    NoDTC --> Pending: First FAILED in a cycle\nPDTC=1 set
    Pending --> Confirmed: Confirmation criteria met\nCDTC=1 set
    Pending --> NoDTC: Cycle ends without re-fail\nPDTC=0 cleared
    Confirmed --> PassedRecorded: Monitor passes\ntestFailed cleared, CDTC stays
    PassedRecorded --> [*]: Clear or Aging
```

**Confirmation criterion – hai model phổ biến**:

### Model 1: Single-cycle confirmation

```
DTC được confirmed ngay khi FAILED trong cycle đầu tiên.
→ ConfirmationThreshold = 1 cycle
→ CDTC set cùng lúc với PDTC
```

```mermaid
sequenceDiagram
    participant MON as Monitor
    participant DEM

    Note over MON,DEM: Cycle 1
    MON->>DEM: FAILED (qualified)
    DEM->>DEM: PDTC = 1
    DEM->>DEM: Threshold=1 → CDTC = 1 immediately
```

### Model 2: Multi-cycle confirmation

```
DTC được confirmed sau N cycles có FAILED.
→ ConfirmationThreshold = 2 cycles (ví dụ)
→ Cycle 1: PDTC=1, CDTC=0 (pending chờ)
→ Cycle 2 cũng FAILED → CDTC=1 (confirmed)
→ Nếu Cycle 2 sạch → PDTC cleared, reset counter
```

```mermaid
sequenceDiagram
    participant MON as Monitor
    participant DEM

    Note over MON,DEM: Cycle 1
    MON->>DEM: FAILED
    DEM->>DEM: PDTC=1, failCycleCounter=1
    DEM->>DEM: Threshold=2, counter < 2 → CDTC=0

    Note over MON,DEM: Cycle 2 (no fail)
    DEM->>DEM: New cycle: PDTC=0, failCycleCounter reset?
    Note over DEM: Depends on config: some reset, some accumulate

    Note over MON,DEM: Cycle 3 (fail again)
    MON->>DEM: FAILED
    DEM->>DEM: failCycleCounter=2 → Threshold=2 met → CDTC=1!
```

**Cấu hình confirmation threshold**:

```xml
<DEM-DTC-ATTRIBUTES>
  <SHORT-NAME>DemDTCAttr_CoolantTemp</SHORT-NAME>
  <!-- Number of operation cycles with FAILED needed to confirm -->
  <DEM-CONFIRMATION-THRESHOLD>2</DEM-CONFIRMATION-THRESHOLD>
</DEM-DTC-ATTRIBUTES>
```

```c
/* DEM internal: update confirmation counter */
static void Dem_UpdateConfirmationCounter(Dem_EventIdType EventId)
{
    uint8* confirmCtr = Dem_GetConfirmationCounter(EventId);
    uint8  threshold  = Dem_GetConfirmationThreshold(EventId);

    if (*confirmCtr < threshold) {
        (*confirmCtr)++;
    }

    if (*confirmCtr >= threshold) {
        /* Set confirmedDTC bit */
        Dem_SetStatusBit(EventId, DEM_STATUS_BIT_CDTC);
        /* Notify indicator logic */
        Dem_UpdateIndicatorRequest(EventId);
    }
}
```

---

### 7.7.4.1 Method for Grouping of Association of Events for OBD Purpose

Trong OBD (On-Board Diagnostics), một số DTC cần được xác nhận theo **driving cycle** cụ thể, không phải theo operation cycle thông thường.

**OBD Driving Cycle vs Operation Cycle**:

| Cycle | Định nghĩa | Dùng cho |
|---|---|---|
| Operation Cycle | Mỗi key-on/key-off | Standard DEM events |
| OBD Driving Cycle | "Trip" theo chuẩn OBD: đạt điều kiện speed/temp/load nhất định | OBD emission DTCs |

**OBD Readiness và DTC status**:

```
OBD DTC lifecycle:
1. Monitor đánh giá trong driving cycle
2. Nếu FAILED: PDTC = 1
3. Nếu FAILED trong N consecutive driving cycles: CDTC = 1
4. MIL bật sau khi CDTC = 1

SAE J1979 / ISO 15031 định nghĩa:
  - 2 consecutive failing driving cycles = confirmed OBD DTC
  - MIL phải bật sau 2nd failed driving cycle
```

```mermaid
flowchart TB
    DC1[Driving Cycle 1\nOBD conditions met] -->|Monitor FAILED| PDTC1[PDTC=1]
    PDTC1 -->|Cycle ends| DC2[Driving Cycle 2\nOBD conditions met]
    DC2 -->|Monitor FAILED again| CDTC1[CDTC=1\nMIL ON]
    DC2 -->|Monitor PASSED| PDTC_CLR[PDTC=0\nReset to pending]
```

**Grouping for OBD purpose – liên kết monitor với OBD readiness**:

```
Mỗi OBD-relevant monitor được gán vào một "readiness group":
- Comprehensive Component Monitoring (CCM)
- Catalyst Monitor
- Heated Catalyst Monitor
- Evaporative System Monitor
- Oxygen Sensor Monitor
- EGR System Monitor
...

Khi tester đọc 0x01 01 (OBD Mode 1), ECU trả về readiness bitmap
cho mỗi group: $00 = Not complete, $01 = Complete
```

---

## 7.7.5 Event Combination

**Event combination** là cơ chế AUTOSAR DEM cho phép **nhiều event** chia sẻ **một DTC** – tức là nhiều nguồn lỗi khác nhau đều ánh xạ đến cùng một mã DTC mà tester thấy.

**Hai phương thức combination**:

```mermaid
flowchart TB
    COMB[Event Combination] --> COS[7.7.5.1 Combination on Storage\nCombined at memory entry level]
    COMB --> COR[7.7.5.2 Combination on Retrieval\nCombined when tester reads]
```

---

### 7.7.5.1 Combination On Storage

**Combination on Storage** nghĩa là nhiều event **chia sẻ một memory entry**. Khi bất kỳ event nào trong nhóm FAILED, tất cả đều được ghi chung vào một entry.

**Ví dụ kinh điển – Wheel Speed Sensor unit**:

```
DTC: C0035 (Wheel Speed Sensor Front Left circuit)

Combined events:
  Event_WSS_FL_OpenCircuit    → ánh xạ vào DTC C0035
  Event_WSS_FL_ShortToGround  → ánh xạ vào DTC C0035
  Event_WSS_FL_ShortToVBatt   → ánh xạ vào DTC C0035

→ Chỉ một entry trong event memory cho C0035
→ Status byte là OR của tất cả event status
→ Freeze frame chụp khi bất kỳ event nào first-failed
```

```mermaid
flowchart LR
    E1[Event_WSS_FL_Open\nFAILED] --> COMBINED_ENTRY[Single Memory Entry\nDTC: C0035\nStatus: OR combined\nFreeze frame: from first fail]
    E2[Event_WSS_FL_Short_GND\nPASSED] --> COMBINED_ENTRY
    E3[Event_WSS_FL_Short_VBatt\nFAILED] --> COMBINED_ENTRY
```

**Status byte logic trong Combination on Storage**:

```c
/* Status byte của combined entry = OR của tất cả member events */
Dem_UdsStatusByteType combinedStatus = 0;
for (uint8 i = 0; i < numCombinedEvents; i++) {
    combinedStatus |= Dem_GetEventStatusByte(combinedEventIds[i]);
}
/* Ví dụ:
   E1 status = 0x09 (TF=1, CDTC=1)
   E2 status = 0x08 (CDTC=1 only)
   E3 status = 0x09 (TF=1, CDTC=1)
   Combined = 0x09 | 0x08 | 0x09 = 0x09 */
```

**Freeze frame trong combined entry**:

```
Capture trigger: khi bất kỳ member event nào đạt trigger condition
Capture data: lấy từ event nào FAILED đầu tiên (hoặc cấu hình specific)
```

**Liên tưởng Combination on Storage**:

> Giống như một phòng bệnh có nhiều bệnh nhân cùng chẩn đoán viêm phổi. Bệnh viện mở một hồ sơ nhóm thay vì hồ sơ riêng cho từng người. Khi một trong số họ xấu đi, hồ sơ nhóm được cập nhật.

---

### 7.7.5.2 Combination On Retrieval

**Combination on Retrieval** nghĩa là mỗi event vẫn có **memory entry riêng**, nhưng khi tester đọc qua `0x19`, DEM **gộp** chúng thành một DTC trong response.

```mermaid
flowchart LR
    subgraph MEMORY[Event Memory]
        E1_ENTRY[Entry: Event_WSS_FL_Open\nStatus: 0x09]
        E2_ENTRY[Entry: Event_WSS_FL_Short\nStatus: 0x01]
    end

    subgraph TESTER_VIEW[Tester View via 0x19]
        DTC_C0035[DTC: C0035\nCombined status: 0x09]
    end

    E1_ENTRY -->|Retrieval combination| DTC_C0035
    E2_ENTRY -->|Retrieval combination| DTC_C0035
```

**Sự khác biệt giữa hai loại**:

| Aspect | Combination on Storage | Combination on Retrieval |
|---|---|---|
| Memory usage | 1 entry shared | N entries (one per event) |
| Granularity | DTC-level granularity only | Per-event granularity in memory |
| Freeze frame | Shared record | Each event has own record |
| Status byte | OR of all members | OR when returned to tester |
| Data scope | Less detailed | More detailed per source |

**Khi nào chọn loại nào**:

```
Combination on Storage:
  ✓ Tiết kiệm memory slots
  ✓ Đơn giản hóa xử lý
  ✗ Mất granularity per-event freeze frame

Combination on Retrieval:
  ✓ Giữ được chi tiết từng event
  ✓ Freeze frame riêng cho từng nguồn lỗi
  ✗ Tốn nhiều memory slots hơn
```

---

## 7.7.6 Enable and Storage Conditions of Diagnostic Events

Enable và storage conditions là hai lớp điều kiện kiểm soát **khi nào DEM xử lý** và **khi nào DEM lưu** lỗi. Đây là cơ chế cực kỳ quan trọng để tránh false DTC trong các tình huống môi trường không phù hợp.

**Hai loại condition**:

```mermaid
flowchart LR
    subgraph ENABLE[Enable Conditions]
        EC[Kiểm soát:\nMONITOR EVALUATION\n\nNếu FALSE:\nDEM bỏ qua báo cáo\nDebounce không chạy]
    end

    subgraph STORAGE[Storage Conditions]
        SC[Kiểm soát:\nMEMORY ENTRY CREATION\n\nNếu FALSE:\nEvent debounce chạy\nNhưng không tạo/cập nhật entry]
    end

    MON[Monitor Report] --> ENABLE
    ENABLE -->|All TRUE| STORAGE
    STORAGE -->|All TRUE| MEM[Event Memory Entry]
    ENABLE -->|Any FALSE| IGNORE[Report ignored]
    STORAGE -->|Any FALSE| NOSTORE[Status updated\nbut no memory entry]
```

**Enable Conditions – ví dụ thực tế**:

| Enable Condition | Khi FALSE | Lý do |
|---|---|---|
| `VoltageStable` | Bỏ qua báo cáo điện áp | Voltage noise ở startup không phải lỗi |
| `NotInProgrammingSession` | Bỏ qua mọi event | Không chẩn đoán khi đang flash |
| `IgnitionOn` | Bỏ qua event ECU cụ thể | Một số ECU không active khi ignition OFF |
| `NetworkInitialized` | Bỏ qua CAN timeout | Bus chưa alive ngay khi bật nguồn |
| `SensorWarmupComplete` | Bỏ qua O2 sensor | Cảm biến cần thời gian warm-up |

**API set enable condition**:

```c
/* Application hoặc BswM set enable condition */

/* ECU vào programming session → disable all diagnostics */
void OnProgrammingSessionEntered(void)
{
    Dem_SetEnableCondition(
        DemConf_DemEnableCondition_NotInProgramming,
        FALSE   /* condition not satisfied → no monitoring */
    );
}

/* ECU thoát programming session → re-enable */
void OnDefaultSessionRestored(void)
{
    Dem_SetEnableCondition(
        DemConf_DemEnableCondition_NotInProgramming,
        TRUE    /* condition satisfied → monitoring resumes */
    );
}
```

**Behavior khi enable condition FALSE**:

```mermaid
sequenceDiagram
    participant MON as Monitor
    participant DEM
    participant DEBOUNCE as Debounce Engine

    MON->>DEM: SetEventStatus(PREFAILED)
    DEM->>DEM: Check enable conditions for EventId
    Note over DEM: EnableCond_VoltageStable = FALSE

    DEM->>DEM: Skip this report entirely
    DEM->>DEBOUNCE: Do NOT update debounce counter
    Note over DEBOUNCE: Counter stays at previous value\nNo state change at all
```

**Storage Conditions – ví dụ thực tế**:

| Storage Condition | Khi FALSE | Lý do |
|---|---|---|
| `VehicleMoving` | ABS fault không lưu | ABS chỉ relevant khi xe đang chạy |
| `EngineRunning` | Một số actuator fault không lưu | Actuator chỉ active khi engine chạy |
| `NvMReady` | Không tạo entry | Tránh mất entry nếu NvM chưa sẵn sàng |
| `NotInEndOfLineTesting` | Không lưu trong EOL | Test production không nên tạo DTC |

**Behavior khi storage condition FALSE (nhưng enable condition TRUE)**:

```mermaid
sequenceDiagram
    participant MON as Monitor
    participant DEM
    participant DEBOUNCE as Debounce Engine
    participant MEM as Event Memory

    MON->>DEM: SetEventStatus(PREFAILED)
    DEM->>DEM: Enable conditions = TRUE → process
    DEM->>DEBOUNCE: Update counter (debounce runs normally)
    DEBOUNCE-->>DEM: QUALIFIED FAILED

    DEM->>DEM: Check storage conditions
    Note over DEM: StorageCond_VehicleMoving = FALSE

    DEM->>DEM: Update status bits (TF, TFTOC, etc.)
    DEM->>MEM: Do NOT create or update memory entry
    Note over MEM: No freeze frame, no occurrence counter
    Note over DEM: Event is logically failed but not recorded
```

**Cấu hình trong ARXML**:

```xml
<!-- Enable condition definition -->
<DEM-ENABLE-CONDITION>
  <SHORT-NAME>DemEnableCond_NetworkInitialized</SHORT-NAME>
</DEM-ENABLE-CONDITION>

<!-- Storage condition definition -->
<DEM-STORAGE-CONDITION>
  <SHORT-NAME>DemStorageCond_VehicleMoving</SHORT-NAME>
</DEM-STORAGE-CONDITION>

<!-- Event linked to both conditions -->
<DEM-EVENT-PARAMETER>
  <SHORT-NAME>DemEvent_WheelSpeedSensor_FL</SHORT-NAME>

  <!-- Must have network alive to even evaluate -->
  <DEM-ENABLE-CONDITION-REFS>
    <DEM-ENABLE-CONDITION-REF>
      /DemEnableConditions/DemEnableCond_NetworkInitialized
    </DEM-ENABLE-CONDITION-REF>
  </DEM-ENABLE-CONDITION-REFS>

  <!-- Must be moving to store fault record -->
  <DEM-STORAGE-CONDITION-REFS>
    <DEM-STORAGE-CONDITION-REF>
      /DemStorageConditions/DemStorageCond_VehicleMoving
    </DEM-STORAGE-CONDITION-REF>
  </DEM-STORAGE-CONDITION-REFS>
</DEM-EVENT-PARAMETER>
```

**Enable/Storage condition state machine**:

```mermaid
stateDiagram-v2
    [*] --> AllSatisfied: All conditions TRUE
    AllSatisfied --> EnableFailed: Any enable condition → FALSE
    AllSatisfied --> StorageFailed: Any storage condition → FALSE

    EnableFailed: Enable condition failed\nReports ignored\nDebounce frozen
    StorageFailed: Storage condition failed\nDebounce runs\nNo memory entry

    EnableFailed --> AllSatisfied: All enable conditions → TRUE again
    StorageFailed --> AllSatisfied: All storage conditions → TRUE again

    AllSatisfied --> Normal: Normal operation\nDebounce + Storage both active
```

**Liên tưởng Enable vs Storage Conditions**:

> **Enable Condition** = điều kiện để giáo viên **chấm bài** (nếu không đủ điều kiện, bài không được chấm).
>
> **Storage Condition** = điều kiện để kết quả bài thi được **ghi vào học bạ** (bài có thể được chấm, có điểm, nhưng chưa đủ điều kiện để vào học bạ chính thức).

---

## Tổng kết Part 4

```mermaid
flowchart TB
    P4[Part 4: Confirmation + Combination + Conditions] --> S41[7.7.4 Fault Confirmation\nSingle vs Multi-cycle criteria]
    P4 --> S411[7.7.4.1 OBD Grouping\nDriving cycle based confirmation]
    P4 --> S451[7.7.5.1 Combination on Storage\nShared entry for multiple events]
    P4 --> S452[7.7.5.2 Combination on Retrieval\nPer-event storage, combined output]
    P4 --> S46[7.7.6 Enable and Storage Conditions\nGate evaluation and recording]

    S41 --> CDTC[CDTC bit = formal confirmation\nAffects indicator and persistence]
    S411 --> MIL[OBD: 2 failing driving cycles\nbefore MIL activation]
    S451 --> MEMORY[Save memory slots\nShared freeze frame]
    S452 --> DETAIL[More detailed per-event data\nBetter root cause isolation]
    S46 --> QUAL[Two-stage gate:\nEnable = evaluate?\nStorage = record?]
```

> Phần 4 giải quyết ba vấn đề kiến trúc quan trọng: **khi nào DTC đủ tin cậy để confirmed** (7.7.4), **cách tổ chức dữ liệu khi nhiều event chia sẻ một DTC** (7.7.5) và **cơ chế tắt chẩn đoán có chọn lọc theo môi trường** (7.7.6).

---

## Ghi chú nguồn tham khảo

1. AUTOSAR Classic Platform SRS DEM – Section 7.7.4, 7.7.5, 7.7.6.
2. SAE J1979 / ISO 15031-5 – OBD service $01 readiness, driving cycle definition.
3. ISO 14229-1 – DTC status byte, pendingDTC and confirmedDTC semantics.
4. Nguồn public: EmbeddedTutor AUTOSAR DEM, DeepWiki openAUTOSAR/classic-platform.
