---
layout: default
category: uds_sid
title: "UDS - Service ID 0x34 RequestDownload (Part 1)"
nav_exclude: true
module: true
tags: [autosar, uds, diagnostics, iso-14229, protocol, download, transfer, programming]
description: "SID 0x34 RequestDownload – tổng quan, cấu trúc request/response, dataFormatIdentifier, addressAndLengthFormatIdentifier, maxNumberOfBlockLength, NRC theo ISO 14229-1:2020."
permalink: /uds/uds-sid-0x34-p1/
---

# UDS - SID 0x34: RequestDownload (Part 1)

> **Tài liệu chuẩn:** ISO 14229-1:2020, Clause 14.1 — Upload/Download functional unit.  
> **Phạm vi:** SID `0x34` dùng để khởi tạo quá trình truyền dữ liệu từ **client → server** (download). Không có sub-function byte. Part 2 trình bày luồng đầy đủ với SID 0x36 (TransferData) và 0x37 (RequestTransferExit).

---

## 1. Tổng quan SID 0x34

### 1.1 Vai trò trong Upload/Download Unit

SID 0x34 là điểm khởi đầu bắt buộc của mọi quá trình download dữ liệu lên ECU (firmware, calibration data, bootloader, …). Client thông báo cho server:

- **Địa chỉ bắt đầu** vùng nhớ sẽ ghi.
- **Kích thước tổng** dữ liệu sẽ truyền.
- **Phương thức nén/mã hóa** (nếu có).

Server kiểm tra điều kiện, rồi trả về **kích thước block tối đa** mà mỗi lần gọi TransferData (0x36) có thể gửi.

```
Client                            Server (ECU)
  |                                    |
  |--- 0x34 [DFI] [ALFID] [Addr] [Sz] --->|   RequestDownload
  |<-- 0x74 [LFI] [maxBlockLen] ---------|   Positive Response
  |                                    |
  |--- 0x36 [01] [data block 1...] ---->|   TransferData (block 1)
  |<-- 0x76 [01] ----------------------|
  |                                    |
  |--- 0x36 [02] [data block 2...] ---->|   TransferData (block 2)
  |<-- 0x76 [02] ----------------------|
  |               ...                  |
  |--- 0x37 --------------------------->|   RequestTransferExit
  |<-- 0x77 ----------------------------|
```

### 1.2 Các thông số định danh service

| Thuộc tính | Giá trị |
|---|---|
| Service ID (SID) | `0x34` |
| Response SID (RSID) | `0x74` |
| Negative Response SID | `0x7F` |
| Sub-function | **Không có** |
| suppressPosRspMsgIndicationBit | **Không áp dụng** |
| Session mặc định | **Không hỗ trợ** |
| Programming Session (0x02) | **Hỗ trợ** |
| Extended Session (0x03) | Tùy OEM |
| Security Access yêu cầu | Thường **Bắt buộc** (trước khi gọi 0x34) |

### 1.3 NRC tổng quan

| NRC | Tên | Điều kiện kích hoạt |
|---|---|---|
| `0x13` | incorrectMessageLengthOrInvalidFormat | Length request không khớp với ALFID, hoặc ALFID/DFI có nibble reserved |
| `0x22` | conditionsNotCorrect | Sai session; đang có transfer khác chưa kết thúc; điều kiện programming chưa đáp ứng |
| `0x31` | requestOutOfRange | `memoryAddress` hoặc `memorySize` nằm ngoài vùng cho phép; ALFID nibble = 0x0 |
| `0x33` | securityAccessDenied | Security Access (SID 0x27) chưa được cấp |
| `0x70` | uploadDownloadNotAccepted | ECU không thể chấp nhận download lúc này (tài nguyên không đủ, sai trạng thái nội bộ, cấu hình địa chỉ không hợp lệ) |

> **Không có NRC `0x12`** — 0x34 không có sub-function, vì vậy `subFunctionNotSupported` không được phép.

---

## 2. Cấu trúc Request

### 2.1 Format Request

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x34` | RequestDownload |
| 2 | dataFormatIdentifier | `0x00`–`0xFF` | Phương thức nén và mã hóa (xem §2.2) |
| 3 | addressAndLengthFormatIdentifier | `0x11`–`0x44` | Số byte cho memoryAddress và memorySize (xem §2.3) |
| 4 đến (3+A) | memoryAddress | A byte (big-endian) | Địa chỉ bắt đầu vùng nhớ cần ghi |
| (4+A) đến (3+A+L) | memorySize | L byte (big-endian) | Tổng số byte cần truyền |

Trong đó:
- **A** = `addressAndLengthFormatIdentifier AND 0x0F` (low nibble = `lengthOfMemoryAddress`)
- **L** = `(addressAndLengthFormatIdentifier >> 4) AND 0x0F` (high nibble = `lengthOfMemorySize`)

**Chiều dài request**: `3 + A + L` byte.

### 2.2 dataFormatIdentifier (DFI)

1 byte. Định nghĩa phương thức xử lý dữ liệu trước khi truyền.

```
  Bit 7  6  5  4  |  3  2  1  0
  ─────────────── | ───────────
  compressionMethod | encryptingMethod
  (high nibble)     | (low nibble)
