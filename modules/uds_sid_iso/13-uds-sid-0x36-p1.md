---
layout: default
category: uds
title: "UDS - Service ID 0x36 TransferData (Part 1)"
nav_exclude: true
module: true
tags: [autosar, uds, diagnostics, iso-14229, protocol, download, upload, transfer, blocksequence]
description: "SID 0x36 TransferData – tổng quan, request/response format, blockSequenceCounter rules (wrap 0xFF→0x00, retransmit detection), transferRequestParameterRecord, NRC đầy đủ theo ISO 14229-1:2020."
permalink: /uds/uds-sid-0x36-p1/
---

# UDS - SID 0x36: TransferData (Part 1)

> **Tài liệu chuẩn:** ISO 14229-1:2020, Clause 14.3 — Upload/Download functional unit.  
> **Phạm vi:** SID `0x36` là service duy nhất truyền dữ liệu thực sự trong luồng upload/download. Được gọi sau SID `0x34` (RequestDownload) hoặc SID `0x35` (RequestUpload), và trước SID `0x37` (RequestTransferExit). Không có sub-function byte. Part 2 trình bày chế độ Upload (0x35 → 0x36), xử lý lỗi mid-transfer, và AUTOSAR Dcm callbacks.

---

## 1. Tổng quan SID 0x36

### 1.1 Vai trò trong Upload/Download Unit

SID `0x36` là service **trung tâm** của mọi quá trình truyền dữ liệu giữa client và server. Được thiết kế để hoạt động trong **hai hướng**:

| Hướng | Precondition | Dữ liệu trong 0x36 request | Dữ liệu trong 0x76 response |
|---|---|---|---|
| **Download** (client → server) | Sau SID `0x34` | `transferRequestParameterRecord` chứa dữ liệu ghi | `transferResponseParameterRecord` thường rỗng |
| **Upload** (server → client) | Sau SID `0x35` | `transferRequestParameterRecord` thường rỗng | `transferResponseParameterRecord` chứa dữ liệu đọc |

Mỗi lần gọi 0x36 truyền **một block** dữ liệu, được đánh số bằng `blockSequenceCounter`. Server kiểm tra counter này để đảm bảo không mất block hoặc ghi trùng.

### 1.2 Vị trí trong chuỗi transfer

```
[0x10 – Programming Session]
        │
        ▼
[0x27 – SecurityAccess (seed + key)]
        │
        ▼
[0x34 – RequestDownload]  hoặc  [0x35 – RequestUpload]
        │                               │
        ▼                               ▼
[0x36 – TransferData block 01]  (lặp lại cho mỗi block)
[0x36 – TransferData block 02]
        ...
[0x36 – TransferData block N]
        │
        ▼
[0x37 – RequestTransferExit]
```

### 1.3 Các thông số định danh service

| Thuộc tính | Giá trị |
|---|---|
| Service ID (SID) | `0x36` |
| Response SID (RSID) | `0x76` |
| Negative Response SID | `0x7F` |
| Sub-function | **Không có** |
| suppressPosRspMsgIndicationBit | **Không áp dụng** |
| Default Session (0x01) | **Không hỗ trợ** |
| Programming Session (0x02) | **Hỗ trợ** (download và upload) |
| Extended Session (0x03) | Tùy OEM |

### 1.4 NRC tổng quan

| NRC | Tên | Điều kiện kích hoạt |
|---|---|---|
| `0x13` | incorrectMessageLengthOrInvalidFormat | Request < 2 byte, hoặc data vượt quá `maxNumberOfBlockLength` |
| `0x22` | conditionsNotCorrect | Gọi 0x36 khi không có transfer đang active (chưa gọi 0x34/0x35, hoặc đã gọi 0x37) |
| `0x31` | requestOutOfRange | Tổng byte gửi vượt `memorySize` đã khai báo trong 0x34/0x35 |
| `0x71` | transferDataSuspended | Server tạm dừng nhận dữ liệu (đang erase/write flash, tài nguyên bận) |
| `0x72` | generalProgrammingFailure | Flash write/read thất bại (ECC error, verify fail, hardware fault) |
| `0x73` | wrongBlockSequenceCounter | `blockSequenceCounter` không hợp lệ (không khớp expected, không phải retransmit) |
| `0x92` | voltageTooHigh | Điện áp cấp cho bộ nhớ flash quá cao |
| `0x93` | voltageTooLow | Điện áp quá thấp để lập trình flash |

