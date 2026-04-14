---
layout: default
title: "UDS - Service ID 0x19 ReadDTCInformation (Part 2)"
nav_exclude: true
module: true
tags: [autosar, uds, diagnostics, iso-14229, protocol, dtc, rdtci]
description: "Sub-function 0x01, 0x05, 0x07-0x0E, 0x0F-0x13, 0x14-0x19, 0x1B của SID 0x19 theo ISO 14229-1:2020."
permalink: /uds-sid-0x19-p2/
---

# UDS - SID 0x19: ReadDTCInformation (Part 2)

> Tài liệu này là phần tiếp theo của [SID 0x19 – Part 1](/uds-sid-0x19-p1/). SID `0x19`, RSID `0x59`, DTC Status Byte, DTCStatusAvailabilityMask, và NRC phổ biến đã được giải thích đầy đủ ở Part 1 — tham chiếu lại khi cần. Part 2 bao gồm **tất cả sub-function còn lại**: `0x01`, `0x05`, `0x07`–`0x0E`, `0x0F`–`0x13`, `0x14`–`0x19`, `0x1B`.

## Nhắc nhanh — Ký hiệu dùng xuyên suốt

| Ký hiệu | Giá trị |
|---|---|
| SID / RSID | `0x19` / `0x59` |
| NRC chính | `0x12` subFuncNotSupported · `0x13` wrongLength · `0x22` conditionsNotCorrect · `0x31` outOfRange |
| DTC | 3 byte: High–Mid–Low |
| StatusMask bit 3 | `0x08` = confirmedDTC |
| DTCFormatIdentifier | `0x01` ISO15031-6 · `0x02` ISO14229-1 · `0x03` SAE J1939 · `0x04` ISO11992 |

---

## 2. Sub-function 0x01 — reportNumberOfDTCByStatusMask

### 2.1 Định nghĩa

Đếm **số lượng** DTC khớp với `DTCStatusMask` — **không** trả danh sách DTC, chỉ trả số đếm. Dùng khi cần biết bao nhiêu DTC trước khi quyết định đọc full list bằng `0x02`, hoặc để tối ưu bus load.

### 2.2 Format Request

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | SID | `0x19` | |
| 2 | Sub-function | `0x01` | |
| 3 | DTCStatusMask | `0x01`–`0xFF` | Filter condition |

Độ dài: **3 byte** (fixed).

### 2.3 Format Positive Response

| Byte | Field | Mô tả |
|---|---|---|
| 1 | RSID | `0x59` |
| 2 | Sub-function | `0x01` |
| 3 | DTCStatusAvailabilityMask | Bits status server hỗ trợ |
| 4 | DTCFormatIdentifier | Chuẩn encoding DTC |
| 5–6 | DTCCount | 2-byte big-endian (0x0000–0xFFFF) |

### 2.4 Điều kiện Positive Response

1. Sub-function `0x01` hỗ trợ.
2. `DTCStatusMask ≠ 0x00`.
3. `DTCStatusMask AND DTCStatusAvailabilityMask ≠ 0x00`.
4. Message length = 3 byte.

### 2.5 Điều kiện Negative Response

| Điều kiện | NRC |
|---|---|
| `0x01` không hỗ trợ | `0x12` |
| Length ≠ 3 | `0x13` |
| `DTCStatusMask = 0x00` | `0x31` |
| Mask không overlap AvailabilityMask | `0x31` |

### 2.6 Trường hợp đặc biệt

1. **DTCCount = 0x0000**: Positive response — không có DTC khớp, không phải lỗi.
2. **DTCFormatIdentifier**: ECU theo ISO 14229-1 trả `0x02`. OBD-II trả `0x01` (SAE P/B/C/U encoding).
3. **Pair workflow**: Dùng `0x01` để pre-allocate buffer → sau đó dùng `0x02` để lấy list.

### 2.7 Ví dụ

**Positive — 3 DTC đang confirmed:**

```
REQUEST:
  19 01 08
            DTCStatusMask: 0x08 (confirmedDTC)

POSITIVE RESPONSE:
  59 01  FF  02  00 03
  ^^     ^^  ^^  ^^^^^
  RSID   AvM Fmt Count=3
  Sub    FF  ISO14229-1
```

**Positive — Không có DTC:**

```
REQUEST:  19 01 01
RESPONSE: 59 01  FF  02  00 00    (DTCCount = 0)
```

---

## 3. Sub-function 0x05 — reportDTCStoredDataByRecordNumber

### 3.1 Định nghĩa

Đọc snapshot data **theo record number** — trả về snapshot của **tất cả DTC** đang lưu record đó. Quan hệ với `0x04`:

