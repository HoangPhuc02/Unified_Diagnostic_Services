---
layout: default
category: uds_sid
title: "UDS - Service ID 0x37 RequestTransferExit (Part 1)"
nav_exclude: true
module: true
tags: [autosar, uds, diagnostics, iso-14229, protocol, download, upload, transfer, exit, verification]
description: "SID 0x37 RequestTransferExit – tổng quan, request/response format, transferRequestParameterRecord, transferResponseParameterRecord, NRC đầy đủ, special cases và ví dụ theo ISO 14229-1:2020."
permalink: /uds/uds-sid-0x37-p1/
---

# UDS - SID 0x37: RequestTransferExit (Part 1)

> **Tài liệu chuẩn:** ISO 14229-1:2020, Clause 14.4 — Upload/Download functional unit.  
> **Phạm vi:** SID `0x37` kết thúc một phiên transfer (download hoặc upload) đã khởi tạo bởi SID `0x34`/`0x35`. Không có sub-function byte. Part 2 trình bày các mẫu verification OEM (CRC, checksum, signature), xử lý `0x78` pending, luồng multi-segment, và AUTOSAR Dcm callback.

---

## 1. Tổng quan SID 0x37

### 1.1 Vai trò trong Upload/Download Unit

SID `0x37` là **bước kết thúc bắt buộc** của mọi transfer. Client gửi `0x37` sau khi đã truyền **đủ** `memorySize` byte qua SID `0x36`. Server thực hiện:

1. Kiểm tra tổng byte đã nhận/gửi có bằng `memorySize` không.
2. Thực hiện **final verification** nếu OEM định nghĩa (CRC, checksum, hash).
3. Giải phóng transfer state (reset `blockSequenceCounter`, xóa context).
4. Trả về kết quả verify nếu có.

Nếu `0x37` không được gọi sau `0x36`, transfer state còn tồn tại trên server → gọi `0x34`/`0x35` mới sẽ trả về NRC `0x22` (conditionsNotCorrect).

```
[0x34 / 0x35]  →  [0x36 × N]  →  [0x37]
     ▲                                │
     │                                ▼
     │                    Transfer state CLEARED
     │                    blockSeqCtr RESET
     └──────────── Có thể gọi 0x34/0x35 mới ──────────
```

### 1.2 Các thông số định danh service

| Thuộc tính | Giá trị |
|---|---|
| Service ID (SID) | `0x37` |
| Response SID (RSID) | `0x77` |
| Negative Response SID | `0x7F` |
| Sub-function | **Không có** |
| suppressPosRspMsgIndicationBit | **Không áp dụng** |
| Default Session (0x01) | **Không hỗ trợ** |
| Programming Session (0x02) | **Hỗ trợ** |
| Extended Session (0x03) | Tùy OEM |

### 1.3 NRC tổng quan

| NRC | Tên | Điều kiện kích hoạt |
|---|---|---|
| `0x13` | incorrectMessageLengthOrInvalidFormat | Length request không khớp với định nghĩa OEM của `transferRequestParameterRecord` |
| `0x22` | conditionsNotCorrect | Không có transfer đang active (chưa gọi `0x34`/`0x35`, hoặc đã gọi `0x37` rồi) |
| `0x31` | requestOutOfRange | `transferRequestParameterRecord` chứa giá trị không hợp lệ hoặc unsupported verification method (OEM-specific) |
| `0x72` | generalProgrammingFailure | Final verification thất bại: CRC mismatch, checksum sai, write integrity check fail, tổng byte nhận ≠ `memorySize` |

> **Không có NRC `0x12`** — `0x37` không có sub-function.  
> **Không có NRC `0x33`** — Security Access không được kiểm tra lại tại bước exit (đã được kiểm tra ở `0x34`/`0x35`).

---

## 2. Cấu trúc Request

### 2.1 Format Request — RequestTransferExit (0x37)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x37` | RequestTransferExit |
| 2 đến N | transferRequestParameterRecord | OEM-defined (0–n byte) | Dữ liệu verification tùy chọn; không có = request chỉ 1 byte |

**Độ dài request:**
- **Không có OEM extension**: `1 byte` (chỉ `0x37`).
- **Có OEM extension**: `1 + k` byte, trong đó k là độ dài `transferRequestParameterRecord` do OEM quy định.

### 2.2 transferRequestParameterRecord

Field này **không được định nghĩa bởi ISO 14229-1** — hoàn toàn do OEM/ECU manufacturer quyết định nội dung. ISO chỉ định nghĩa sự tồn tại của field và vị trí byte.

**Các mẫu OEM thường gặp:**

