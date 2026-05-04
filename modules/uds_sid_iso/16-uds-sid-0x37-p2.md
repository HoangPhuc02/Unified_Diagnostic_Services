---
layout: default
category: uds
title: "UDS - Service ID 0x37 RequestTransferExit (Part 2)"
nav_exclude: true
module: true
tags: [autosar, uds, diagnostics, iso-14229, protocol, download, upload, transfer, exit, verification, crc, autosar]
description: "SID 0x37 Part 2 – verification patterns (CRC-32, checksum, signature), multi-segment transfer flow, 0x78 pending handling, AUTOSAR Dcm_ProcessRequestTransferExit callback, code ví dụ, bảng tổng kết Upload/Download unit theo ISO 14229-1:2020."
permalink: /uds/uds-sid-0x37-p2/
---

# UDS - SID 0x37: RequestTransferExit (Part 2)

> Tài liệu này là phần tiếp theo của [SID 0x37 – Part 1](/uds/uds-sid-0x37-p1/).  
> Part 1 đã trình bày: request/response format, `transferRequestParameterRecord`, `transferResponseParameterRecord`, toàn bộ NRC (`0x13`, `0x22`, `0x31`, `0x72`), và special cases. Part 2 trình bày **verification patterns** phổ biến, **multi-segment transfer**, xử lý `0x78` pending, AUTOSAR Dcm callback, và bảng tổng kết toàn bộ Upload/Download functional unit.

---

## Nhắc nhanh — Ký hiệu dùng xuyên suốt

| Ký hiệu | Giá trị |
|---|---|
| SID 0x37 / RSID 0x77 | RequestTransferExit / Response |
| `transferReqPR` | `transferRequestParameterRecord` — OEM-defined, thường rỗng hoặc CRC |
| `transferResPR` | `transferResponseParameterRecord` — OEM-defined, thường rỗng |
| NRC `0x72` | `generalProgrammingFailure` — verification fail hoặc transfer incomplete |
| NRC `0x22` | `conditionsNotCorrect` — không có transfer active |

---

## 2. Verification Patterns trong transferRequestParameterRecord

### 2.1 Pattern 1 — Không có Verification (phổ biến nhất)

```
REQUEST:  37
RESPONSE: 77
```

Server tự verify bằng cách so sánh tổng byte nhận với `memorySize`. Nếu khớp → pass. Không cần dữ liệu verification từ client.

**Khi nào dùng:** ECU mass production, bootloader đơn giản, môi trường có CAN-TP CRC bảo vệ lớp transport.

### 2.2 Pattern 2 — CRC-16 (2 byte)

CRC-16 tính trên toàn bộ dữ liệu đã transfer (không bao gồm SID, blockSeqCtr — chỉ `transferRequestParameterRecord` từ các block 0x36).

```
transferRequestParameterRecord: [CRC-16 High Byte][CRC-16 Low Byte]

Ví dụ — CRC-16/CCITT-FALSE = 0x1D4A:
  REQUEST:  37  1D 4A
            ^^  ─────
            SID CRC-16 = 0x1D4A (big-endian)
```

**Thuật toán phổ biến:** CRC-16/CCITT-FALSE (polynomial `0x1021`, init `0xFFFF`, no reflect).

**Server verify:**
```
expectedCRC = CRC16(all_downloaded_bytes)
receivedCRC = transferRequestParameterRecord[0..1]
if (expectedCRC != receivedCRC) → NRC 0x72
```

### 2.3 Pattern 3 — CRC-32 (4 byte, phổ biến cho firmware)

```
transferRequestParameterRecord: [CRC-32 Byte 3][Byte 2][Byte 1][Byte 0]
                                  ─────── big-endian ────────────────────

Ví dụ — CRC-32 = 0xA3F2015C:
  REQUEST:  37  A3 F2 01 5C
                ─────────── 4 bytes CRC-32
```