| | 0x04 | 0x05 |
|---|---|---|
| Input | DTC cụ thể | Record Number cụ thể |
| Output | Tất cả records của DTC đó | Tất cả DTC có record đó |

### 3.2 Format Request

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | SID | `0x19` | |
| 2 | Sub-function | `0x05` | |
| 3 | DTCStoredDataRecordNumber | `0x01`–`0xFE` | Record number cần đọc |

Độ dài: **3 byte**. `0x00` và `0xFF` không hợp lệ → NRC `0x31`.

### 3.3 Format Positive Response

| Nhóm | Byte | Field | Mô tả |
|---|---|---|---|
| Header | 1 | RSID | `0x59` |
| | 2 | Sub-function | `0x05` |
| | 3 | DTCStoredDataRecordNumber | Echo |
| Per DTC block | 4 | RecordNumber | Record number (echo) |
| | 5–7 | DTC | 3-byte DTC |
| | 8 | StatusOfDTC | Status **hiện tại** DTC |
| | 9 | NumberOfIdentifiers | Số DID trong snapshot |
| Per DID | 10–11 | DataIdentifier | 2-byte DID |
| | 12–N | Data | Dữ liệu DID |
| | ... | | Lặp DID |
| | ... | | Lặp DTC block |

### 3.4 Điều kiện Positive Response

1. Sub-function `0x05` hỗ trợ.
2. RecordNumber ∈ [0x01, 0xFE].
3. Ít nhất 1 DTC có lưu record đó.

### 3.5 Điều kiện Negative Response

| Điều kiện | NRC |
|---|---|
| `0x05` không hỗ trợ | `0x12` |
| Length ≠ 3 | `0x13` |
| RecordNumber = `0x00` hoặc `0xFF` | `0x31` |
| **Không có DTC nào có record đó** | `0x31` |

> **Lưu ý khác với `0x04`**: Với `0x04`, DTC tồn tại nhưng chưa có snapshot → positive response. Với `0x05`, không có DTC nào có record → NRC `0x31`.

### 3.6 Ví dụ

**Positive — 2 DTC có snapshot record 0x01:**

```
REQUEST:
  19 05 01
          RecordNumber: 0x01

POSITIVE RESPONSE:
  59 05  01
              ← Header
  01  0A 1B 16  2C  02  F1 90 [17B VIN]  F1 95 01
  ^^  ^^^^^^^^  ^^  ^^  ...............  ^^^^^  ^^
  Rec DTC#1     St  #ID DID1 data        DID2   data

  01  06 78 9A  09  01  F1 91 [4B]
  Rec DTC#2     St  1×  DID  data
```

---

## 4. Sub-function 0x07 — reportNumberOfDTCBySeverityMaskRecord

### 4.1 Định nghĩa

Đếm số DTC khớp đồng thời `DTCStatusMask` **và** `DTCSeverityMask`. Analog với `0x01` nhưng bổ sung điều kiện severity (WHO-OBD Type A/B/C).

### 4.2 Format Request

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | SID | `0x19` | |
| 2 | Sub-function | `0x07` | |
| 3 | DTCSeverityMask | `0x20`/`0x40`/`0x80`/combined | Loại severity |
| 4 | DTCStatusMask | `0x01`–`0xFF` | DTC status filter |

Độ dài: **4 byte**. **Thứ tự**: SeverityMask **trước** StatusMask — ngược với `0x42`.

### 4.3 Format Positive Response

| Byte | Field | Mô tả |
|---|---|---|
| 1 | RSID | `0x59` |
| 2 | Sub-function | `0x07` |
| 3 | DTCStatusAvailabilityMask | |
| 4 | DTCSeverityAvailabilityMask | Severity bits hỗ trợ |
| 5 | DTCFormatIdentifier | |
| 6–7 | DTCCount | 2-byte big-endian |

### 4.4 Điều kiện Positive/Negative

**Positive**: server hỗ trợ severity classification, cả 2 mask ≠ 0x00, length = 4.

| Điều kiện | NRC |
|---|---|
| Không hỗ trợ severity | `0x12` |
| Length ≠ 4 | `0x13` |
| Mask = `0x00` hoặc không overlap | `0x31` |

### 4.5 Ví dụ

**Positive — Đếm DTC Type A (nguy hiểm nhất) đang confirmed:**

```
REQUEST:
  19 07  80  08
         ^^  ^^ SeverityMask: 0x80 (Type A), StatusMask: 0x08 (confirmed)

POSITIVE RESPONSE:
  59 07  FF  E0  02  00 01
  ^^     ^^  ^^  ^^  ^^^^^
  RSID   StA SvA Fmt Count=1 (1 Type A DTC confirmed)
```

---

