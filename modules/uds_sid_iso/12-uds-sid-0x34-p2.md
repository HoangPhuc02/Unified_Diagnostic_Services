---
layout: default
category: uds
title: "UDS - Service ID 0x34 RequestDownload (Part 2)"
nav_exclude: true
module: true
tags: [autosar, uds, diagnostics, iso-14229, protocol, download, transfer, programming]
description: "SID 0x34 Part 2 – luồng transfer đầy đủ (0x34→0x36→0x37), SID 0x36 TransferData, SID 0x37 RequestTransferExit, blockSequenceCounter, xử lý lỗi mid-transfer, AUTOSAR Fls stack theo ISO 14229-1:2020."
permalink: /uds/uds-sid-0x34-p2/
---

# UDS - SID 0x34: RequestDownload (Part 2)

> Tài liệu này là phần tiếp theo của [SID 0x34 – Part 1](/uds/uds-sid-0x34-p1/).  
> Part 1 đã trình bày đầy đủ: `dataFormatIdentifier`, `addressAndLengthFormatIdentifier`, `memoryAddress`, `memorySize`, `maxNumberOfBlockLength`, và NRC. Part 2 trình bày **luồng transfer đầy đủ** (0x34 → 0x36 × N → 0x37), cơ chế `blockSequenceCounter`, xử lý lỗi mid-transfer, và cách AUTOSAR Fls/Mem driver liên hệ với UDS layer.

---

## Nhắc nhanh — Ký hiệu dùng xuyên suốt

| Ký hiệu | Giá trị |
|---|---|
| SID 0x34 / RSID 0x74 | RequestDownload / Response |
| SID 0x36 / RSID 0x76 | TransferData / Response |
| SID 0x37 / RSID 0x77 | RequestTransferExit / Response |
| `maxBlockLen` | Giá trị `maxNumberOfBlockLength` từ response 0x74 |
| `data/block` | `maxBlockLen - 2` byte dữ liệu thực mỗi lần 0x36 |
| `blockSeqCtr` | `blockSequenceCounter` trong 0x36 request/response |

---

## 2. SID 0x36 — TransferData

### 2.1 Định nghĩa

Sau khi RequestDownload (0x34) thành công, client gửi từng block dữ liệu qua **SID 0x36 TransferData**. Mỗi block mang một `blockSequenceCounter` để server phát hiện mất block hoặc trùng lặp.

### 2.2 Format Request — TransferData (0x36)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x36` | TransferData |
| 2 | blockSequenceCounter | `0x01`–`0xFF`, rồi `0x00` | Số thứ tự block, tăng dần (xem §2.3) |
| 3 đến N | transferRequestParameterRecord | Dữ liệu | Tối đa `maxBlockLen - 2` byte |

**Độ dài request tối đa**: `maxBlockLen` byte (bao gồm SID + blockSeqCtr + data).

**Độ dài block cuối**: Có thể nhỏ hơn `maxBlockLen` — client gửi đúng số byte còn lại.

### 2.3 Format Positive Response — TransferData (0x76)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x76` | RSID của TransferData |
| 2 | blockSequenceCounter | Echo từ request | Server echo lại blockSeqCtr để xác nhận block đã nhận |
| 3 đến N | transferResponseParameterRecord | Tùy OEM | Dữ liệu phản hồi nếu OEM định nghĩa; thường trống |

Phần lớn ECU chỉ trả `0x76 [blockSeqCtr]` — 2 byte.

### 2.4 blockSequenceCounter — Quy tắc đầy đủ

```
Giá trị ban đầu (block đầu tiên sau 0x34): 0x01
Tăng dần: 0x01 → 0x02 → ... → 0xFE → 0xFF → 0x00 → 0x01 → ...
                                               ^^^^
                                               Sau 0xFF, quay về 0x00 (KHÔNG phải 0x01)
```

**Bảng quy tắc blockSequenceCounter:**