**Thuật toán phổ biến:** ISO 3309 CRC-32 (polynomial `0x04C11DB7`), hoặc CRC-32/ISO-HDLC (reflected, widely used in embedded).

> **⚠️ Cạm bẫy:** Nhiều ECU định nghĩa CRC tính trên **vùng nhớ sau khi ghi** (read-back từ flash) thay vì dữ liệu gửi đi. Nếu có bit flip khi ghi → CRC mismatch → NRC `0x72`. Luôn kiểm tra ECU specification: CRC tính trên *transferred data* hay *flash content*.

### 2.4 Pattern 4 — CRC-32 + Length (6 byte)

```
transferRequestParameterRecord:
  [CRC-32 4B big-endian][memorySize 2B big-endian]

Ví dụ:
  REQUEST:  37  A3 F2 01 5C  02 00
            ^^  ─────────── ─────
            SID CRC-32      Size = 0x0200 (512 byte)
```

Server verify cả nội dung và kích thước. Dùng để phát hiện transfer truncation.

### 2.5 Pattern 5 — HMAC-SHA256 (32 byte)

Dùng trong secure boot / OTA yêu cầu xác thực nguồn gốc firmware.

```
transferRequestParameterRecord: [32 bytes HMAC-SHA256 signature]

REQUEST:  37  [32 bytes]
          ^^  ──────────
          SID HMAC-SHA256 của toàn bộ firmware data
```

Server có symmetric key (pre-shared secret) để verify HMAC. Nếu key không khớp hoặc data bị sửa → NRC `0x72`.

---

## 3. Multi-Segment Transfer — Nhiều Lần Gọi 0x37

### 3.1 Khi nào cần nhiều segment

Firmware thường bao gồm nhiều segment không liền nhau trong bộ nhớ:

```
Flash Layout (ví dụ STM32):
  0x08000000 – 0x0800FFFF : Bootloader (64 KB) — không download
  0x08010000 – 0x0802FFFF : Application code (128 KB) ← Segment 1
  0x08030000 – 0x08037FFF : Calibration data (32 KB)  ← Segment 2
  0x08038000 – 0x0803BFFF : Parameter block (16 KB)   ← Segment 3
```

Mỗi segment yêu cầu một chuỗi `0x34 → 0x36×N → 0x37` độc lập.

### 3.2 Sequence diagram — 2 segment

```
Client                              Server
  │                                    │
  │─── 0x34 [0x08010000] [0x20000] ───>│  Segment 1: RequestDownload
  │<── 0x74 [maxBlockLen]              │
  │─── 0x36 01 [256B] ──────────────>  │
  │<── 0x76 01                         │
  │    ... (512 blocks) ...             │
  │─── 0x36 00 [256B] ──────────────>  │  blockSeqCtr wrap: 0xFF → 0x00 → 0x01
  │<── 0x76 00                         │
  │─── 0x37 [CRC-32 4B] ────────────>  │  RequestTransferExit Segment 1
  │<── 0x77                            │  Transfer state CLEARED
  │                                    │
  │─── 0x34 [0x08030000] [0x08000] ──> │  Segment 2: RequestDownload mới
  │<── 0x74 [maxBlockLen]              │  blockSeqCtr RESET về 0x01
  │─── 0x36 01 [256B] ──────────────>  │
  │<── 0x76 01                         │
  │    ... (128 blocks) ...             │
  │─── 0x37 [CRC-32 4B] ────────────>  │  RequestTransferExit Segment 2
  │<── 0x77                            │
  │                                    │
  │─── 0x11 01 ─────────────────────>  │  ECUReset (Hard Reset)
  │<── 0x51 01                         │
```

**Quy tắc sau mỗi `0x37` thành công:**
- Transfer state bị xóa.
- `blockSequenceCounter` về `0x01` khi `0x34`/`0x35` mới được gọi.
- Server sẵn sàng nhận `0x34`/`0x35` mới ngay lập tức (không cần delay).