## 5. Sub-function 0x08 — reportDTCBySeverityMaskRecord

### 5.1 Định nghĩa

Lấy **danh sách** DTC theo severity + status mask. Analog với `0x02` nhưng thêm severity filter. Response có thêm trường **DTCSeverityMask** và **DTCFunctionalUnit** cho mỗi DTC.

### 5.2 Format Request

| Byte | Field | Giá trị |
|---|---|---|
| 1 | SID | `0x19` |
| 2 | Sub-function | `0x08` |
| 3 | DTCSeverityMask | |
| 4 | DTCStatusMask | |

Độ dài: **4 byte**.

### 5.3 Format Positive Response

| Byte | Field | Mô tả |
|---|---|---|
| 1 | RSID | `0x59` |
| 2 | Sub-function | `0x08` |
| 3 | DTCStatusAvailabilityMask | |
| 4–6 | DTC #n | 3-byte |
| 7 | DTCSeverityMask #n | Severity của DTC này |
| 8 | DTCFunctionalUnit #n | OBD functional category |
| 9 | StatusOfDTC #n | |
| ... | | Lặp |

**List rỗng**: Positive response `59 08 [AvailMask]` — không phải NRC.

### 5.4 Ví dụ

**Positive — Type A và Type B, confirmed:**

```
REQUEST:
  19 08  C0  08
         ^^  ^^ Sev: 0xC0 (Type A|B), Status: 0x08 (confirmed)

POSITIVE RESPONSE:
  59 08  FF  0A 1B 16  80  05  08   06 78 9A  40  02  08
  ^^     ^^  ^^^^^^^^  ^^  ^^  ^^   ^^^^^^^^  ^^  ^^  ^^
  RSID   AvM DTC#1     Sv  FU  St   DTC#2     Sv  FU  St
         FF  0x0A1B16  TypeA 05 ok   0x06789A  TypeB 02 ok
```

---

## 6. Sub-function 0x09 — reportSeverityInformationOfDTC

### 6.1 Định nghĩa

Trả về **severity classification** của **một DTC cụ thể**. Dùng sau khi scan bằng `0x02` (list không có severity) và cần biết severity của 1 DTC particular.

### 6.2 Format Request

| Byte | Field | Giá trị |
|---|---|---|
| 1 | SID | `0x19` |
| 2 | Sub-function | `0x09` |
| 3 | DTCHighByte | |
| 4 | DTCMiddleByte | |
| 5 | DTCLowByte | |

Độ dài: **5 byte**.

### 6.3 Format Positive Response

| Byte | Field | Mô tả |
|---|---|---|
| 1 | RSID | `0x59` |
| 2 | Sub-function | `0x09` |
| 3 | DTCStatusAvailabilityMask | |
| 4–6 | DTC | Echo |
| 7 | DTCSeverityMask | Severity của DTC này |
| 8 | DTCFunctionalUnit | Functional category |
| 9 | StatusOfDTC | Trạng thái hiện tại |

### 6.4 Điều kiện Positive/Negative

| Điều kiện | NRC |
|---|---|
| `0x09` không hỗ trợ | `0x12` |
| Length ≠ 5 | `0x13` |
| DTC không tồn tại | `0x31` |
| DTC tồn tại nhưng không có severity info | `0x31` |

### 6.5 Ví dụ

```
REQUEST:
  19 09  0A 1B 16

POSITIVE RESPONSE:
  59 09  FF  0A 1B 16  80  05  08
  ^^     ^^  ^^^^^^^^  ^^  ^^  ^^
  RSID   AvM DTC       Sv  FU  St
         FF  0x0A1B16  TypeA Cat5 confirmed
```

---

## 7. Sub-function 0x0A — reportSupportedDTCs

### 7.1 Định nghĩa

Trả về **toàn bộ danh sách DTC được cấu hình** trên server — bao gồm DTC chưa từng xảy ra (status = `0x00`). Đây là "DTC catalog" đầy đủ của ECU.

Ứng dụng:
- **EOL testing**: Verify ECU có đúng DTC list theo spec.
- **Test tool**: Biết trước tất cả DTC ECU có thể phát.
- **OBD scan tool**: Lấy complete inventory.

### 7.2 Format Request

| Byte | Field | Giá trị |
|---|---|---|
| 1 | SID | `0x19` |
| 2 | Sub-function | `0x0A` |

Độ dài: **2 byte** (không có parameter).

### 7.3 Format Positive Response

| Byte | Field | Mô tả |
|---|---|---|
| 1 | RSID | `0x59` |
| 2 | Sub-function | `0x0A` |
| 3 | DTCStatusAvailabilityMask | |
| 4–6 | DTC #n | 3-byte DTC |
| 7 | StatusOfDTC #n | `0x00` nếu chưa xảy ra |
| ... | | Lặp |