```

**compressionMethod (bits 7–4):**

| Giá trị | Ý nghĩa |
|---|---|
| `0x0` | noCompression – dữ liệu không nén (phổ biến nhất) |
| `0x1`–`0xE` | OEM-defined — phương thức nén do OEM định nghĩa |
| `0xF` | ISOSAEReserved — không sử dụng |

**encryptingMethod (bits 3–0):**

| Giá trị | Ý nghĩa |
|---|---|
| `0x0` | noEncryption – dữ liệu không mã hóa (phổ biến nhất) |
| `0x1`–`0xE` | OEM-defined — phương thức mã hóa do OEM định nghĩa |
| `0xF` | ISOSAEReserved — không sử dụng |

**Giá trị thường dùng:**

| DFI | Diễn giải |
|---|---|
| `0x00` | Không nén, không mã hóa — phổ biến nhất |
| `0x10` | Nén OEM method 1, không mã hóa |
| `0x01` | Không nén, mã hóa OEM method 1 |
| `0x11` | Nén + mã hóa OEM method 1 |

> **⚠️ Cạm bẫy:** Nếu server không hỗ trợ phương thức nén/mã hóa được yêu cầu → NRC `0x31` (requestOutOfRange) hoặc `0x70` (uploadDownloadNotAccepted) — tùy triển khai ECU.

### 2.3 addressAndLengthFormatIdentifier (ALFID)

1 byte. Mã hóa số byte dùng cho `memoryAddress` (A) và `memorySize` (L).

```
  Bit 7  6  5  4  |  3  2  1  0
  ─────────────── | ───────────
  lengthOfMemorySize (L) | lengthOfMemoryAddress (A)
  (high nibble)           | (low nibble)
```

**lengthOfMemorySize – high nibble:**

| Giá trị | Số byte cho memorySize |
|---|---|
| `0x0` | **Reserved** — không hợp lệ → NRC `0x31` |
| `0x1` | 1 byte (max 255 B) |
| `0x2` | 2 byte (max 65 535 B ≈ 64 KB) |
| `0x3` | 3 byte (max 16 777 215 B ≈ 16 MB) |
| `0x4` | 4 byte (max 4 294 967 295 B ≈ 4 GB) |
| `0x5`–`0xF` | **Reserved** — không hợp lệ |

**lengthOfMemoryAddress – low nibble:**

| Giá trị | Số byte cho memoryAddress |
|---|---|
| `0x0` | **Reserved** — không hợp lệ → NRC `0x31` |
| `0x1` | 1 byte (địa chỉ 8-bit, ví dụ EEPROM nhỏ) |
| `0x2` | 2 byte (địa chỉ 16-bit) |
| `0x3` | 3 byte (địa chỉ 24-bit) |
| `0x4` | 4 byte (địa chỉ 32-bit, phổ biến nhất cho 32-bit MCU) |
| `0x5`–`0xF` | **Reserved** — không hợp lệ |

**Giá trị ALFID thường gặp:**

| ALFID | A (addr) | L (size) | Chiều dài request | Dùng trong |
|---|---|---|---|---|
| `0x44` | 4 byte | 4 byte | 11 byte | ARM Cortex-M, 32-bit flash |
| `0x34` | 4 byte | 3 byte | 10 byte | Flash ≤ 16 MB |
| `0x24` | 4 byte | 2 byte | 9 byte | Flash ≤ 64 KB |
| `0x14` | 4 byte | 1 byte | 8 byte | Flash ≤ 255 B (hiếm) |
| `0x23` | 3 byte | 2 byte | 8 byte | Địa chỉ 24-bit (ARM Cortex-M0+) |
| `0x11` | 1 byte | 1 byte | 5 byte | EEPROM nhỏ |

> **💡 Điểm mấu chốt:** ALFID `0x44` là phổ biến nhất cho ECU ô tô dùng vi xử lý 32-bit. Byte order là **big-endian** cho cả `memoryAddress` lẫn `memorySize`.

### 2.4 memoryAddress

- Độ dài: **A byte** (big-endian), với A = low nibble của ALFID.
- Ý nghĩa: Địa chỉ bắt đầu của vùng nhớ server sẽ ghi dữ liệu vào.
- Server kiểm tra địa chỉ này có nằm trong vùng cho phép download hay không.
- Nếu nằm ngoài vùng hoặc địa chỉ không hợp lệ → NRC `0x31`.

### 2.5 memorySize

- Độ dài: **L byte** (big-endian), với L = high nibble của ALFID.
- Ý nghĩa: Tổng số byte client sẽ truyền qua TransferData (0x36) sau khi RequestDownload thành công.
- Server sử dụng giá trị này để kiểm tra xem vùng nhớ `[memoryAddress, memoryAddress + memorySize - 1]` có toàn bộ nằm trong vùng cho phép hay không.
- `memorySize = 0x00...00` là giá trị không hợp lệ → NRC `0x31`.

---

## 3. Cấu trúc Positive Response

### 3.1 Format Positive Response

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x74` | RSID của RequestDownload |
| 2 | lengthFormatIdentifier | `0x10`–`0x40` | High nibble = số byte của maxNumberOfBlockLength (xem §3.2) |
| 3 đến (2+M) | maxNumberOfBlockLength | M byte (big-endian) | Block size tối đa cho mỗi lần gọi SID 0x36 (xem §3.3) |