### 3.3 Ví dụ hex trace — 2 segment (rút gọn)

```
─── SEGMENT 1 ───────────────────────────────────────────
34 00 44  08 01 00 00  00 02 00 00
→ 74 20 01 02

36 01 [256B] → 76 01
36 02 [256B] → 76 02
...           (512 blocks tổng cộng)
36 00 [256B] → 76 00   ← Block 256: counter = 0x00 (wrap)
36 01 [256B] → 76 01   ← Block 257: counter = 0x01

37  A3 F2 01 5C        ← CRC-32 của 128KB firmware
→ 77

─── SEGMENT 2 ───────────────────────────────────────────
34 00 44  08 03 00 00  00 00 80 00
→ 74 20 01 02

36 01 [256B] → 76 01   ← blockSeqCtr RESET: bắt đầu từ 0x01
36 02 [256B] → 76 02
...           (128 blocks)
36 80 [256B] → 76 80

37  C1 2B A4 E7        ← CRC-32 của 32KB calibration
→ 77
```

---

## 4. Xử lý 0x78 (requestCorrectlyReceivedResponsePending)

### 4.1 Khi nào server gửi 0x78 trong 0x37

Một số tác vụ khi kết thúc transfer cần nhiều thời gian hơn `P2Server`:

| Tác vụ | Thời gian ước tính | Ghi chú |
|---|---|---|
| Tính CRC-32 toàn bộ 512 KB flash | 50–200 ms | MCU 100 MHz, không DMA |
| RSA-2048 signature verify | 200–500 ms | Software RSA trên Cortex-M4 |
| HMAC-SHA256 verify 512 KB | 30–100 ms | |
| Final erase unused flash sectors | 100–2000 ms | Tùy flash controller |
| Write-back verify (read-after-write) | 50–500 ms | Đọc lại toàn bộ flash |

### 4.2 Luồng xử lý 0x78

```
CLIENT → 37  [CRC-32 4B]

SERVER → 7F 37 78    ← Gửi pending (≤ P2Server ms kể từ lúc nhận request)
         ^^    ^^
         NRS   NRC: 0x78 (requestCorrectlyReceivedResponsePending)

SERVER → 7F 37 78    ← Tiếp tục pending (mỗi lần cách nhau ≤ P2*Server ms)

SERVER → 77          ← Final response (sau khi tất cả tác vụ xong)
```

**Quy tắc timing:**
- Response đầu tiên (`0x78` hoặc `0x77`) phải gửi trong `P2Server` ms kể từ khi nhận request.
- Mỗi `0x78` tiếp theo phải gửi trong `P2*Server` ms kể từ `0x78` trước đó.
- Tổng thời gian chờ của client = `P2*Server` × (số lần `0x78`).

**Client behavior:**
- Không reset session timer khi nhận `0x78`.
- Không gửi request mới (kể cả `TesterPresent`) trong khi đang chờ pending response.
- Nếu `P2*Server` hết mà không có response → session timeout.

---

## 5. AUTOSAR Dcm — Callback và Integration

### 5.1 Callback prototype (AUTOSAR SWS_Dcm)

```c
Std_ReturnType Dcm_ProcessRequestTransferExit(
    Dcm_OpStatusType OpStatus,
    uint8  *transferRequestParameterRecord,    /* IN: Data từ request (byte 2 trở đi) */
    uint16  transferRequestParameterRecordSize,/* IN: Số byte của transferRequestParameterRecord */
    uint8  *transferResponseParameterRecord,   /* OUT: Data server gửi về (byte 2 trở đi trong 0x77) */
    uint16 *transferResponseParameterRecordSize,/* OUT: Số byte server muốn gửi về */
    Dcm_NegativeResponseCodeType *ErrorCode    /* OUT: NRC nếu từ chối */
);
```