### 7.4 Điều kiện Positive/Negative

| Điều kiện | NRC |
|---|---|
| `0x0A` không hỗ trợ | `0x12` |
| Length ≠ 2 | `0x13` |

### 7.5 Trường hợp đặc biệt

1. **Status = 0x00**: DTC trong catalog nhưng chưa từng xảy ra.
2. **Response lớn**: ECU có thể có hàng trăm DTC → CanTp multi-frame là bắt buộc.
3. **Khác `0x02`**: `0x0A` không filter theo status — trả **tất cả**. `0x02` chỉ trả DTC khớp mask.

### 7.6 Ví dụ

```
REQUEST:  19 0A

POSITIVE RESPONSE:
  59 0A  FF  0A 1B 16  09  06 78 9A  00  0C 2D 10  00  FF 00 01  00  ...
  ^^     ^^  ^^^^^^^^  ^^  ^^^^^^^^  ^^  ^^^^^^^^  ^^  ^^^^^^^^  ^^
  RSID   AvM DTC#1     St  DTC#2     St  DTC#3     St  DTC#4     St
             0x0A1B16  active         unconfigured   unconfigured
```

---

## 8. Sub-functions 0x0B–0x0E — Single-DTC Reporters

### 8.1 Mô tả chung

Bốn sub-function trả về **đúng 1 DTC** đại diện theo tiêu chí:

| Sub-fn | Tên | DTC được chọn |
|---|---|---|
| `0x0B` | reportFirstTestFailedDTC | DTC **đầu tiên** có `testFailed` bit set |
| `0x0C` | reportFirstConfirmedDTC | DTC **đầu tiên** được confirmed |
| `0x0D` | reportMostRecentTestFailedDTC | DTC **gần đây nhất** có `testFailed` set |
| `0x0E` | reportMostRecentConfirmedDTC | DTC **gần đây nhất** được confirmed |

**"First"** = timestamp / sequence sớm nhất trong event memory → thường là **root cause candidate**.  
**"Most Recent"** = timestamp / sequence gần nhất → thường là **latest fault**.

### 8.2 Format Request (chung cho 0x0B–0x0E)

| Byte | Field | Giá trị |
|---|---|---|
| 1 | SID | `0x19` |
| 2 | Sub-function | `0x0B` / `0x0C` / `0x0D` / `0x0E` |

Độ dài: **2 byte** (không có parameter).

### 8.3 Format Positive Response

| Byte | Field | Mô tả |
|---|---|---|
| 1 | RSID | `0x59` |
| 2 | Sub-function | |
| 3 | DTCStatusAvailabilityMask | |
| 4–6 | DTC | 3-byte |
| 7 | StatusOfDTC | Trạng thái **hiện tại** |

**Không có DTC** thỏa điều kiện → response chỉ **3 byte**: `59 [subfn] [AvailMask]`.

### 8.4 Điều kiện Positive/Negative

| Điều kiện | NRC |
|---|---|
| Sub-function không hỗ trợ | `0x12` |
| Length ≠ 2 | `0x13` |

**Không phải NRC**: Memory trống → `59 [subfn] [AvailMask]` (positive, 3 byte, không có DTC body).

### 8.5 Trường hợp đặc biệt

1. **Response không có DTC**: 3-byte positive response — không phải lỗi.
2. **Ordering**: Thứ tự "first/most recent" dựa vào timestamp/sequence number trong AUTOSAR Dem event memory. Sau `ClearDTC` — counter reset về 0, DTC tiếp theo xảy ra sẽ là "first".
3. **Root cause analysis**: `0x0C` (first confirmed) + `0x0E` (most recent confirmed) → nếu hai DTC khác nhau, DTC của `0x0C` là ứng viên root cause.

### 8.6 Ví dụ

**0x0C — First Confirmed DTC:**

```
REQUEST:
  19 0C

POSITIVE RESPONSE — Có DTC:
  59 0C  FF  0A 1B 16  2C
  ^^     ^^  ^^^^^^^^  ^^
  RSID   AvM DTC       Status 0x2C (PDTC+CDTC+TFSLC)

POSITIVE RESPONSE — Không có DTC confirmed:
  59 0C  FF
         ^^ AvailMask, không có body (memory empty)
```

**0x0E — Most Recent Confirmed:**

```
REQUEST:  19 0E
RESPONSE: 59 0E  FF  06 78 9A  09
                     ^^^^^^^^  ^^
                     Link nhất confirmed: 0x06789A, status 0x09
```

---

## 9. Sub-functions 0x0F, 0x10, 0x11 — Mirror Memory