> **Không có NRC `0x12`** — SID 0x36 không có sub-function nên `subFunctionNotSupported` không được phép.

---

## 2. Cấu trúc Request

### 2.1 Format Request — TransferData (Download mode)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x36` | TransferData |
| 2 | blockSequenceCounter | `0x00`–`0xFF` | Số thứ tự block (xem §2.2 và §2.3) |
| 3 đến N | transferRequestParameterRecord | Dữ liệu | Tối đa `maxNumberOfBlockLength − 2` byte (xem §2.4) |

**Độ dài request:**
- Tối thiểu: **2 byte** (SID + blockSeqCtr, không có data — hợp lệ cho upload request rỗng).
- Tối đa: `maxNumberOfBlockLength` byte (lấy từ response của 0x74 hoặc 0x75).
- Block cuối có thể nhỏ hơn `maxNumberOfBlockLength − 2` byte data.

### 2.2 blockSequenceCounter — Giá trị và quy tắc

#### Giá trị khởi tạo

```
Sau mỗi RequestDownload (0x34) hoặc RequestUpload (0x35) thành công:
  blockSequenceCounter của block ĐẦU TIÊN = 0x01
```

Mỗi lần gọi 0x34/0x35 mới đều reset counter về `0x01`, bất kể transfer trước đó.

#### Quy tắc tăng và wrap

```
Block 1  → blockSeqCtr = 0x01
Block 2  → blockSeqCtr = 0x02
...
Block 254 → blockSeqCtr = 0xFE
Block 255 → blockSeqCtr = 0xFF
Block 256 → blockSeqCtr = 0x00   ← WRAP: về 0x00, KHÔNG phải 0x01
Block 257 → blockSeqCtr = 0x01
Block 258 → blockSeqCtr = 0x02
...
```

**Công thức wrap chính xác (ISO 14229-1:2020):**

$$\text{blockSeqCtr}_{\text{next}} = (\text{blockSeqCtr}_{\text{current}} + 1) \mod 256$$

> **⚠️ Cạm bẫy:** Sau `0xFF` phải wrap về **`0x00`**, **không phải `0x01`**. Đây là lỗi implementation phổ biến nhất của SID 0x36, dẫn đến NRC `0x73` bắt đầu từ block thứ 256.

#### Bảng quy tắc blockSequenceCounter đầy đủ

| Tình huống | Giá trị gửi | Server xử lý |
|---|---|---|
| Block đầu tiên (sau 0x34/0x35 mới) | `0x01` | Normal — ghi/đọc dữ liệu, trả `0x76 0x01` |
| Block tiếp theo | `previousSeqCtr + 1` (mod 256) | Normal — ghi/đọc dữ liệu |
| Block 256 | `0x00` | Normal — ghi/đọc dữ liệu |
| Retransmit block trước | `expectedSeqCtr − 1` (mod 256) | **Positive response, không ghi lại** (xem §2.3) |
| Bất kỳ giá trị khác | Sai | NRC `0x73` |

### 2.3 Cơ chế Retransmit Detection

ISO 14229-1:2020, Clause 14.3 quy định: nếu client không nhận được `0x76` response, client có thể gửi lại block đó với cùng `blockSequenceCounter`. Server phát hiện đây là retransmit và **không ghi dữ liệu lại** — chỉ gửi lại positive response.

**Điều kiện nhận biết retransmit:**

$$\text{received counter} = (\text{expected counter} - 1) \mod 256$$

```
Ví dụ:
  Server đang chờ block 0x03 (expected = 0x03)
  Client gửi lại block 0x02 (received = 0x02 = expected - 1)
  → Server: RETRANSMIT detected → trả 0x76 0x02 mà không ghi lại dữ liệu
```

**Lưu ý quan trọng:**
- Retransmit chỉ được áp dụng cho **block ngay trước** (expected − 1). Server **không** hỗ trợ retransmit block cũ hơn.
- Retransmit detection chỉ hoạt động khi `received == expected − 1`. Mọi giá trị khác (kể cả expected − 2, expected − 3,…) → NRC `0x73`.

