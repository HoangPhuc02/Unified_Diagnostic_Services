---
layout: default
category: uds_sid
title: "UDS - Service ID 0x36 TransferData (Part 2)"
nav_exclude: true
module: true
tags: [autosar, uds, diagnostics, iso-14229, protocol, download, upload, transfer, blocksequence]
description: "SID 0x36 Part 2 – Upload mode (0x35→0x36), SID 0x35 RequestUpload parameters, so sánh Download vs Upload, xử lý lỗi mid-transfer, AUTOSAR Dcm callbacks, code ví dụ theo ISO 14229-1:2020."
permalink: /uds/uds-sid-0x36-p2/
---

# UDS - SID 0x36: TransferData (Part 2)

> Tài liệu này là phần tiếp theo của [SID 0x36 – Part 1](/uds/uds-sid-0x36-p1/).  
> Part 1 đã trình bày: request/response format, `blockSequenceCounter` rules (initial value, increment, wrap `0xFF→0x00`, retransmit detection), `transferRequestParameterRecord`, và toàn bộ NRC. Part 2 trình bày **Upload mode** (SID 0x35 → 0x36), so sánh hai chiều transfer, xử lý lỗi mid-transfer, và AUTOSAR Dcm integration.

---

## Nhắc nhanh — Ký hiệu dùng xuyên suốt

| Ký hiệu | Giá trị |
|---|---|
| SID 0x36 / RSID 0x76 | TransferData / Response |
| `blockSeqCtr` | `blockSequenceCounter` — bắt đầu `0x01`, wrap `0xFF → 0x00` |
| `maxBlockLen` | `maxNumberOfBlockLength` từ response 0x74 hoặc 0x75 |
| `data/block` | `maxBlockLen − 2` byte dữ liệu thực |
| `transferReqPR` | `transferRequestParameterRecord` — data trong REQUEST |
| `transferResPR` | `transferResponseParameterRecord` — data trong RESPONSE |

---

## 2. SID 0x35 — RequestUpload (tham chiếu nhanh)

### 2.1 Định nghĩa

SID `0x35` là service đối xứng với SID `0x34`: khởi tạo quá trình **upload dữ liệu từ server về client** (ECU → Tester). Ví dụ: đọc flash content, backup calibration data, lấy coredump.

### 2.2 Format Request — RequestUpload (0x35)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x35` | RequestUpload |
| 2 | dataFormatIdentifier | `0x00`–`0xFF` | High nibble = `compressionMethod`; low nibble = `encryptingMethod`; `0x00` = không nén/mã hóa |
| 3 | addressAndLengthFormatIdentifier | `0x11`–`0x44` | High nibble = L (số byte `memorySize`); low nibble = A (số byte `memoryAddress`) |
| 4 đến (3+A) | memoryAddress | A byte (big-endian) | Địa chỉ bắt đầu vùng nhớ cần đọc |
| (4+A) đến (3+A+L) | memorySize | L byte (big-endian) | Tổng số byte cần đọc |

**Quy tắc ALFID, DFI, memoryAddress, memorySize**: Hoàn toàn giống SID 0x34. Xem [SID 0x34 Part 1 – §2.2, §2.3](/uds/uds-sid-0x34-p1/).

**Độ dài request**: `3 + A + L` byte.

### 2.3 Format Positive Response — RequestUpload (0x75)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x75` | RSID của RequestUpload |
| 2 | lengthFormatIdentifier | `0x10`–`0x40` | High nibble = M (số byte `maxNumberOfBlockLength`); low nibble = `0x0` (reserved) |
| 3 đến (2+M) | maxNumberOfBlockLength | M byte (big-endian) | Block size tối đa cho **response** 0x76 (bao gồm RSID + blockSeqCtr + data) |

**Lưu ý:** `maxNumberOfBlockLength` trong 0x75 response là giới hạn cho **0x76 response** (data đi từ server về client), không phải cho 0x36 request.

### 2.4 NRC của SID 0x35 — RequestUpload