| Block | blockSeqCtr gửi | Ghi chú |
|---|---|---|
| Block đầu tiên (sau 0x34 mới) | `0x01` | Reset về 0x01 |
| Block thứ 2 | `0x02` | |
| … | … | |
| Block thứ 255 | `0xFF` | |
| Block thứ 256 | `0x00` | **Wrap: về 0x00, không phải 0x01** |
| Block thứ 257 | `0x01` | Tiếp tục cycle |
| Sau RequestTransferExit + RequestDownload mới | `0x01` | Reset lại |

> **⚠️ Cạm bẫy:** Sau 0xFF phải wrap về **`0x00`**, không phải `0x01`. Nhiều implementation lỗi ở điểm này, gây NRC `0x73` (wrongBlockSequenceCounter) từ block thứ 256 trở đi.

### 2.5 NRC của SID 0x36 — TransferData

| NRC | Tên | Điều kiện |
|---|---|---|
| `0x13` | incorrectMessageLengthOrInvalidFormat | Request < 2 byte, hoặc data > maxBlockLen |
| `0x22` | conditionsNotCorrect | Gọi 0x36 mà không có 0x34 trước; hoặc sau 0x37 mà không có 0x34 mới |
| `0x31` | requestOutOfRange | Tổng byte gửi vượt `memorySize` |
| `0x71` | transferDataSuspended | Server tạm dừng nhận dữ liệu (bận internal erase/write) |
| `0x72` | generalProgrammingFailure | Lỗi flash write (ECC error, write verify fail, …) |
| `0x73` | wrongBlockSequenceCounter | `blockSeqCtr` không khớp với giá trị server mong đợi |
| `0x92` | voltageTooHigh | Điện áp cung cấp cho flash quá cao |
| `0x93` | voltageTooLow | Điện áp quá thấp để lập trình flash |

---

## 3. SID 0x37 — RequestTransferExit

### 3.1 Định nghĩa

Kết thúc một download session. Client gửi sau khi đã truyền **đủ** `memorySize` byte qua 0x36. Server xác nhận đã nhận đủ dữ liệu, thực hiện verify (CRC, hash) nếu cần, và giải phóng transfer state.

### 3.2 Format Request — RequestTransferExit (0x37)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x37` | RequestTransferExit |
| 2 đến N | transferRequestParameterRecord | Tùy OEM (0–n byte) | Dữ liệu bổ sung OEM định nghĩa (ví dụ: CRC của toàn bộ dữ liệu) |

Trong phần lớn trường hợp, request chỉ là **1 byte** (`0x37`). Một số OEM mở rộng để client gửi checksum để server verify.

### 3.3 Format Positive Response — RequestTransferExit (0x77)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x77` | RSID của RequestTransferExit |
| 2 đến N | transferResponseParameterRecord | Tùy OEM (0–n byte) | Ví dụ: kết quả verify từ server |

Trong phần lớn trường hợp, response chỉ là **1 byte** (`0x77`).

### 3.4 NRC của SID 0x37 — RequestTransferExit

| NRC | Tên | Điều kiện |
|---|---|---|
| `0x13` | incorrectMessageLengthOrInvalidFormat | Sai length (ví dụ OEM định nghĩa transferRequestParameterRecord cố định) |
| `0x22` | conditionsNotCorrect | Không có transfer đang diễn ra (chưa gọi 0x34) |
| `0x72` | generalProgrammingFailure | Lỗi final verify (CRC mismatch, checksum sai) |

---

## 4. Luồng Transfer đầy đủ — Download Sequence

### 4.1 Sequence diagram

```
Client                              Server (ECU Boot)
  |                                       |
  |--- 10 02 -------------------------------->|  DiagnosticSessionControl → Programming
  |<-- 50 02 [P2 P2*] -------------------|
  |                                       |
  |--- 27 01 -------------------------------->|  SecurityAccess: requestSeed
  |<-- 67 01 [seed bytes] ---------------|
  |                                       |
  |--- 27 02 [key bytes] ----------------->|  SecurityAccess: sendKey
  |<-- 67 02 ----------------------------|
  |                                       |
  |--- 34 00 44  [addr 4B]  [size 4B] ---->|  RequestDownload
  |<-- 74 20 [maxBlockLen 2B] ------------|
  |                                       |
  |--- 36 01 [data block 1] ------------->|  TransferData block 01
  |<-- 76 01 ----------------------------|
  |                                       |
  |--- 36 02 [data block 2] ------------->|  TransferData block 02
  |<-- 76 02 ----------------------------|
  |         ...                           |
  |--- 36 NN [data block last] ---------->|  TransferData block cuối
  |<-- 76 NN ----------------------------|
  |                                       |
  |--- 37 --------------------------------->|  RequestTransferExit
  |<-- 77 --------------------------------|
  |                                       |
  |--- 31 01 FF 01 ----------------------->|  RoutineControl: CheckProgrammingIntegrity (tùy OEM)
  |<-- 71 01 FF 01 [result] -------------|
  |                                       |
  |--- 11 01 -------------------------------->|  ECUReset → Hard Reset
  |<-- 51 01 ----------------------------|
```