### 9.1 Khái niệm Mirror Memory

**Mirror Memory** là bản sao (snapshot) của primary DTC memory, dùng cho **OBD readout** tại các thời điểm cố định (thường cuối drive cycle). Mirror memory **không bị xóa** khi xóa primary memory.

| | Primary Memory | Mirror Memory |
|---|---|---|
| Đọc bằng | `0x02`, `0x04`, `0x06` | `0x0F`, `0x10`, `0x11` |
| Xóa bằng | `0x14` ClearDTC | Không thể xóa thủ công |
| Cập nhật | Real-time | Tại drive cycle end / OBD trigger |

---

### 9.2 Sub-function 0x0F — reportMirrorMemoryDTCByStatusMask

**Định nghĩa**: Analog `0x02` nhưng đọc từ **mirror memory**.

**Format Request:**

```
19 0F [DTCStatusMask]    ← 3 byte
```

**Format Positive Response:**

```
59 0F [DTCStatusAvailabilityMask] [DTC1 3B] [Status1] [DTC2 3B] [Status2] ...
```

**Điều kiện / NRC**: Giống `0x02`. List rỗng → positive `59 0F [AvailMask]`.

---

### 9.3 Sub-function 0x10 — reportMirrorMemoryDTCExtDataRecordByDTCNumber

**Định nghĩa**: Analog `0x06` nhưng đọc extended data từ **mirror memory**.

**Format Request:**

```
19 10 [DTC 3B] [ExtDataRecordNumber]    ← 6 byte
```

**Format Positive Response**: Giống `0x06` response format (header + ext data records).

**NRC `0x31`**: DTC không tồn tại trong mirror memory (khác với primary).

---

### 9.4 Sub-function 0x11 — reportNumberOfMirrorMemoryDTCByStatusMask

**Định nghĩa**: Analog `0x01` nhưng đếm trong **mirror memory**.

**Format Request:**

```
19 11 [DTCStatusMask]    ← 3 byte
```

**Format Positive Response:**

```
59 11 [DTCStatusAvailabilityMask] [DTCFormatIdentifier] [DTCCount 2B]
```

---

### 9.5 Ví dụ (0x0F)

**Positive — Confirmed DTCs trong mirror memory:**

```
REQUEST:
  19 0F 08

POSITIVE RESPONSE:
  59 0F  FF  0A 1B 16  08   06 78 9A  08
  ^^     ^^  ^^^^^^^^  ^^   ^^^^^^^^  ^^
  RSID   AvM DTC#1     St   DTC#2     St
```

**Negative — DTC tồn tại trong primary nhưng không có trong mirror:**

```
REQUEST (ext data từ mirror):  19 10  0A 1B 16  01
RESPONSE:  7F 19 31   (DTC không có trong mirror memory)
```

---

## 10. Sub-functions 0x12, 0x13, 0x15 — OBD / Emission Memory

### 10.1 Khái niệm Emission OBD Memory

Subset DTC liên quan đến **phát thải** theo chuẩn OBD-II / EOBD. DTC encoding dùng ISO 15031-6 (P0xxx, P1xxx, B, C, U codes).

---

### 10.2 Sub-function 0x12 — reportNumberOfEmissionsOBDDTCByStatusMask

**Định nghĩa**: Đếm số DTC emission khớp status mask.

**Format Request:**

```
19 12 [DTCStatusMask]    ← 3 byte
```

**Format Positive Response:**

```
59 12 [DTCStatusAvailabilityMask] [DTCFormatIdentifier=0x01] [DTCCount 2B]
```

`DTCFormatIdentifier = 0x01` (ISO 15031-6) cho emission OBD.

---

### 10.3 Sub-function 0x13 — reportEmissionsOBDDTCByStatusMask

**Định nghĩa**: Lấy **danh sách** DTC emission khớp status mask.

**Format Request:**

```
19 13 [DTCStatusMask]    ← 3 byte
```

**Format Positive Response:**

```
59 13 [DTCStatusAvailabilityMask] [DTC1 3B] [Status1] [DTC2 3B] [Status2] ...
```

Với OBD-II DTC encoding theo ISO 15031-6: byte cao bit 7–6 = category (P=00, C=01, B=10, U=11).

---

### 10.4 Sub-function 0x15 — reportDTCWithPermanentStatus

**Định nghĩa**: Trả về **Permanent DTC** theo **OBD-II standard**. Khác với `0x55` (WWH-OBD):

| | `0x15` | `0x55` |
|---|---|---|
| Chuẩn | OBD-II / EOBD | WWH-OBD (ISO 27145) |
| Response thêm | DTC + Status | DTC + Severity + FunctionalUnit + Status |
| Áp dụng | Xe con, xe nhẹ | Xe hạng nặng |