Trong đó: **M** = `(lengthFormatIdentifier >> 4) AND 0x0F` (high nibble của lengthFormatIdentifier).

**Chiều dài response**: `2 + M` byte.

### 3.2 lengthFormatIdentifier (LFI)

1 byte. Cho client biết field `maxNumberOfBlockLength` rộng bao nhiêu byte.

```
  Bit 7  6  5  4  |  3  2  1  0
  ─────────────── | ───────────
  Số byte của       | Reserved = 0x0
  maxNumberOfBlockLength
  (high nibble = M)
```

**High nibble (M) — số byte của maxNumberOfBlockLength:**

| Giá trị | Số byte | maxBlockLen tối đa |
|---|---|---|
| `0x1` | 1 byte | 255 byte |
| `0x2` | 2 byte | 65 535 byte (phổ biến nhất) |
| `0x3` | 3 byte | 16 777 215 byte |
| `0x4` | 4 byte | 4 294 967 295 byte |

**Low nibble: Luôn = 0x0** (reserved theo ISO 14229-1:2020).

**Giá trị LFI thường gặp:**

| LFI | M | Diễn giải |
|---|---|---|
| `0x20` | 2 | maxBlockLen được mã hóa trong 2 byte tiếp theo |
| `0x10` | 1 | maxBlockLen được mã hóa trong 1 byte tiếp theo |

> **⚠️ Cạm bẫy:** Low nibble của LFI phải = `0x0`. Một số ECU trả LFI = `0x21` (low nibble ≠ 0) — đây là lỗi implementation, nhưng một số test tool vẫn chấp nhận. Khi phân tích trace, kiểm tra low nibble.

### 3.3 maxNumberOfBlockLength

- Độ dài: **M byte** (big-endian), với M = high nibble của LFI.
- Ý nghĩa: Số byte tối đa client có thể gửi trong **một** request TransferData (0x36), **bao gồm**:
  - 1 byte SID (`0x36`)
  - 1 byte `blockSequenceCounter`
  - N byte `transferRequestParameterRecord` (dữ liệu thực sự)

```
maxNumberOfBlockLength = 1 (SID) + 1 (blockSeqCtr) + [dữ liệu thực]
                         ──────────────────────────   ───────────────
                         2 byte overhead               dữ liệu gửi được
```

**Công thức tính dữ liệu thực mỗi block:**

$$\text{data per block} = \text{maxNumberOfBlockLength} - 2$$

**Ví dụ:**

| maxNumberOfBlockLength | Dữ liệu thực / block | Ghi chú |
|---|---|---|
| `0x0082` = 130 | 128 byte | Block nhỏ, CAN bus (8 byte/frame, ISO 15765-2) |
| `0x0102` = 258 | 256 byte | Phổ biến trên CAN FD |
| `0x0402` = 1026 | 1024 byte | Phổ biến trên Ethernet/DoIP |
| `0x1002` = 4098 | 4096 byte | Ethernet, flash sector size |

> **💡 Điểm mấu chốt:** `maxNumberOfBlockLength` là giới hạn server đặt ra. Client phải gửi mỗi block **≤ maxNumberOfBlockLength** byte. Client **có thể** gửi block nhỏ hơn — đặc biệt ở block cuối cùng khi dữ liệu không chia hết.

---

## 4. Điều kiện Positive/Negative Response