### 4.2 Tính số block cần gửi

$$\text{total blocks} = \left\lceil \frac{\text{memorySize}}{\text{maxBlockLen} - 2} \right\rceil$$

**Ví dụ:** `memorySize = 0x00020000 = 131072` byte, `maxBlockLen = 0x0102 = 258`:

$$\text{data per block} = 258 - 2 = 256 \text{ byte}$$

$$\text{total blocks} = \left\lceil \frac{131072}{256} \right\rceil = 512 \text{ blocks}$$

Block 1–511: Mỗi block 256 byte dữ liệu.  
Block 512 (cuối): Đúng 256 byte (vì 131072 chia hết 256). Nếu không chia hết, block cuối có thể ít hơn 256 byte.

### 4.3 Ví dụ trace đầy đủ – 3 block nhỏ (demo)

**Setup**: memorySize = 600 byte, maxBlockLen = 258 (data/block = 256 byte).

```
STEP 1 – RequestDownload
  REQUEST:  34 00 44  08 01 00 00  00 00 02 58
                      ─────────── ───────────
                      addr: 0x08010000  size: 0x258 = 600 bytes

  RESPONSE: 74 20 01 02
                 ─────
                 maxBlockLen = 0x0102 = 258

STEP 2 – TransferData block 01 (bytes 0–255, 256 byte)
  REQUEST:  36 01 [data 256 bytes]
            ── ──
            SID blockSeqCtr=0x01

  RESPONSE: 76 01
               ── blockSeqCtr echo

STEP 3 – TransferData block 02 (bytes 256–511, 256 byte)
  REQUEST:  36 02 [data 256 bytes]
               ── blockSeqCtr=0x02

  RESPONSE: 76 02

STEP 4 – TransferData block 03 (bytes 512–599, 88 byte cuối cùng)
  REQUEST:  36 03 [data 88 bytes]
               ── blockSeqCtr=0x03
            Tổng request = 1+1+88 = 90 bytes (< maxBlockLen, hợp lệ)

  RESPONSE: 76 03

STEP 5 – RequestTransferExit
  REQUEST:  37
  RESPONSE: 77
```

---

## 5. Xử lý lỗi mid-transfer

### 5.1 ECU trả NRC 0x78 (requestCorrectlyReceivedResponsePending)

Server cần thời gian dài hơn `P2Server` để xử lý (ví dụ: erase flash sector trước khi ghi). Server gửi `0x7F 0x34 0x78` để giữ kết nối, sau đó gửi positive response khi sẵn sàng.

```
CLIENT → 34 00 44  08 01 00 00  00 02 00 00
SERVER → 7F 34 78   ← Pending: "Đang erase flash, đợi..."
SERVER → 7F 34 78   ← Tiếp tục chờ...
SERVER → 74 20 01 02  ← OK! Transfer ready.
```

Client phải **không reset timer** khi nhận `0x78` — giữ session alive bằng cách không tăng session timer. Tổng thời gian chờ có thể lên đến `P2*Server` (thường 5000–10000 ms).

### 5.2 Sai blockSequenceCounter (NRC 0x73)

```
Client gửi sai counter (ví dụ skip từ 0x01 → 0x03):

  CLIENT → 36 01 [data]
  SERVER → 76 01
  CLIENT → 36 03 [data]   ← Lỗi: expected 0x02
  SERVER → 7F 36 73       ← wrongBlockSequenceCounter

Sau NRC 0x73:
- Transfer state bị hủy. Client phải gọi lại 0x34 từ đầu.
- Không có cơ chế "retry block" trong ISO 14229-1.
```