| NRC | Tên | Điều kiện |
|---|---|---|
| `0x13` | incorrectMessageLengthOrInvalidFormat | Length ≠ `3 + A + L`, hoặc ALFID nibble không hợp lệ |
| `0x22` | conditionsNotCorrect | Sai session; đang có transfer active |
| `0x31` | requestOutOfRange | `memoryAddress`/`memorySize` ngoài vùng cho phép đọc |
| `0x33` | securityAccessDenied | Chưa unlock security (tùy OEM, một số ECU cho phép upload không cần security) |
| `0x70` | uploadDownloadNotAccepted | ECU không thể upload lúc này |

---

## 3. Chế độ Upload: 0x35 → 0x36 → 0x37

### 3.1 Cấu trúc Request 0x36 trong Upload mode

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x36` | TransferData |
| 2 | blockSequenceCounter | `0x01`–`0xFF`, rồi `0x00` | Số thứ tự block (quy tắc giống download) |
| 3 đến N | transferRequestParameterRecord | **0 byte** (thường) | Client không gửi dữ liệu trong upload |

**Độ dài request upload**: Thường **2 byte** (`0x36 blockSeqCtr`). Không có dữ liệu từ client.

> **⚠️ Cạm bẫy:** Một số ECU strict không chấp nhận bytes thừa sau `blockSeqCtr` trong upload request → NRC `0x13`. Không thêm padding.

### 3.2 Cấu trúc Response 0x76 trong Upload mode

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x76` | RSID của TransferData |
| 2 | blockSequenceCounter | Echo | Echo của `blockSequenceCounter` từ request |
| 3 đến N | transferResponseParameterRecord | Dữ liệu | Tối đa `maxNumberOfBlockLength − 2` byte dữ liệu từ server |

**Độ dài response upload**: `2 + data` byte, tối đa `maxNumberOfBlockLength` byte.

### 3.3 Sequence diagram Upload đầy đủ

```
Client                                 Server (ECU)
  |                                         |
  |--- 35 00 44 [addr 4B] [size 4B] ------->|  RequestUpload
  |<-- 75 20 04 00  (maxBlockLen=0x0400=1024)| Positive Response
  |                                         |
  |--- 36 01 -------------------------------->|  TransferData: "Gửi block 01 cho tôi"
  |<-- 76 01 [data 1022 bytes] -------------|  Server gửi block 01 (1022 byte data)
  |                                         |
  |--- 36 02 -------------------------------->|  TransferData: "Gửi block 02 cho tôi"
  |<-- 76 02 [data 1022 bytes] -------------|  Server gửi block 02
  |            ...                          |
  |--- 36 NN -------------------------------->|  TransferData: "Gửi block cuối"
  |<-- 76 NN [data còn lại] ----------------|  Block cuối có thể < 1022 byte
  |                                         |
  |--- 37 ---------------------------------->|  RequestTransferExit
  |<-- 77 ----------------------------------|
```

---

## 4. So sánh Download vs Upload

| Tiêu chí | Download (0x34 → 0x36 → 0x37) | Upload (0x35 → 0x36 → 0x37) |
|---|---|---|
| Hướng dữ liệu | Client → Server | Server → Client |
| Khởi tạo | SID `0x34` (RSID `0x74`) | SID `0x35` (RSID `0x75`) |
| `maxBlockLen` từ | Response `0x74` | Response `0x75` |
| `maxBlockLen` giới hạn | 0x36 **request** length | 0x76 **response** length |
| 0x36 request data | `transferRequestParameterRecord` = data ghi | `transferRequestParameterRecord` = rỗng |
| 0x76 response data | `transferResponseParameterRecord` = rỗng/OEM | `transferResponseParameterRecord` = data đọc |
| Security Access | Thường bắt buộc | Tùy OEM (đôi khi không cần) |
| Session | Programming (0x02) | Programming hoặc Extended (0x03) |
| `blockSeqCtr` | Bắt đầu `0x01`, wrap `0xFF→0x00` | **Giống hệt** |
| Retransmit detection | Hỗ trợ | Hỗ trợ |
| `0x37` bắt buộc | Có | Có |

---

## 5. maxNumberOfBlockLength — Vai trò chính xác trong từng mode