```
Sơ đồ retransmit:

  Client → 36 02 [data]    → Server ghi block 02
  Client ← 7F 36 ?? (timeout, response bị mất trên bus)
  Client → 36 02 [data]    → Server nhận lại: 02 = (03-1), RETRANSMIT
  Client ← 76 02            ← Server trả lại response mà không ghi lại
  Client → 36 03 [data]    → Server ghi block 03 (tiếp tục bình thường)
```

### 2.4 transferRequestParameterRecord

- **Độ dài:** 0 đến `maxNumberOfBlockLength − 2` byte.
- **Nội dung:** Dữ liệu cần ghi vào server (firmware, calibration data,…) trong chế độ download.
- **Chế độ upload:** Thường là **0 byte** (client không gửi data — chỉ cần counter).
- **Byte order:** Tùy nội dung ứng dụng (ISO 14229-1 không quy định nội dung; server tự diễn giải).
- **Block cuối:** Số byte = `memorySize mod (maxBlockLen − 2)`. Nếu chia hết → block cuối bằng maxBlockLen − 2.

**Kiểm tra độ dài:**

$$\text{length}(\text{transferRequestParameterRecord}) \leq \text{maxNumberOfBlockLength} - 2$$

Nếu vượt quá → NRC `0x13` (incorrectMessageLengthOrInvalidFormat).

---

## 3. Cấu trúc Positive Response

### 3.1 Format Positive Response — TransferData (0x76)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x76` | RSID của TransferData |
| 2 | blockSequenceCounter | Echo | Server echo lại `blockSequenceCounter` từ request |
| 3 đến N | transferResponseParameterRecord | Tùy OEM | Thường rỗng (download); chứa dữ liệu (upload) |

**Độ dài response:**
- **Download mode:** Thường **2 byte** (`0x76` + blockSeqCtr echo). `transferResponseParameterRecord` rỗng trừ khi OEM định nghĩa thêm (ví dụ: CRC của block vừa nhận).
- **Upload mode:** `2 + dữ liệu` byte — `transferResponseParameterRecord` chứa dữ liệu server gửi về client.

### 3.2 transferResponseParameterRecord (Download mode)

Trong download, field này thường **không có** (0 byte). Một số OEM mở rộng để:
- Trả về **checksum / CRC** của block vừa được ghi vào flash.
- Trả về **trạng thái verify** sau khi ghi (write-verify pass/fail).
- Trả về **địa chỉ thực tế** mà block được ghi (khi server tự quản lý địa chỉ).

Nếu OEM không định nghĩa, client **bỏ qua** mọi byte từ byte 3 trở đi trong response.

---

## 4. Điều kiện Positive/Negative Response

### 4.1 Điều kiện Positive Response

1. Đang có transfer active: đã gọi `0x34` (download) hoặc `0x35` (upload) và chưa gọi `0x37`.
2. Session hợp lệ: Programming Session (`0x02`) hoặc session được OEM cấu hình.
3. `blockSequenceCounter` hợp lệ: bằng expected counter **hoặc** bằng (expected − 1) mod 256 (retransmit).
4. Độ dài request: `2 ≤ length ≤ maxNumberOfBlockLength`.
5. Tổng byte đã gửi + block hiện tại ≤ `memorySize` (không vượt kích thước đã khai báo trong 0x34/0x35).
6. Server sẵn sàng nhận dữ liệu (không bận internal operation).
7. Điện áp cấp cho flash trong ngưỡng cho phép.

### 4.2 Điều kiện Negative Response chi tiết