### 5.3 Flash write failure (NRC 0x72)

```
  CLIENT → 36 07 [data]
  SERVER → 7F 36 72   ← generalProgrammingFailure

Nguyên nhân phổ biến:
- ECC lỗi khi ghi flash (flash cell bị hỏng)
- Điện áp VPP không đủ trong quá trình program
- Flash sector chưa được erase nhưng cố ghi (vì memorySize đã khai báo chồng vùng chưa erase)
- Write verify fail: dữ liệu đọc lại ≠ dữ liệu vừa ghi

Sau NRC 0x72: Transfer state không xác định. Thông thường phải:
1. Gọi RequestTransferExit (0x37) nếu có thể
2. Hoặc reset ECU → bắt đầu lại từ DiagnosticSessionControl
```

### 5.4 Session timeout trong quá trình transfer

Nếu S3Server timeout hết hiệu lực (client không gửi gì trong > S3Server ms), ECU thoát Programming Session → về Default Session → transfer state bị hủy. Client nhận NRC `0x22` ở block tiếp theo.

**Giải pháp:** Client gửi `TesterPresent` (0x3E 0x00) định kỳ giữa các block nếu thời gian xử lý giữa các block dài.

---

## 6. Nhiều vùng nhớ — Multiple Download Segments

Một firmware thường gồm nhiều segment (flash app + calibration + bootloader config). Mỗi segment cần một lần RequestDownload riêng:

```
SEGMENT 1: Application code (0x08010000, 0x00020000)
─────────────────────────────────────────────────────
  34 [0x08010000] [0x20000]  → 74 20 01 02
  36 01 [256B] → 76 01
  36 02 [256B] → 76 02
  ...
  36 80 [256B] → 76 80       (128 blocks × 256B = 32768B = 32KB/segment)
  37 → 77

SEGMENT 2: Calibration data (0x08030000, 0x00008000)
─────────────────────────────────────────────────────
  34 [0x08030000] [0x8000]   → 74 20 01 02
  36 01 [256B] → 76 01       ← Counter RESET về 0x01 cho download mới
  ...
  37 → 77
```

> **💡 Điểm mấu chốt:** `blockSequenceCounter` được reset về `0x01` sau **mỗi** RequestDownload mới. Mỗi segment là một download độc lập.

---

## 7. AUTOSAR Stack — Liên hệ với Dcm / MemIf / Fls

### 7.1 Kiến trúc AUTOSAR cho download

```
 Tester (PC/Flasher)
        │ ISO 15765-2 (CAN-TP) / DoIP
        ▼
 ┌────────────────┐
 │  Dcm (module) │  ← Xử lý SID 0x34, 0x36, 0x37
 └───────┬────────┘
         │ Dcm_WriteDataByIdentifier / Dcm callbacks
         ▼
 ┌────────────────┐
 │  FBL / Appl   │  ← Flash Bootloader tùy OEM
 └───────┬────────┘
         │ MemIf_Write()
         ▼
 ┌────────────────┐
 │  MemIf        │  ← Memory Abstraction Interface
 └───────┬────────┘
         │ Fee_Write() / Ea_Write()
         ▼
 ┌────────────────┐
 │  Fls / Eep    │  ← Flash Driver / EEPROM Driver
 └────────────────┘
```

### 7.2 Dcm configuration cho 0x34

Trong AUTOSAR Dcm, SID 0x34 được xử lý bởi **Upload/Download functional unit**. Các callback quan trọng:

| Callback | Thời điểm gọi | Mô tả |
|---|---|---|
| `Dcm_ProcessRequestDownload()` | Khi nhận 0x34 request | Validate address/size, trả về maxBlockLen |
| `Dcm_ProcessTransferDataWrite()` | Mỗi 0x36 request | Ghi block dữ liệu vào Fls |
| `Dcm_ProcessRequestTransferExit()` | Khi nhận 0x37 | Finalize, verify nếu cần |