```
DOWNLOAD:
  ┌──────────────────────────────────────────────────┐
  │  0x36 Request (client → server)                  │
  │  [SID 0x36] [blockSeqCtr] [data...]              │
  │  └───┬────┘ └─────┬─────┘ └──┬──┘               │
  │      1 byte       1 byte     ≤ maxBlockLen-2 byte │
  │  Total request ≤ maxBlockLen byte                 │
  └──────────────────────────────────────────────────┘
  maxBlockLen lấy từ 0x74 response.

UPLOAD:
  ┌──────────────────────────────────────────────────┐
  │  0x76 Response (server → client)                 │
  │  [RSID 0x76] [blockSeqCtr] [data...]             │
  │  └────┬─────┘ └─────┬─────┘ └──┬──┘             │
  │       1 byte        1 byte     ≤ maxBlockLen-2 byte│
  │  Total response ≤ maxBlockLen byte                │
  └──────────────────────────────────────────────────┘
  maxBlockLen lấy từ 0x75 response.
```

> **💡 Điểm mấu chốt:** `maxNumberOfBlockLength` luôn bao gồm **2 byte overhead** (SID/RSID + blockSeqCtr). Dữ liệu thực tế mỗi block = `maxBlockLen − 2`. Áp dụng cho cả download và upload.

---

## 6. Xử lý lỗi mid-transfer

### 6.1 NRC 0x71 — transferDataSuspended

Server bận xử lý internal (ví dụ erase flash sector song song với nhận dữ liệu) và chưa sẵn sàng nhận block tiếp theo.

```
  CLIENT → 36 05 [128B data]
  SERVER → 7F 36 71   ← transferDataSuspended: "Đang bận, thử lại"

  Transfer state VẪN CÒN HIỆU LỰC.
  Client thử lại sau khoảng thời gian chờ (tùy OEM config, thường 100–500 ms):

  CLIENT → 36 05 [128B data]   ← Cùng blockSeqCtr = 0x05
  SERVER → 76 05               ← OK, server đã sẵn sàng
```

**Lưu ý:** Khi thử lại sau NRC `0x71`, client gửi lại đúng block đó (giống retransmit). Server có thể xử lý theo cơ chế retransmit detection hoặc theo logic riêng — tùy implementation.

### 6.2 NRC 0x72 — generalProgrammingFailure

Lỗi phần cứng khi ghi hoặc đọc bộ nhớ.

```
  CLIENT → 36 07 [128B data]
  SERVER → 7F 36 72   ← generalProgrammingFailure

  Nguyên nhân thường gặp:
  1. Flash cell bị hỏng (endurance exceeded)
  2. Điện áp VPP không ổn định trong lúc program
  3. Write-verify fail: đọc lại ≠ vừa ghi (bit flip)
  4. Flash sector chưa erase → không thể ghi (vùng không phải 0xFF)
  5. ECC error (đọc lại từ flash báo uncorrectable error)

  Transfer state bị HỦY. Client phải bắt đầu lại:
  → Gọi 0x37 để đảm bảo transfer exit sạch (tùy OEM có thể bỏ qua)
  → Hoặc ECU reset (0x11)
  → Gọi lại 0x10 → 0x27 → 0x34 → 0x36 từ đầu
```

### 6.3 NRC 0x73 — wrongBlockSequenceCounter

Block counter không hợp lệ và không phải retransmit của block trước.

```
  Ví dụ 1 — Nhảy counter:
  CLIENT → 36 01 [data] → 76 01 ✓
  CLIENT → 36 03 [data]         ← skip 0x02
  SERVER → 7F 36 73              ← wrongBlockSequenceCounter

  Ví dụ 2 — Counter không reset sau 0x34 mới:
  [Transfer 1 kết thúc bằng 0x37 tại blockSeqCtr = 0x0A]
  [Transfer 2 bắt đầu: 0x34 → 0x74]
  CLIENT → 36 0B [data]         ← Tiếp tục từ counter cũ (sai!)
  SERVER → 7F 36 73              ← Expected 0x01, got 0x0B

  → Sau NRC 0x73: Transfer state bị hủy hoàn toàn.
  → Client phải gọi lại 0x34 từ đầu.
```

### 6.4 NRC 0x92/0x93 — voltageTooHigh / voltageTooLow

Điện áp nằm ngoài ngưỡng cho phép lập trình flash.