| Điều kiện | NRC | Ghi chú |
|---|---|---|
| Request length < 2 byte | `0x13` | Ít nhất phải có SID + blockSeqCtr |
| Data length > `maxNumberOfBlockLength − 2` | `0x13` | Block lớn hơn server cho phép |
| Không có transfer đang active | `0x22` | Chưa gọi 0x34/0x35, hoặc đã kết thúc bằng 0x37 |
| Sai session (ví dụ Default Session 0x01) | `0x22` | ECU từ chối 0x36 ngoài Programming Session |
| Tổng byte đã nhận + block này > `memorySize` | `0x31` | Client gửi nhiều hơn đã khai báo |
| Server đang bận (erase flash, pending op) | `0x71` | `transferDataSuspended` — thử lại sau |
| Flash write thất bại (ECC, verify fail) | `0x72` | `generalProgrammingFailure` — transfer bị hủy |
| `blockSequenceCounter` sai (không phải expected, không phải retransmit) | `0x73` | `wrongBlockSequenceCounter` — transfer bị hủy |
| Điện áp VPP/VDD quá cao | `0x92` | `voltageTooHigh` |
| Điện áp VPP/VDD quá thấp | `0x93` | `voltageTooLow` |

**Sau NRC `0x72` hoặc `0x73`:** Transfer state bị hủy hoàn toàn. Client phải gọi lại `0x34`/`0x35` từ đầu. Không có cơ chế resume.

**Sau NRC `0x71`:** Client có thể thử gửi lại block đó sau một khoảng thời gian chờ. Transfer state vẫn còn hiệu lực.

---

## 5. Trường hợp đặc biệt

1. **Block cuối cùng nhỏ hơn maxBlockLen − 2**: Hoàn toàn hợp lệ. Client gửi đúng số byte còn lại. Server không yêu cầu padding.

2. **Retransmit của block 0xFF (wrap scenario)**: Block 255 có counter = `0xFF`. Nếu retransmit, client gửi lại `0xFF`. Server đang chờ `0x00` (expected = 0x00 = 0xFF + 1 mod 256). Server nhận `0xFF` = expected − 1 = `0x00 − 1 mod 256 = 0xFF` → đây là retransmit hợp lệ.

3. **Không dùng functional addressing (0x7DF)**: SID 0x36 phải gửi qua **physical addressing** (unicast). Gửi qua 0x7DF → NRC `0x22` hoặc ECU bỏ qua.

4. **transferRequestParameterRecord rỗng trong upload**: Trong upload mode, request chỉ có 2 byte (`0x36 blockSeqCtr`). ISO 14229-1:2020 cho phép điều này. Một số ECU yêu cầu đúng 2 byte, không hơn → NRC `0x13` nếu thêm byte thừa.

5. **maxNumberOfBlockLength từ 0x34 vs 0x35**: Server có thể trả về `maxNumberOfBlockLength` khác nhau cho download và upload cùng một vùng nhớ. Client phải dùng giá trị từ response của lần gọi gần nhất (0x34 hoặc 0x35).

6. **0x36 trước 0x34/0x35**: Nếu client gọi 0x36 khi không có transfer active → NRC `0x22`. Không có "implicit start" — phải luôn bắt đầu bằng 0x34/0x35.

7. **Hai segment liên tiếp**: Sau mỗi `0x37` (RequestTransferExit) thành công, transfer state reset. Lần `0x36` tiếp theo phải bắt đầu bằng `blockSeqCtr = 0x01` (sau `0x34`/`0x35` mới).

8. **Server gửi `0x78` (requestCorrectlyReceivedResponsePending)**: Server có thể trả `7F 36 78` nếu cần thêm thời gian xử lý (ví dụ: erase sector trong quá trình nhận block đầu tiên). Client giữ session alive và chờ response thực sự.

---

## 6. Ví dụ

### 6.1 Transfer bình thường — 3 block download (annotated hex)

**Setup**: `maxNumberOfBlockLength = 0x0082` = 130 byte → data/block = 128 byte. Firmware 384 byte → 3 block (128 + 128 + 128).

```
BLOCK 01 — bytes 0–127:

  REQUEST:
    36  01  [128 bytes data]
    ^^      SID: 0x36 (TransferData)
        ^^  blockSequenceCounter: 0x01 (block đầu tiên)
            ^^^^^^^^^^^^^^^^^^^^ transferRequestParameterRecord: 128 bytes firmware

  POSITIVE RESPONSE:
    76  01
    ^^      RSID: 0x76
        ^^  blockSequenceCounter: 0x01 (echo)
    (transferResponseParameterRecord: rỗng — download mode)


BLOCK 02 — bytes 128–255:

  REQUEST:
    36  02  [128 bytes data]
        ^^  blockSequenceCounter: 0x02

  POSITIVE RESPONSE:
    76  02


BLOCK 03 — bytes 256–383:

  REQUEST:
    36  03  [128 bytes data]
        ^^  blockSequenceCounter: 0x03

  POSITIVE RESPONSE:
    76  03
```