**Ví dụ callback prototype (AUTOSAR SWS_Dcm):**

```c
/* Called when 0x34 is received */
Std_ReturnType Dcm_ProcessRequestDownload(
    Dcm_OpStatusType OpStatus,
    uint8 dataFormatIdentifier,
    uint32 memoryAddress,
    uint32 memorySize,
    uint32 *blockLength,          /* OUT: maxNumberOfBlockLength */
    Dcm_NegativeResponseCodeType *ErrorCode  /* OUT: NRC nếu reject */
);

/* Called for each 0x36 block */
Std_ReturnType Dcm_ProcessTransferDataWrite(
    Dcm_OpStatusType OpStatus,
    uint8 blockId,               /* blockSequenceCounter */
    uint16 blockDataLength,      /* Số byte trong block này */
    uint8 *blockData,            /* Con trỏ tới dữ liệu */
    Dcm_NegativeResponseCodeType *ErrorCode
);

/* Called when 0x37 is received */
Std_ReturnType Dcm_ProcessRequestTransferExit(
    Dcm_OpStatusType OpStatus,
    uint8 *transferRequestParameterRecord,
    uint16 transferRequestParameterRecordSize,
    uint8 *transferResponseParameterRecord,  /* OUT */
    uint16 *transferResponseParameterRecordSize,  /* OUT */
    Dcm_NegativeResponseCodeType *ErrorCode
);
```

### 7.3 Ví dụ triển khai minimal

```c
/* Trong Flash Bootloader — ví dụ minh họa (STM32 HAL) */

static uint32_t g_downloadAddress;  /* Lưu địa chỉ từ 0x34 */
static uint32_t g_downloadSize;     /* Lưu size từ 0x34 */
static uint32_t g_bytesReceived;    /* Đếm byte đã nhận */
static uint8_t  g_expectedBlockSeq; /* blockSeqCtr mong đợi */

Std_ReturnType Dcm_ProcessRequestDownload(
    Dcm_OpStatusType OpStatus,
    uint8 dataFormatIdentifier,
    uint32 memoryAddress,
    uint32 memorySize,
    uint32 *blockLength,
    Dcm_NegativeResponseCodeType *ErrorCode)
{
    /* Kiểm tra DFI: chỉ chấp nhận 0x00 (no compress/encrypt) */
    if (dataFormatIdentifier != 0x00u) {
        *ErrorCode = DCM_E_REQUESTOUTOFRANGE;
        return E_NOT_OK;
    }

    /* Kiểm tra địa chỉ nằm trong flash app region */
    if (memoryAddress < FLASH_APP_START ||
        (memoryAddress + memorySize) > FLASH_APP_END) {
        *ErrorCode = DCM_E_REQUESTOUTOFRANGE;
        return E_NOT_OK;
    }

    /* Erase flash trước khi nhận dữ liệu */
    /* (Nếu cần nhiều thời gian: trả về DCM_E_PENDING để Dcm gửi 0x78) */
    if (Flash_EraseRegion(memoryAddress, memorySize) != E_OK) {
        *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
        return E_NOT_OK;
    }

    /* Lưu context */
    g_downloadAddress = memoryAddress;
    g_downloadSize    = memorySize;
    g_bytesReceived   = 0u;
    g_expectedBlockSeq = 0x01u;

    /* Báo maxBlockLen = 258 (256 byte data + 2 overhead) */
    *blockLength = 258u;

    return E_OK;
}

Std_ReturnType Dcm_ProcessTransferDataWrite(
    Dcm_OpStatusType OpStatus,
    uint8 blockId,
    uint16 blockDataLength,
    uint8 *blockData,
    Dcm_NegativeResponseCodeType *ErrorCode)
{
    /* Kiểm tra blockSequenceCounter */
    if (blockId != g_expectedBlockSeq) {
        *ErrorCode = DCM_E_WRONGBLOCKSEQUENCECOUNTER;
        return E_NOT_OK;
    }

    /* Kiểm tra không vượt tổng size */
    if ((g_bytesReceived + blockDataLength) > g_downloadSize) {
        *ErrorCode = DCM_E_REQUESTOUTOFRANGE;
        return E_NOT_OK;
    }

    /* Ghi vào flash */
    uint32_t writeAddr = g_downloadAddress + g_bytesReceived;
    if (HAL_FLASH_Program_Buffer(writeAddr, blockData, blockDataLength) != HAL_OK) {
        *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
        return E_NOT_OK;
    }

    g_bytesReceived += blockDataLength;

    /* Tăng counter: sau 0xFF → wrap về 0x00 */
    if (g_expectedBlockSeq == 0xFFu) {
        g_expectedBlockSeq = 0x00u;
    } else {
        g_expectedBlockSeq++;
    }

    return E_OK;
}

Std_ReturnType Dcm_ProcessRequestTransferExit(
    Dcm_OpStatusType OpStatus,
    uint8 *transferRequestParameterRecord,
    uint16 transferRequestParameterRecordSize,
    uint8 *transferResponseParameterRecord,
    uint16 *transferResponseParameterRecordSize,
    Dcm_NegativeResponseCodeType *ErrorCode)
{
    /* Kiểm tra đã nhận đủ số byte */
    if (g_bytesReceived != g_downloadSize) {
        *ErrorCode = DCM_E_GENERALPROGRAMMINGFAILURE;
        return E_NOT_OK;
    }

    /* Verify nội dung flash nếu cần (CRC) */
    /* ... */

    *transferResponseParameterRecordSize = 0u;
    return E_OK;
}
```