| Mẫu | Độ dài | Nội dung | Mục đích |
|---|---|---|---|
| **Không có** | 0 byte | — | ECU không cần verification từ client |
| **CRC-16** | 2 byte (big-endian) | CRC-16/CCITT của toàn bộ dữ liệu đã download | Server verify toàn vẹn dữ liệu |
| **CRC-32** | 4 byte (big-endian) | CRC-32 của toàn bộ dữ liệu đã download | Bảo vệ mạnh hơn CRC-16 |
| **CRC-32 + Length** | 6 byte | `[CRC-32 4B][memorySize 2B]` | Verify cả nội dung và kích thước |
| **Digital Signature** | Variable | HMAC-SHA256 hoặc ECDSA signature | Xác thực nguồn gốc firmware |
| **Reserved / 0x00** | 1 byte | `0x00` | Placeholder – một số OEM yêu cầu đúng 1 byte |

> **⚠️ Cạm bẫy:** Nếu OEM định nghĩa `transferRequestParameterRecord` cố định (ví dụ: luôn 4 byte CRC-32), client gửi request chỉ 1 byte sẽ nhận NRC `0x13`. Luôn kiểm tra ECU specification trước.

---

## 3. Cấu trúc Positive Response

### 3.1 Format Positive Response — RequestTransferExit (0x77)

| Byte | Field | Giá trị | Mô tả |
|---|---|---|---|
| 1 | serviceId | `0x77` | RSID của RequestTransferExit |
| 2 đến N | transferResponseParameterRecord | OEM-defined (0–n byte) | Kết quả verification tùy chọn; không có = response chỉ 1 byte |

**Độ dài response:**
- **Không có OEM extension**: `1 byte` (chỉ `0x77`).
- **Có OEM extension**: `1 + m` byte, trong đó m là độ dài `transferResponseParameterRecord` do OEM quy định.

### 3.2 transferResponseParameterRecord

Tương tự request, field này hoàn toàn OEM-defined. ISO 14229-1:2020 chỉ quy định tên và vị trí.

**Các mẫu OEM thường gặp:**

| Mẫu | Độ dài | Nội dung | Ý nghĩa |
|---|---|---|---|
| **Không có** | 0 byte | — | Server không trả thêm thông tin (phổ biến nhất) |
| **Verification Result** | 1 byte | `0x00` = pass; `0x01` = fail | Kết quả verify CRC/hash |
| **Applied Address** | 4–8 byte | `[startAddr 4B][endAddr 4B]` | Server báo vùng nhớ đã được ghi |
| **Routine Result** | Variable | Kết quả check programming integrity | Thường gặp trong OTA |

> **💡 Điểm mấu chốt:** Hầu hết ECU production không có `transferResponseParameterRecord` (response chỉ là `0x77`). ECU trả NRC `0x72` nếu verify thất bại — không trả `0x77` với result code. Mẫu có response data phổ biến hơn trong aftermarket flasher tools.

---

## 4. Điều kiện Positive/Negative Response

### 4.1 Điều kiện Positive Response

1. Đang có transfer active: đã gọi `0x34`/`0x35` và chưa gọi `0x37` trước đó.
2. Session hợp lệ: Programming Session (`0x02`) hoặc session được OEM cấu hình.
3. `transferRequestParameterRecord` hợp lệ (nếu OEM định nghĩa).
4. Tổng byte đã nhận qua `0x36` = `memorySize` (hoặc server chấp nhận partial transfer — tùy OEM).
5. Final verification thành công (CRC match, checksum valid,…) nếu client gửi verification data.
6. Request length khớp với định nghĩa OEM.

### 4.2 Điều kiện Negative Response chi tiết

| Điều kiện | NRC | Ghi chú |
|---|---|---|
| Không có transfer đang active | `0x22` | Chưa gọi `0x34`/`0x35`, hoặc đã kết thúc bằng `0x37` rồi |
| Sai session (ví dụ Default Session) | `0x22` | ECU từ chối `0x37` ngoài Programming Session |
| Length request ≠ định nghĩa OEM | `0x13` | OEM yêu cầu 5 byte nhưng client gửi 1 byte |
| `transferRequestParameterRecord` ngoài range | `0x31` | Ví dụ: verification type byte = `0xFF` (reserved) |
| CRC/checksum trong `transferRequestParameterRecord` không khớp | `0x72` | Dữ liệu bị lỗi trong quá trình transfer |
| Tổng byte nhận < `memorySize` | `0x72` | Transfer chưa hoàn chỉnh |
| Flash write integrity check thất bại (read-back verify) | `0x72` | ECU tự verify flash sau khi nhận đủ data |
| Session timeout trước khi nhận `0x37` | ECU thoát session | Transfer state bị hủy; `0x37` trả NRC `0x22` |

---

## 5. Trường hợp đặc biệt

1. **Request chỉ 1 byte (`0x37`)**: Hoàn toàn hợp lệ khi ECU không có OEM extension. Phổ biến nhất trong thực tế.

2. **Transfer chưa hoàn chỉnh khi gọi 0x37**: Nếu tổng byte truyền qua `0x36` chưa đạt `memorySize` → tùy ECU:
   - Một số ECU: NRC `0x72` (generalProgrammingFailure).
   - Một số ECU khác: NRC `0x13` (coi là thiếu dữ liệu, sai format).
   - Một số ECU linh hoạt: Positive response nếu partial flash được chấp nhận (hiếm gặp).