**Giá trị trả về:**
- `E_OK`: Verification pass → Dcm gửi `0x77 [transferResponseParameterRecord]`.
- `DCM_E_PENDING`: Cần thêm thời gian → Dcm gửi `0x7F 0x37 0x78`, gọi lại callback sau.
- `E_NOT_OK` + ErrorCode: Dcm gửi `0x7F 0x37 [ErrorCode]`.

**Khi `OpStatus = DCM_INITIAL`:** Lần gọi đầu tiên cho request này.  
**Khi `OpStatus = DCM_PENDING`:** Lần gọi lại sau khi trả `DCM_E_PENDING` lần trước.  
**Khi `OpStatus = DCM_CANCEL`:** Dcm hủy request (session timeout trong quá trình pending).

### 5.2 Ví dụ implementation đầy đủ

```c
/* ──────────────────────────────────────────────────────────────────
   Flash Bootloader — RequestTransferExit Handler
   Hỗ trợ: CRC-32 verification trong transferRequestParameterRecord
   Platform: AUTOSAR Classic, Cortex-M4
   ────────────────────────────────────────────────────────────────── */

/* Transfer context (khởi tạo bởi Dcm_ProcessRequestDownload) */
extern TransferContext_t g_ctx;

/* CRC-32 kết quả tính async */
static uint32_t  s_computedCrc32;
static bool      s_crcComputed;

Std_ReturnType Dcm_ProcessRequestTransferExit(
    Dcm_OpStatusType OpStatus,
    uint8  *transferRequestParameterRecord,
    uint16  transferRequestParameterRecordSize,
    uint8  *transferResponseParameterRecord,
    uint16 *transferResponseParameterRecordSize,
    Dcm_NegativeResponseCodeType *ErrorCode)
{
    /* ── Bước 1: Kiểm tra transfer đã hoàn chỉnh ── */
    if (g_ctx.bytesWritten != g_ctx.totalSize) {
        *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
        return E_NOT_OK;
    }

    /* ── Bước 2: Khởi động CRC verification lần đầu ── */
    if (OpStatus == DCM_INITIAL) {
        s_crcComputed = false;

        /* Bắt đầu tính CRC-32 async trên flash content */
        Crc32_StartAsync(g_ctx.startAddress, g_ctx.totalSize);

        return DCM_E_PENDING;  /* Báo Dcm gửi 0x78 pending */
    }

    /* ── Bước 3: Kiểm tra kết quả CRC async ── */
    if (OpStatus == DCM_PENDING) {
        Crc32_StatusType crcStatus = Crc32_GetStatus();

        if (crcStatus == CRC32_BUSY) {
            return DCM_E_PENDING;  /* Tiếp tục chờ */
        }

        if (crcStatus == CRC32_ERROR) {
            *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
            return E_NOT_OK;
        }

        /* crcStatus == CRC32_DONE */
        s_computedCrc32 = Crc32_GetResult();
        s_crcComputed = true;
    }

    /* ── Bước 4: Verify CRC từ client (nếu có) ── */
    if (transferRequestParameterRecordSize == 4u) {
        /* OEM: transferRequestParameterRecord = CRC-32 (4 byte, big-endian) */
        uint32_t receivedCrc = ((uint32_t)transferRequestParameterRecord[0] << 24u) |
                               ((uint32_t)transferRequestParameterRecord[1] << 16u) |
                               ((uint32_t)transferRequestParameterRecord[2] <<  8u) |
                               ((uint32_t)transferRequestParameterRecord[3]);

        if (receivedCrc != s_computedCrc32) {
            *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
            return E_NOT_OK;  /* NRC 0x72: CRC mismatch */
        }
    } else if (transferRequestParameterRecordSize == 0u) {
        /* Không có CRC từ client: chỉ verify write completeness */
        /* (đã kiểm tra ở Bước 1) */
    } else {
        /* Độ dài không hợp lệ */
        *ErrorCode = DCM_E_INCORRECTMESSAGELENGTHORINVALIDFORMAT;
        return E_NOT_OK;  /* NRC 0x13 */
    }

    /* ── Bước 5: Xóa transfer context ── */
    (void)memset(&g_ctx, 0, sizeof(g_ctx));

    /* ── Bước 6: Không có transferResponseParameterRecord ── */
    *transferResponseParameterRecordSize = 0u;

    return E_OK;  /* → Dcm gửi 0x77 */
}
```