Permanent DTC (OBD-II): DTC confirmed + MIL bật. Tự xóa sau ≥ 2 drive cycles không lỗi + OBD readiness pass.

**Format Request:**

```
19 15    ← 2 byte
```

**Format Positive Response:**

```
59 15 [DTCStatusAvailabilityMask] [DTC1 3B] [Status1] [DTC2 3B] [Status2] ...
```

**Response rỗng** (`59 15 [AvailMask]`): Không có permanent DTC — positive response.

---

### 10.5 Ví dụ (0x13 — Emission OBD DTCs)

```
REQUEST:
  19 13 09    (testFailed + confirmed)

POSITIVE RESPONSE:
  59 13  FF  43 17 00  09
  ^^     ^^  ^^^^^^^^  ^^
  RSID   AvM DTC       Status
             0x431700  0x09 (TF+CDTC)

  Decode 0x431700 theo ISO 15031-6:
    Byte 0 = 0x43 = 0b01000011 → category bits [7:6] = 01 = Chassis (C)
    → DTC: C1700 (ví dụ ABS related)
```

---

## 11. Sub-function 0x14 — reportDTCFaultDetectionCounter

### 11.1 Định nghĩa

Trả về **Fault Detection Counter (FDC)** hiện tại cho tất cả DTC đang được **giám sát tích cực** (FDC đang tăng/giảm, ≠ giá trị khởi tạo). Không cần chỉ định DTC — server tự liệt kê.

FDC là chỉ số trung gian: cho biết DTC "gần tới ngưỡng confirmed bao nhiêu" mà không cần chờ confirmed thực sự.

### 11.2 FDC Encoding

| FDC (signed byte) | Ý nghĩa |
|---|---|
| `0x7F` (+127) | Fully qualified failed — DTC confirmed |
| `0x01`–`0x7E` | Progressing toward fail (tăng dần) |
| `0x00` | Neutral / không active |
| `0xFF`–`0x81` | Recovering (-1 đến -127) |
| `0x80` (−128) | Fully qualified passed — DTC healed |

### 11.3 Format Request

| Byte | Field | Giá trị |
|---|---|---|
| 1 | SID | `0x19` |
| 2 | Sub-function | `0x14` |

Độ dài: **2 byte**.

### 11.4 Format Positive Response

| Byte | Field | Mô tả |
|---|---|---|
| 1 | RSID | `0x59` |
| 2 | Sub-function | `0x14` |
| 3–5 | DTC #n | 3-byte |
| 6 | DTCFaultDetectionCounter #n | Signed byte |
| ... | | Lặp |

**Response rỗng** (`59 14`): Không có DTC nào đang active monitoring.

### 11.5 Điều kiện Positive/Negative

| Điều kiện | NRC |
|---|---|
| `0x14` không hỗ trợ | `0x12` |
| Length ≠ 2 | `0x13` |

### 11.6 Trường hợp đặc biệt

1. **FDC = +127 nhưng DTC chưa confirmed**: Có thể xảy ra khi DTC vừa đạt ngưỡng nhưng chưa qua confirmation cycle.
2. **FDC decreasing**: Monitor đang pass → FDC giảm. Khi về −128 (0x80) → DTC healed, sẽ bắt đầu aging.
3. **DTC không xuất hiện**: Nếu DTC đang completely idle (FDC = neutral initial value, không được test trong chu kỳ này) → không xuất hiện trong response.

### 11.7 Ví dụ

**Positive — 3 DTC đang được tracked:**

```
REQUEST:  19 14

POSITIVE RESPONSE:
  59 14  0A 1B 16  7F   06 78 9A  32   0C 2D 10  B0
         ^^^^^^^^  ^^   ^^^^^^^^  ^^   ^^^^^^^^  ^^
         DTC#1     FDC  DTC#2     FDC  DTC#3     FDC
         0x0A1B16 +127  0x06789A  +50  0x0C2D10  -80

  DTC 0x0A1B16: FDC=+127 → confirmed (failed)
  DTC 0x06789A: FDC=+50  → progressing, chưa confirmed
  DTC 0x0C2D10: FDC=-80  → recovering (đang pass)
```

---

## 12. Sub-function 0x16 — reportDTCExtDataRecordByRecordNumber

### 12.1 Định nghĩa

Đọc extended data **theo record number** — trả về ext data của **tất cả DTC** có lưu record đó. Quan hệ:

| | `0x06` | `0x16` |
|---|---|---|
| Input | DTC cụ thể | Record Number cụ thể |
| Output | All ext records của DTC đó | All DTC có record đó |