```
  CLIENT → 36 03 [data]
  SERVER → 7F 36 92   ← voltageTooHigh (VPP quá cao)
  hoặc
  SERVER → 7F 36 93   ← voltageTooLow (VPP quá thấp)

  Hành động:
  1. Kiểm tra nguồn cấp (battery voltage, DC-DC converter)
  2. Đợi điện áp ổn định
  3. Gửi lại block (nếu server giữ transfer state)
     hoặc bắt đầu lại (nếu server hủy transfer state)

  Lưu ý: 0x92/0x93 là NRC đặc thù cho flash programming.
  Không xuất hiện trong các service thông thường.
```

### 6.5 Session timeout trong transfer

```
Nếu S3Server timer hết trong khi transfer đang diễn ra:
  → ECU thoát Programming Session → Default Session
  → Transfer state bị hủy

Client cần duy trì session bằng TesterPresent (0x3E 0x00) giữa các block:

  CLIENT → 36 10 [data]        → 76 10
  (Processing delay lớn)
  CLIENT → 3E 00               → 7E 00  ← giữ session alive
  CLIENT → 36 11 [data]        → 76 11
```

---

## 7. AUTOSAR Dcm — Callbacks và Integration

### 7.1 Kiến trúc AUTOSAR cho TransferData

```
  Tester / Flasher Tool
        │ CAN-TP / DoIP
        ▼
  ┌──────────────────┐
  │   PduR / ComM    │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │   Dcm Module     │  ← Parse SID 0x36 request
  │   (Upload/Downld │     Gọi callback application
  │    Handler)      │
  └────────┬─────────┘
           │ Dcm_ProcessTransferDataWrite()  (download)
           │ Dcm_ProcessTransferDataRead()   (upload)
           ▼
  ┌──────────────────┐
  │  FBL Application │  ← Logic ghi/đọc bộ nhớ
  └────────┬─────────┘
           │ MemIf_Write() / MemIf_Read()
           ▼
  ┌──────────────────┐
  │ Fls / Eep Driver │
  └──────────────────┘
```

### 7.2 Callback prototypes (AUTOSAR SWS_Dcm)

```c
/* ─── DOWNLOAD: gọi mỗi lần nhận 0x36 trong download mode ─── */
Std_ReturnType Dcm_ProcessTransferDataWrite(
    Dcm_OpStatusType OpStatus,
    uint8  blockSequenceCounter,       /* blockSeqCtr từ request byte 2 */
    uint16 blockLen,                   /* Số byte trong transferRequestParameterRecord */
    uint8 *blockData,                  /* Con trỏ tới transferRequestParameterRecord */
    Dcm_NegativeResponseCodeType *ErrorCode  /* OUT: NRC nếu reject */
);

/* ─── UPLOAD: gọi mỗi lần nhận 0x36 trong upload mode ─── */
Std_ReturnType Dcm_ProcessTransferDataRead(
    Dcm_OpStatusType OpStatus,
    uint8  blockSequenceCounter,       /* blockSeqCtr từ request byte 2 */
    uint16 blockLen,                   /* Số byte client muốn đọc (= maxBlockLen - 2) */
    uint8 *blockData,                  /* OUT: Buffer Dcm sẽ đặt transferResponseParameterRecord */
    uint16 *outputBlockLen,            /* OUT: Số byte thực sự đọc được */
    Dcm_NegativeResponseCodeType *ErrorCode  /* OUT: NRC nếu reject */
);
```

**Giá trị trả về:**
- `E_OK`: Xử lý thành công → Dcm gửi positive response `0x76`.
- `DCM_E_PENDING`: Cần thêm thời gian → Dcm gửi `0x7F 0x36 0x78` (pending response), gọi lại callback sau.
- `E_NOT_OK` + ErrorCode: Dcm gửi `0x7F 0x36 [ErrorCode]`.

### 7.3 Ví dụ triển khai đầy đủ