> **💡 Điểm mấu chốt:** Phải xóa (hoặc invalidate) `g_ctx` sau khi `0x37` thành công. Nếu không, lần `0x34` tiếp theo có thể thấy `bytesWritten > 0` và nhầm là transfer đang dở.

---

## 6. Bảng tổng kết — Upload/Download Functional Unit (SID 0x34, 0x35, 0x36, 0x37)

| Thuộc tính | 0x34 RequestDownload | 0x35 RequestUpload | 0x36 TransferData | 0x37 RequestTransferExit |
|---|---|---|---|---|
| SID / RSID | `0x34` / `0x74` | `0x35` / `0x75` | `0x36` / `0x76` | `0x37` / `0x77` |
| Sub-function | Không có | Không có | Không có | Không có |
| Precondition | Session + Security | Session (+ Security OEM) | Sau 0x34 hoặc 0x35 | Sau 0x36 (≥ 1 block) |
| Tham số đặc trưng | `dataFormatIdentifier`, `addressAndLengthFormatIdentifier`, `memoryAddress`, `memorySize` | Giống 0x34 | `blockSequenceCounter`, `transferRequestParameterRecord` (download), `transferResponseParameterRecord` (upload) | `transferRequestParameterRecord` (CRC/checksum OEM), `transferResponseParameterRecord` (kết quả OEM) |
| Kết quả chính | `maxNumberOfBlockLength` | `maxNumberOfBlockLength` | Block data exchange | Transfer state cleared |
| NRC quan trọng | `0x22`, `0x31`, `0x33`, `0x70` | `0x22`, `0x31`, `0x33`, `0x70` | `0x22`, `0x31`, `0x71`, `0x72`, `0x73`, `0x92`, `0x93` | `0x13`, `0x22`, `0x31`, `0x72` |
| Pending (0x78) | Thường (erase flash) | Ít gặp | Có thể (write async) | Thường (final verify) |
| Addressing | Physical only | Physical only | Physical only | Physical only |
| Số lần gọi / transfer | **1 lần** | **1 lần** | **N lần** (mỗi block) | **1 lần** |

---

## 7. Luồng Download hoàn chỉnh — Toàn cảnh