3. **Server dùng `0x78` pending trong 0x37**: Nếu final verification cần nhiều thời gian (tính CRC toàn bộ flash, erase unused sectors,…), server có thể gửi `7F 37 78` một hoặc nhiều lần trước khi trả `0x77`. Client phải giữ session alive.

4. **Gọi 0x37 khi chưa gửi block nào (0x34 xong nhưng 0x36 chưa gọi)**: Transfer state đang active nhưng `bytesWritten = 0` < `memorySize` → NRC `0x72` hoặc `0x22` tùy ECU.

5. **Gọi 0x37 hai lần liên tiếp**: Lần đầu xóa transfer state → lần hai không có transfer active → NRC `0x22`.

6. **ECU reset trong transfer**: Sau power cycle, transfer state bị xóa. Client không cần gọi `0x37` — cần gọi lại `0x10 → 0x27 → 0x34` từ đầu.

7. **Functional addressing (0x7DF)**: Tương tự `0x34`/`0x35`/`0x36`, SID `0x37` phải dùng **physical addressing** (unicast).

8. **transferRequestParameterRecord trong Upload**: Trong upload (sau `0x35`), `0x37` vẫn có thể chứa `transferRequestParameterRecord` nếu OEM định nghĩa (ví dụ: client gửi checksum của data đã nhận để server cross-check). Thường là 0 byte.

---

## 6. Ví dụ

### 6.1 Request không có OEM extension (phổ biến nhất)

```
REQUEST:
  37
  ^^  SID: 0x37 (RequestTransferExit)
      (transferRequestParameterRecord: không có — 0 byte)

POSITIVE RESPONSE:
  77
  ^^  RSID: 0x77
      (transferResponseParameterRecord: không có — 0 byte)
```

### 6.2 OEM extension: Client gửi CRC-32

**Scenario**: Sau download 128 KB firmware, client gửi CRC-32 của toàn bộ dữ liệu để server verify.

```
REQUEST:
  37  A3 F2 01 5C
  ^^  ─────────── 
  SID transferRequestParameterRecord: CRC-32 = 0xA3F2015C (big-endian)

POSITIVE RESPONSE (nếu CRC khớp):
  77
  ^^  RSID: 0x77
      (transferResponseParameterRecord: rỗng)

NEGATIVE RESPONSE (nếu CRC không khớp):
  7F  37  72
  ^^  ^^  ^^
  NRS SID NRC: 0x72 (generalProgrammingFailure — CRC mismatch)
```

### 6.3 Negative Response — Không có transfer active

```
Client gọi 0x37 khi chưa gọi 0x34:

  REQUEST:  37
  RESPONSE: 7F 37 22
            ^^    ^^
            NRS   NRC: 0x22 (conditionsNotCorrect)
```

### 6.4 Negative Response — Transfer chưa hoàn chỉnh

```
Scenario: 0x34 khai báo memorySize = 0x00020000 (128 KB)
          Client chỉ gửi 64 KB qua 0x36 rồi gọi 0x37

  REQUEST:  37
  RESPONSE: 7F 37 72
                 ^^   NRC: 0x72 (generalProgrammingFailure)
                      Lý do: bytesWritten (64KB) < memorySize (128KB)
```

### 6.5 Server dùng 0x78 pending (final verification lâu)

```
CLIENT → 37

SERVER → 7F 37 78   ← requestCorrectlyReceivedResponsePending
         ^^    ^^     "Đang tính CRC toàn bộ flash, đợi..."

SERVER → 7F 37 78   ← Vẫn đang tính...

SERVER → 77         ← Xong! Verification pass.
```

### 6.6 OEM: transferResponseParameterRecord mang verification result

```
REQUEST:  37  (không có verification data từ client)

POSITIVE RESPONSE:
  77  00
  ^^  ^^
  RSID transferResponseParameterRecord: 0x00 = Verification PASS
  (OEM định nghĩa: 0x00=pass, 0x01=fail)
```

---

## 7. Bảng tóm tắt

| Tham số | Vị trí | Độ dài | Quy tắc đặc biệt |
|---|---|---|---|
| `serviceId` | Byte 1 request | 1 byte | Luôn `0x37` |
| `transferRequestParameterRecord` | Bytes 2–N request | 0–n byte (OEM) | Thường 0 byte; ISO không định nghĩa nội dung |
| `serviceId` (RSID) | Byte 1 response | 1 byte | Luôn `0x77` |
| `transferResponseParameterRecord` | Bytes 2–N response | 0–m byte (OEM) | Thường 0 byte; ISO không định nghĩa nội dung |

---

*Tiếp theo: [SID 0x37 – Part 2: Verification patterns (CRC, checksum, signature), multi-segment transfer, AUTOSAR Dcm_ProcessRequestTransferExit callback](/uds/uds-sid-0x37-p2/)*