### 12.2 Format Request

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | SID | `0x19` | |
| 2 | Sub-function | `0x16` | |
| 3 | DTCExtDataRecordNumber | `0x01`–`0xEF` | Record number |

Độ dài: **3 byte**. `0xFF`, `0x00`, range `0xF0–0xFE` không hợp lệ → NRC `0x31`.

### 12.3 Format Positive Response

```
59 16 [RecordNumber]
  [DTC1 3B] [Status1] [RecordNumber] [ExtData_DTC1...]
  [DTC2 3B] [Status2] [RecordNumber] [ExtData_DTC2...]
  ...
```

### 12.4 Điều kiện Positive/Negative

| Điều kiện | NRC |
|---|---|
| `0x16` không hỗ trợ | `0x12` |
| Length ≠ 3 | `0x13` |
| RecordNumber = `0x00`, `0xF0–0xFF` | `0x31` |
| Không có DTC nào có record đó | `0x31` |

### 12.5 Ví dụ

```
REQUEST:
  19 16 01    (ext record 0x01 của tất cả DTC)

POSITIVE RESPONSE:
  59 16  01
  0A 1B 16  0D  01  7F 03
  ^^^^^^^^  ^^  ^^  ^^^^^
  DTC#1     St  Rec ExtData: FDC=+127, Occ=3

  06 78 9A  09  01  32 01
  ^^^^^^^^  ^^  ^^  ^^^^^
  DTC#2     St  Rec ExtData: FDC=+50,  Occ=1
```

---

## 13. Sub-functions 0x17, 0x18, 0x19 — User-Defined Memory

### 13.1 Khái niệm User-Defined Memory

ISO 14229-1 cho phép ECU có thêm **DTC memory banks** tùy chỉnh do OEM định nghĩa. Truy cập qua tham số `memorySelection` (1 byte thêm vào cuối request).

| Parameter | Ý nghĩa |
|---|---|
| `memorySelection = 0x01`–`0xFE` | Index của memory bank (OEM-defined) |
| Primary Memory | Không cần `memorySelection` |
| User-Defined | Cần `memorySelection` |

---

### 13.2 Sub-function 0x17 — reportUserDefMemoryDTCByStatusMask

**Định nghĩa**: Analog `0x02` nhưng từ user-defined memory.

**Format Request:**

```
19 17 [DTCStatusMask] [memorySelection]    ← 4 byte
```

**Format Positive Response:**

```
59 17 [DTCStatusAvailabilityMask] [DTC1 3B] [Status1] ...
```

---

### 13.3 Sub-function 0x18 — reportUserDefMemoryDTCSnapshotRecordByDTCNumber

**Định nghĩa**: Analog `0x04` nhưng từ user-defined memory.

**Format Request:**

```
19 18 [DTC 3B] [DTCSnapshotRecordNumber] [memorySelection]    ← 7 byte
```

**Format Positive Response**: Giống `0x04` response.

---

### 13.4 Sub-function 0x19 — reportUserDefMemoryDTCExtDataRecordByDTCNumber

**Định nghĩa**: Analog `0x06` nhưng từ user-defined memory.

**Format Request:**

```
19 19 [DTC 3B] [DTCExtDataRecordNumber] [memorySelection]    ← 7 byte
```

**Format Positive Response**: Giống `0x06` response.

---

### 13.5 NRC chung cho 0x17/0x18/0x19

| Điều kiện | NRC |
|---|---|
| Sub-function không hỗ trợ | `0x12` |
| Sai length | `0x13` |
| `memorySelection` không tồn tại trên server | `0x31` |
| DTC không tồn tại trong memory đó | `0x31` |

### 13.6 Ví dụ (0x17 và 0x18)

**0x17 — DTCs confirmed trong user memory bank 0x01:**

```
REQUEST:
  19 17 08 01
           ^^ memorySelection: bank 0x01

POSITIVE RESPONSE:
  59 17  FF  0A 1B 16  08   06 78 9A  08
```

**0x18 — Snapshot của DTC trong user memory bank 0x02:**

```
REQUEST:
  19 18  0A 1B 16  01  02
                   ^^  ^^
                   Rec MemSel

POSITIVE RESPONSE (giống format 0x04):
  59 18  0A 1B 16  0D  01  02  F1 90 [17B]  F1 95 01
```

---

## 14. Sub-function 0x1B — reportDTCWithNoExtendedDataRecord

### 14.1 Định nghĩa

**(Mới trong ISO 14229-1:2020)** Trả về danh sách DTC **không có** extended data record được định nghĩa hoặc chưa có data được lưu. Chủ yếu dùng cho:

- **QA / EOL testing**: Xác nhận rằng tất cả DTC có extended data cấu hình đúng như spec.
- **Audit**: Phát hiện DTC missing extended data configuration.

### 14.2 Format Request

| Byte | Field | Giá trị |
|---|---|---|
| 1 | SID | `0x19` |
| 2 | Sub-function | `0x1B` |
| 3 | DTCStatusMask | Filter theo status |

Độ dài: **3 byte**.

### 14.3 Format Positive Response

```
59 1B [DTCStatusAvailabilityMask] [DTC1 3B] [Status1] [DTC2 3B] [Status2] ...
```

Chỉ liệt kê DTC thỏa `DTCStatusMask` **VÀ** không có extended data record được lưu.

### 14.4 Điều kiện Positive/Negative

| Điều kiện | NRC |
|---|---|
| `0x1B` không hỗ trợ (chuẩn trước 2020) | `0x12` |
| Length ≠ 3 | `0x13` |
| `DTCStatusMask = 0x00` | `0x31` |

### 14.5 Ví dụ

**Positive — DTC không có ext data (QA check):**

```
REQUEST:
  19 1B FF    (tất cả DTC, kiểm tra ai không có ext data)

POSITIVE RESPONSE:
  59 1B  FF  0C 2D 10  00   FF 00 01  00
  ^^     ^^  ^^^^^^^^  ^^   ^^^^^^^^  ^^
  RSID   AvM DTC#1     St   DTC#2     St
             0x0C2D10  00   0xFF0001  00
             (cả hai chưa xảy ra và không có ext data record)
```

---

## 15. Tóm tắt toàn bộ SID 0x19

| Sub-fn | Tên | Params | Memory Target |
|---|---|---|---|
| `0x01` | reportNumberOfDTCByStatusMask | StatusMask | Primary |
| `0x02`★ | reportDTCByStatusMask | StatusMask | Primary |
| `0x03`★ | reportDTCSnapshotIdentification | — | Primary |
| `0x04`★ | reportDTCSnapshotRecordByDTCNumber | DTC+RecNr | Primary |
| `0x05` | reportDTCStoredDataByRecordNumber | RecNr | Primary |
| `0x06`★ | reportDTCExtDataRecordByDTCNumber | DTC+RecNr | Primary |
| `0x07` | reportNumberOfDTCBySeverityMaskRecord | SevMask+StMask | Primary |
| `0x08` | reportDTCBySeverityMaskRecord | SevMask+StMask | Primary |
| `0x09` | reportSeverityInformationOfDTC | DTC | Primary |
| `0x0A` | reportSupportedDTCs | — | Config (all) |
| `0x0B` | reportFirstTestFailedDTC | — | Primary |
| `0x0C` | reportFirstConfirmedDTC | — | Primary |
| `0x0D` | reportMostRecentTestFailedDTC | — | Primary |
| `0x0E` | reportMostRecentConfirmedDTC | — | Primary |
| `0x0F` | reportMirrorMemoryDTCByStatusMask | StatusMask | Mirror |
| `0x10` | reportMirrorMemoryDTCExtDataRecordByDTCNumber | DTC+RecNr | Mirror |
| `0x11` | reportNumberOfMirrorMemoryDTCByStatusMask | StatusMask | Mirror |
| `0x12` | reportNumberOfEmissionsOBDDTCByStatusMask | StatusMask | OBD |
| `0x13` | reportEmissionsOBDDTCByStatusMask | StatusMask | OBD |
| `0x14` | reportDTCFaultDetectionCounter | — | Active monitors |
| `0x15` | reportDTCWithPermanentStatus | — | Permanent (OBD-II) |
| `0x16` | reportDTCExtDataRecordByRecordNumber | RecNr | Primary |
| `0x17` | reportUserDefMemoryDTCByStatusMask | StMask+MemSel | User-defined |
| `0x18` | reportUserDefMemoryDTCSnapshotRecordByDTCNumber | DTC+RecNr+MemSel | User-defined |
| `0x19` | reportUserDefMemoryDTCExtDataRecordByDTCNumber | DTC+RecNr+MemSel | User-defined |
| `0x1A`★ | reportSupportedDTCExtDataRecord | RecNr | Config |
| `0x1B` | reportDTCWithNoExtendedDataRecord | StatusMask | Primary |
| `0x42`★ | reportWWHOBDDTCByMaskRecord | StMask+SevMask | Primary (WWH) |
| `0x55`★ | reportWWHOBDDTCWithPermanentStatus | — | Permanent (WWH) |
| `0x56`★ | reportDTCInformationByDTCReadinessGroupIdentifier | GroupID | OBD Group |

★ = Được trình bày chi tiết trong [Part 1](/uds-sid-0x19-p1/)