```
Tester / PC Flash Tool                     ECU Boot
        │                                       │
        │──── 10 02 ─────────────────────────>  │  Programming Session
        │  <── 50 02 [P2=25ms P2*=5000ms] ────  │
        │                                       │
        │──── 27 01 ─────────────────────────>  │  SecurityAccess: requestSeed
        │  <── 67 01 [4 byte seed] ────────────  │
        │                                       │
        │──── 27 02 [4 byte key] ─────────────>  │  SecurityAccess: sendKey
        │  <── 67 02 ─────────────────────────  │  Security UNLOCKED
        │                                       │
        │═══════ SEGMENT 1: Application (128 KB) ═══════│
        │──── 34 00 44 [08 01 00 00] [00 02 00 00] ──> │  RequestDownload
        │  <── 7F 34 78 ────────────────────────  │  Erasing flash...
        │  <── 7F 34 78 ────────────────────────  │  Still erasing...
        │  <── 74 20 01 02 ─────────────────────  │  OK, maxBlockLen=258
        │                                       │
        │──── 36 01 [256B] ──────────────────>  │
        │  <── 76 01 ─────────────────────────  │
        │    ...  ×512 blocks  ...               │
        │──── 36 00 [256B] ──────────────────>  │  Block 256: seqCtr=0x00
        │  <── 76 00 ─────────────────────────  │
        │──── 36 01 [256B] ──────────────────>  │  Block 257: seqCtr=0x01
        │  <── 76 01 ─────────────────────────  │
        │                                       │
        │──── 37 [A3 F2 01 5C] ──────────────>  │  RequestTransferExit + CRC-32
        │  <── 7F 37 78 ────────────────────────  │  Verifying CRC...
        │  <── 77 ──────────────────────────────  │  Segment 1 DONE ✓
        │                                       │
        │═══════ SEGMENT 2: Calibration (32 KB) ════════│
        │──── 34 00 44 [08 03 00 00] [00 00 80 00] ──> │  RequestDownload
        │  <── 7F 34 78 ────────────────────────  │  Erasing...
        │  <── 74 20 01 02 ─────────────────────  │  maxBlockLen=258
        │                                       │
        │──── 36 01 [256B] ──────────────────>  │  blockSeqCtr RESET → 0x01
        │  <── 76 01 ─────────────────────────  │
        │    ...  ×128 blocks  ...               │
        │──── 37 [C1 2B A4 E7] ──────────────>  │  RequestTransferExit + CRC-32
        │  <── 7F 37 78 ────────────────────────  │  Verifying...
        │  <── 77 ──────────────────────────────  │  Segment 2 DONE ✓
        │                                       │
        │──── 31 01 FF 01 ────────────────────>  │  CheckProgrammingIntegrity (OEM)
        │  <── 71 01 FF 01 00 ──────────────────  │  0x00 = integrity OK
        │                                       │
        │──── 11 01 ─────────────────────────>  │  ECUReset
        │  <── 51 01 ─────────────────────────  │
        │                                       │
        │         (ECU boots new firmware)       │
```

---

## 8. Checklist tích hợp SID 0x37

| # | Checklist | Lý do |
|---|---|---|
| 1 | Xóa/invalidate transfer context sau `0x37` thành công | Tránh stale state gây lỗi `0x34` tiếp theo |
| 2 | Kiểm tra `bytesWritten == totalSize` trước khi verify | NRC `0x72` nếu transfer chưa hoàn chỉnh |
| 3 | Xử lý `transferRequestParameterRecord` = 0 byte và n byte (2 case) | Client có thể không gửi CRC hoặc gửi CRC theo OEM spec |
| 4 | Dùng `DCM_E_PENDING` khi verify cần > P2Server ms | Tránh timeout trong quá trình tính CRC/verify flash |
| 5 | Không verify Security Access lại trong `0x37` | Security đã được kiểm tra tại `0x34`/`0x35` |
| 6 | `transferResponseParameterRecord` = 0 byte nếu không có OEM extension | Tránh gửi dữ liệu rác trong response |
| 7 | Physical addressing (không dùng 0x7DF) | Functional addressing không hợp lệ |
| 8 | Sau NRC `0x72`: client cần gọi lại `0x34` từ đầu | Không có resume; transfer state đã bị hủy khi trả NRC |
| 9 | Xử lý `DCM_CANCEL` trong callback (session timeout khi pending) | Cleanup context nếu cần; tránh memory leak |
| 10 | CRC tính trên flash content (read-back) hoặc received data theo spec OEM | Hai cách tính khác nhau → kết quả khác nhau |

---

*Quay lại: [SID 0x37 – Part 1: Request/Response format, NRC đầy đủ, special cases](/uds/uds-sid-0x37-p1/)*  
*Xem thêm: [SID 0x34 Part 1](/uds/uds-sid-0x34-p1/) · [SID 0x34 Part 2](/uds/uds-sid-0x34-p2/) · [SID 0x36 Part 1](/uds/uds-sid-0x36-p1/) · [SID 0x36 Part 2](/uds/uds-sid-0x36-p2/)*