### 4.1 Điều kiện Positive Response

1. Session là **Programming Session** (`0x10 0x02`) hoặc session khác được ECU cấu hình hỗ trợ.
2. **Security Access** đã được cấp (SID `0x27` đã xác thực thành công).
3. `dataFormatIdentifier` có nibble `compressionMethod` và `encryptingMethod` nằm trong range server hỗ trợ.
4. `addressAndLengthFormatIdentifier`: cả hai nibble (A và L) thuộc `0x1`–`0x4`.
5. `memoryAddress` nằm trong vùng nhớ server cho phép download.
6. Vùng nhớ `[memoryAddress, memoryAddress + memorySize - 1]` hoàn toàn hợp lệ và không chồng lên vùng bảo vệ.
7. `memorySize > 0`.
8. Không có transfer nào đang diễn ra (server chưa nhận 0x34 / 0x35 chưa kết thúc bằng 0x37).
9. Chiều dài request = `3 + A + L` byte (khớp với ALFID).

### 4.2 Điều kiện Negative Response chi tiết

| Điều kiện | NRC | Giải thích |
|---|---|---|
| Chiều dài request ≠ `3 + A + L` | `0x13` | ALFID khai báo A=4, L=4 nhưng message chỉ có 9 byte thay vì 11 |
| Low nibble hoặc high nibble ALFID = `0x0` | `0x31` | Reserved value — địa chỉ 0 byte hoặc size 0 byte |
| Low nibble hoặc high nibble ALFID ≥ `0x5` | `0x31` | Reserved range (0x5–0xF) |
| Sai session (ví dụ Default Session) | `0x22` | ECU chỉ cho phép 0x34 trong Programming Session |
| Security Access chưa cấp | `0x33` | Client chưa gọi 0x27 hoặc seed-key sai |
| `memoryAddress` ngoài vùng hợp lệ | `0x31` | Địa chỉ không thuộc flash region download |
| `memorySize = 0` | `0x31` | Kích thước bằng 0 không hợp lệ |
| Vùng nhớ vượt ranh giới flash sector | `0x31` | Phụ thuộc server — một số ECU reject nếu span nhiều segment |
| `compressionMethod` / `encryptingMethod` không hỗ trợ | `0x31` hoặc `0x70` | Tùy triển khai |
| ECU đang bận, tài nguyên không đủ | `0x70` | uploadDownloadNotAccepted |
| Transfer trước chưa kết thúc (thiếu 0x37) | `0x22` | conditionsNotCorrect |

---

## 5. Trường hợp đặc biệt

1. **Không có sub-function**: SID 0x34 không có byte sub-function. Byte 2 là `dataFormatIdentifier` — không phải sub-function. Không có `suppressPosRspMsgIndicationBit`.

2. **Security Access bắt buộc trước 0x34**: Hầu hết ECU production đều yêu cầu unlock security trước khi gọi RequestDownload. Nếu gọi 0x34 khi chưa có security → NRC `0x33`.

3. **Transfer chưa kết thúc**: Nếu client gọi 0x34 mới khi transfer cũ chưa kết thúc bằng 0x37 → NRC `0x22` (conditionsNotCorrect). Một số ECU tự reset transfer state sau timeout (S3Server, programming session timeout).

4. **Địa chỉ alignment**: Nhiều flash controller yêu cầu `memoryAddress` phải aligned với sector boundary (ví dụ: 0x1000, 0x2000, …). Địa chỉ lệch → NRC `0x31`. Kiểm tra AUTOSAR NvM/Flash driver configuration.

5. **memorySize khác với tổng dữ liệu thực tế gửi**: Nếu tổng byte truyền qua 0x36 không bằng `memorySize` → tại thời điểm gọi RequestTransferExit (0x37), server có thể trả NRC `0x13` hoặc `0x70` tùy implementation.

6. **Functional addressing (0x7DF)**: SID 0x34 phải dùng **physical addressing** (unicast). Không gửi qua functional addressing.

7. **P2Server và P2*Server timeout**: Download có thể cần nhiều thời gian xử lý trước khi server gửi response (đặc biệt khi server cần erase flash trước khi nhận dữ liệu). Client phải cấu hình timeout thích hợp, hoặc server dùng `0x78` (requestCorrectlyReceivedResponsePending) để giữ kết nối.

---

## 6. Ví dụ

### 6.1 Request thông thường – ALFID 0x44 (4-byte address, 4-byte size)

**Scenario**: Download firmware vào địa chỉ `0x08010000`, kích thước `0x00020000` (128 KB), không nén/mã hóa.