```c
/* ──────────────────────────────────────────────────────
   Flash Bootloader — TransferData Write Handler
   Platform: STM32, AUTOSAR Classic
   ────────────────────────────────────────────────────── */

/* Context được khởi tạo bởi Dcm_ProcessRequestDownload() */
typedef struct {
    uint32_t startAddress;      /* Địa chỉ bắt đầu từ 0x34 */
    uint32_t totalSize;         /* Kích thước từ 0x34 */
    uint32_t bytesWritten;      /* Số byte đã ghi thành công */
    uint8_t  expectedBlockSeq;  /* Counter mong đợi tiếp theo */
    uint8_t  lastBlockSeq;      /* Counter của block vừa xử lý xong */
} TransferContext_t;

static TransferContext_t g_ctx;

Std_ReturnType Dcm_ProcessTransferDataWrite(
    Dcm_OpStatusType OpStatus,
    uint8  blockSequenceCounter,
    uint16 blockLen,
    uint8 *blockData,
    Dcm_NegativeResponseCodeType *ErrorCode)
{
    /* ── Bước 1: Kiểm tra retransmit ── */
    uint8_t expected = g_ctx.expectedBlockSeq;
    uint8_t retransmit_seq = (uint8_t)((expected - 1u) & 0xFFu);  /* (expected-1) mod 256 */

    if (blockSequenceCounter == retransmit_seq) {
        /* Retransmit detected: gửi positive response, không ghi lại */
        return E_OK;
    }

    /* ── Bước 2: Kiểm tra counter hợp lệ ── */
    if (blockSequenceCounter != expected) {
        *ErrorCode = DCM_E_WRONGBLOCKSEQUENCECOUNTER;
        return E_NOT_OK;
    }

    /* ── Bước 3: Kiểm tra không vượt tổng size ── */
    if ((g_ctx.bytesWritten + blockLen) > g_ctx.totalSize) {
        *ErrorCode = DCM_E_REQUESTOUTOFRANGE;
        return E_NOT_OK;
    }

    /* ── Bước 4: Kiểm tra điện áp flash (hardware-specific) ── */
    if (Flash_GetVoltageStatus() == FLASH_VOLTAGE_TOO_LOW) {
        *ErrorCode = DCM_E_VOLTAGETOLOW;  /* NRC 0x93 */
        return E_NOT_OK;
    }

    /* ── Bước 5: Ghi vào flash ── */
    uint32_t writeAddr = g_ctx.startAddress + g_ctx.bytesWritten;

    if (OpStatus == DCM_INITIAL) {
        /* Lần gọi đầu tiên cho block này: bắt đầu ghi async */
        Std_ReturnType flashResult = Flash_WriteAsync(writeAddr, blockData, blockLen);
        if (flashResult == E_NOT_OK) {
            *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
            return E_NOT_OK;
        }
        return DCM_E_PENDING;  /* Báo Dcm gọi lại, gửi 0x78 pending */
    }

    if (OpStatus == DCM_PENDING) {
        /* Kiểm tra kết quả ghi async */
        Flash_StatusType status = Flash_GetWriteStatus();
        if (status == FLASH_BUSY) {
            return DCM_E_PENDING;  /* Tiếp tục chờ */
        }
        if (status == FLASH_FAILED) {
            *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
            return E_NOT_OK;
        }
        /* status == FLASH_OK: ghi thành công */
    }

    /* ── Bước 6: Cập nhật context ── */
    g_ctx.bytesWritten += blockLen;

    /* Tăng counter: wrap 0xFF → 0x00 */
    if (g_ctx.expectedBlockSeq == 0xFFu) {
        g_ctx.expectedBlockSeq = 0x00u;
    } else {
        g_ctx.expectedBlockSeq += 1u;
    }

    return E_OK;
}
```

> **💡 Điểm mấu chốt:** Công thức `(expected - 1u) & 0xFFu` tính đúng giá trị retransmit kể cả trường hợp wrap: khi `expected = 0x00`, `(0x00 - 1) & 0xFF = 0xFF` — đúng là `0xFF` là block ngay trước `0x00`.

---

## 8. Luồng Upload đầy đủ — Ví dụ đọc Flash Content

**Scenario**: Đọc 600 byte firmware từ địa chỉ `0x08010000` để verify sau download. `maxBlockLen = 258` → data/block = 256 byte → 3 block (256 + 256 + 88).