> **💡 Điểm mấu chốt về `blockSequenceCounter` wrap:** Dùng `if (counter == 0xFF) counter = 0x00` — **không** dùng `counter = (counter + 1) % 256` vì `% 256` trả về `0x00` sau `0xFF`, đúng hành vi — nhưng cần nhớ wrap là về `0x00` chứ không phải `0x01`.

---

## 8. Bảng tóm tắt toàn bộ upload/download services

| Service | SID / RSID | Vai trò | Lúc nào dùng |
|---|---|---|---|
| RequestDownload | `0x34` / `0x74` | Khởi tạo download, lấy maxBlockLen | Trước TransferData |
| RequestUpload | `0x35` / `0x75` | Khởi tạo upload (ECU → client) | Trước TransferData đọc |
| TransferData | `0x36` / `0x76` | Gửi/nhận từng block dữ liệu | Sau 0x34 hoặc 0x35 |
| RequestTransferExit | `0x37` / `0x77` | Kết thúc transfer | Sau block cuối cùng 0x36 |
| RequestFileTransfer | `0x38` / `0x78` | Transfer file (tên file rõ ràng) | AUTOSAR Adaptive / DoIP |

---

## 9. Checklist lập trình

Trước khi tích hợp SID 0x34 vào ECU:

| # | Checklist item | Lý do |
|---|---|---|
| 1 | `blockSeqCtr` wrap về `0x00` sau `0xFF` (không phải `0x01`) | Bug phổ biến gây NRC 0x73 |
| 2 | `maxNumberOfBlockLength` bao gồm cả 2 byte overhead (SID + seqCtr) | Kích thước buffer nhận phải = maxBlockLen, không phải maxBlockLen + 2 |
| 3 | Flash erase trước khi nhận dữ liệu (không phải erase từng sector khi ghi) | Tránh NRC 0x72 do ghi vào vùng chưa erase |
| 4 | Xử lý `DCM_E_PENDING` khi erase cần > P2Server ms | Gửi `0x78` pending response tránh session timeout |
| 5 | Reset `blockSeqCtr` về `0x01` sau mỗi RequestDownload mới | Mỗi segment là counter độc lập |
| 6 | Kiểm tra `memorySize > 0` trước khi erase | Erase với size=0 → undefined behavior trên nhiều flash driver |
| 7 | Physical addressing cho 0x34 (không dùng 0x7DF) | Functional addressing không hợp lệ |
| 8 | TesterPresent định kỳ giữa các block nếu xử lý chậm | Tránh S3Server timeout trong quá trình transfer |

---

*Quay lại: [SID 0x34 – Part 1: Parameters chi tiết (DFI, ALFID, maxBlockLen)](/uds/uds-sid-0x34-p1/)*