```
REQUEST:
  34  00  44  08 01 00 00  00 02 00 00
  ^^      SID: 0x34 (RequestDownload)
      ^^  dataFormatIdentifier: 0x00 (no compression, no encryption)
          compressionMethod = 0x0 (noCompression)
          encryptingMethod  = 0x0 (noEncryption)
          ^^ addressAndLengthFormatIdentifier: 0x44
             high nibble = 0x4 → L = 4 (memorySize = 4 bytes)
             low nibble  = 0x4 → A = 4 (memoryAddress = 4 bytes)
             ^^^^^^^^^ memoryAddress: 0x08010000 (big-endian)
                       ^^^^^^^^^ memorySize: 0x00020000 = 131072 bytes (128 KB)

POSITIVE RESPONSE:
  74  20  01 02
  ^^      RSID: 0x74
      ^^  lengthFormatIdentifier: 0x20
          high nibble = 0x2 → M = 2 (maxNumberOfBlockLength = 2 bytes)
          low nibble  = 0x0 (reserved)
          ^^^^^ maxNumberOfBlockLength: 0x0102 = 258 bytes
                → Dữ liệu thực mỗi block = 258 - 2 = 256 bytes
```

### 6.2 Negative Response – Security Access chưa cấp

```
REQUEST:  34 00 44  08 01 00 00  00 02 00 00
          (Gửi trong Programming Session nhưng chưa gọi SID 0x27)

RESPONSE: 7F 34 33
          ^^       NRS: Negative Response SID (0x7F)
             ^^    SID của request: 0x34
                ^^ NRC: 0x33 (securityAccessDenied)
```

### 6.3 Negative Response – Sai session

```
REQUEST:  34 00 44  08 01 00 00  00 02 00 00
          (Gửi trong Default Session)

RESPONSE: 7F 34 22
                ^^ NRC: 0x22 (conditionsNotCorrect)
```

### 6.4 Negative Response – ALFID reserved value

```
REQUEST:  34 00 04  08 01 00 00  00 02 00 00
                ^^
                ALFID: 0x04
                high nibble = 0x0 → Reserved! (L = 0 không hợp lệ)
                low nibble  = 0x4 → OK (A = 4)

RESPONSE: 7F 34 31
                ^^ NRC: 0x31 (requestOutOfRange)
```

### 6.5 ALFID 0x23 – Địa chỉ 3-byte, Size 2-byte (MCU 24-bit)

**Scenario**: Download vào EEPROM address `0x00F000`, size `0x0400` (1 KB), ALFID `0x23`.

```
REQUEST:
  34  00  23  00 F0 00  04 00
  ^^  ^^  ^^  ^^^^^^^^  ^^^^
  SID DFI ALFID          size: 0x0400 = 1024 bytes (2 bytes, L=2)
              high nibble=2 → L=2
              low nibble=3  → A=3
              memoryAddress: 0x00F000 (3 bytes)

POSITIVE RESPONSE:
  74  10  82
  ^^  ^^  ^^
  RSID LFI  maxBlockLen = 0x82 = 130 bytes
       ^^
       high nibble = 0x1 → M = 1 (1 byte cho maxBlockLen)
       Dữ liệu thực / block = 130 - 2 = 128 bytes
```

---

## 7. Bảng tóm tắt

| Tham số | Vị trí | Độ dài | Quy tắc đặc biệt |
|---|---|---|---|
| `serviceId` | Byte 1 | 1 byte | Luôn `0x34` |
| `dataFormatIdentifier` | Byte 2 | 1 byte | `0x00` = no compress/encrypt; nibble `0xF` = reserved |
| `addressAndLengthFormatIdentifier` | Byte 3 | 1 byte | Nibble `0x0` và `0x5`–`0xF` = reserved → NRC `0x31` |
| `memoryAddress` | Bytes 4–(3+A) | A byte (big-endian) | A = low nibble ALFID |
| `memorySize` | Bytes (4+A)–(3+A+L) | L byte (big-endian) | L = high nibble ALFID; `0x00..0` = reserved |
| RSID | Byte 1 response | 1 byte | Luôn `0x74` |
| `lengthFormatIdentifier` | Byte 2 response | 1 byte | High nibble = M; low nibble phải = `0x0` |
| `maxNumberOfBlockLength` | Bytes 3–(2+M) | M byte (big-endian) | M = high nibble LFI; data/block = max − 2 |

---

*Tiếp theo: [SID 0x34 – Part 2: Luồng Transfer đầy đủ (0x34 → 0x36 → 0x37), blockSequenceCounter, xử lý lỗi, AUTOSAR Fls/Mem stack](/uds/uds-sid-0x34-p2/)*