### 6.2 Retransmit detection — Response bị mất trên bus

```
STEP 1: Client gửi block 02 → Server ghi OK
  CLIENT → 36 02 [128B data]
  SERVER → 76 02
  (response bị mất – client không nhận được)

STEP 2: Client timeout → gửi lại block 02 (RETRANSMIT)
  CLIENT → 36 02 [128B data]    ← Cùng data, cùng counter
  SERVER LOGIC:
    expected = 0x03
    received = 0x02 = (0x03 - 1) mod 256 → RETRANSMIT DETECTED
  SERVER → 76 02                ← Response lại, KHÔNG ghi dữ liệu lại

STEP 3: Client nhận được 0x76 02 → tiếp tục block 03
  CLIENT → 36 03 [128B data]
  SERVER → 76 03                ← Transfer tiếp tục bình thường
```

### 6.3 Wrap blockSequenceCounter (block 256 và 257)

```
...
BLOCK 254:
  CLIENT → 36 FE [data]
  SERVER → 76 FE

BLOCK 255:
  CLIENT → 36 FF [data]
  SERVER → 76 FF

BLOCK 256 (WRAP về 0x00):
  CLIENT → 36 00 [data]         ← Counter = 0x00 (KHÔNG phải 0x01)
  SERVER → 76 00

BLOCK 257 (tiếp tục từ 0x01):
  CLIENT → 36 01 [data]
  SERVER → 76 01
```

### 6.4 Negative Response — wrongBlockSequenceCounter

```
Client gửi sai counter (nhảy từ 0x01 lên 0x03):

  CLIENT → 36 01 [data]    → Server: expected 0x01 ✓ → ghi, trả 76 01
  CLIENT → 36 03 [data]    → Server: expected 0x02, received 0x03
                                      0x03 ≠ 0x02 (expected)
                                      0x03 ≠ 0x01 (expected - 1 = retransmit)
                                      → wrongBlockSequenceCounter
  SERVER → 7F 36 73
           ^^       NRS: 0x7F
              ^^    SID: 0x36
                 ^^ NRC: 0x73 (wrongBlockSequenceCounter)

  → Transfer state HỦY. Client phải gọi lại 0x34 từ đầu.
```

### 6.5 Negative Response — voltageTooLow

```
  CLIENT → 36 05 [128B data]

  SERVER: VPP = 4.7V < 4.8V (threshold)
  SERVER → 7F 36 93
                 ^^ NRC: 0x93 (voltageTooLow)

  → Kiểm tra nguồn cấp flash programming voltage.
  → Client có thể thử lại sau khi điện áp ổn định.
  → Transfer state: một số ECU hủy transfer, một số giữ nguyên — tùy OEM.
```

---

## 7. Bảng tóm tắt

| Tham số | Vị trí | Độ dài | Quy tắc đặc biệt |
|---|---|---|---|
| `serviceId` | Byte 1 request | 1 byte | Luôn `0x36` |
| `blockSequenceCounter` | Byte 2 request | 1 byte | Bắt đầu `0x01`; wrap `0xFF → 0x00`; retransmit = expected−1 |
| `transferRequestParameterRecord` | Bytes 3–N request | 0–(maxBlockLen−2) byte | Dữ liệu download; rỗng trong upload |
| `serviceId` (RSID) | Byte 1 response | 1 byte | Luôn `0x76` |
| `blockSequenceCounter` echo | Byte 2 response | 1 byte | Echo từ request; server không thay đổi |
| `transferResponseParameterRecord` | Bytes 3–N response | 0–(maxBlockLen−2) byte | Rỗng (download); dữ liệu upload; OEM-defined |

---

*Tiếp theo: [SID 0x36 – Part 2: Upload mode (0x35→0x36), xử lý lỗi mid-transfer, AUTOSAR Dcm callbacks](/uds/uds-sid-0x36-p2/)*