```
STEP 1 – RequestUpload
  REQUEST:  35  00  44  08 01 00 00  00 00 02 58
            ^^  ^^  ^^  ─────────── ───────────
            SID DFI ALFID addr=0x08010000  size=0x258=600

  RESPONSE: 75  20  01  02
            ^^  ^^  ─────
            RSID LFI  maxBlockLen = 0x0102 = 258

STEP 2 – TransferData block 01 (server gửi bytes 0–255)
  REQUEST:  36  01
            ^^  ^^
            SID blockSeqCtr=0x01  (không có data từ client)

  RESPONSE: 76  01  [256 bytes từ flash: 0x08010000–0x080100FF]
            ^^  ^^  ──────────────────────────────────────────
            RSID echo  transferResponseParameterRecord = flash data

STEP 3 – TransferData block 02 (server gửi bytes 256–511)
  REQUEST:  36  02
  RESPONSE: 76  02  [256 bytes: 0x08010100–0x080101FF]

STEP 4 – TransferData block 03 (server gửi bytes 512–599, 88 byte)
  REQUEST:  36  03
  RESPONSE: 76  03  [88 bytes: 0x08010200–0x08010257]
            Total response = 1+1+88 = 90 bytes (< maxBlockLen, hợp lệ)

STEP 5 – RequestTransferExit
  REQUEST:  37
  RESPONSE: 77

→ Client đã nhận đủ 600 byte flash content.
→ So sánh CRC với firmware đã flash để verify tính toàn vẹn.
```

---

## 9. Bảng tóm tắt toàn bộ — So sánh Download vs Upload

| Tham số | Download | Upload |
|---|---|---|
| Precondition service | SID `0x34` (RSID `0x74`) | SID `0x35` (RSID `0x75`) |
| `maxBlockLen` áp dụng cho | 0x36 **request** | 0x76 **response** |
| 0x36 request length | `2 + data` (tối đa `maxBlockLen`) | `2` byte (không có data) |
| 0x76 response length | `2` byte (thường) | `2 + data` (tối đa `maxBlockLen`) |
| `blockSeqCtr` bắt đầu | `0x01` | `0x01` |
| `blockSeqCtr` wrap | `0xFF → 0x00` | `0xFF → 0x00` |
| Retransmit detection | Có | Có |
| NRC khi sai session | `0x22` | `0x22` |
| NRC khi sai counter | `0x73` | `0x73` |
| NRC khi flash fail | `0x72` | `0x72` |
| Voltage NRC | `0x92`, `0x93` | `0x92`, `0x93` |
| Kết thúc bằng | SID `0x37` | SID `0x37` |
| AUTOSAR callback | `Dcm_ProcessTransferDataWrite()` | `Dcm_ProcessTransferDataRead()` |

---

## 10. Checklist tích hợp SID 0x36

| # | Checklist | Lý do |
|---|---|---|
| 1 | `blockSeqCtr` bắt đầu `0x01` sau mỗi `0x34`/`0x35` mới | Mỗi transfer là counter độc lập |
| 2 | Wrap `0xFF → 0x00` (dùng `& 0xFF`, không dùng `% 0x100` với kiểu signed) | Tránh NRC `0x73` từ block 256 |
| 3 | Retransmit detection: `received == (expected - 1) & 0xFF` | Trả `E_OK`, không ghi lại |
| 4 | Kiểm tra `blockLen ≤ maxBlockLen − 2` | NRC `0x13` nếu block quá lớn |
| 5 | Kiểm tra `bytesWritten + blockLen ≤ totalSize` | NRC `0x31` nếu vượt `memorySize` |
| 6 | Xử lý `DCM_E_PENDING` khi flash write async | Tránh P2Server timeout trong quá trình ghi |
| 7 | Upload mode: request chỉ 2 byte, không thêm padding | NRC `0x13` nếu thêm byte thừa |
| 8 | Physical addressing (không dùng 0x7DF) | Functional addressing không hợp lệ cho transfer |
| 9 | TesterPresent giữa các block nếu processing delay > S3Server/2 | Tránh session timeout |
| 10 | Sau NRC `0x72` hoặc `0x73`: gọi lại `0x34`/`0x35` từ đầu | Không có resume mechanism |

---

*Quay lại: [SID 0x36 – Part 1: blockSequenceCounter, request/response format, NRC đầy đủ](/uds/uds-sid-0x36-p1/)*  
*Xem thêm: [SID 0x34 RequestDownload Part 1](/uds/uds-sid-0x34-p1/) · [SID 0x34 Part 2](/uds/uds-sid-0x34-p2/)*
