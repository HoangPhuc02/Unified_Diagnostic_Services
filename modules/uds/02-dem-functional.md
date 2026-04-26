---
layout: default
category: uds
title: "DEM - Part 2 Functional Description"
nav_exclude: true
module: true
tags: [autosar, dem, diagnostics, event-manager, functional]
description: "DEM phần 2 – Functional Description, luồng hoạt động, dependencies và cấu hình."
permalink: /dem-functional/
---

# DEM - Functional Description

> Tài liệu này là phần tiếp theo của [DEM - Diagnostic Event Manager](/dem/), tập trung vào **Functional Description**, luồng hoạt động, dependencies và cấu hình chi tiết của DEM trong AUTOSAR Classic Platform.

## 5. Functional Description của DEM

Phần này mô tả chi tiết DEM hoạt động như thế nào theo từng nhóm chức năng chính.

### 5.1 Khởi tạo và phục hồi trạng thái

Khi ECU khởi động, DEM đi qua các bước logic sau:

1. Khởi tạo các cấu trúc dữ liệu RAM.
2. Nạp cấu hình event, DTC, memory classes, data classes, operation cycles.
3. Phục hồi dữ liệu persistent từ NvM nếu được cấu hình lưu non-volatile.
4. Đồng bộ lại trạng thái nội bộ của event memory và các bộ đếm.
5. Thiết lập trạng thái khởi đầu cho các bit chẩn đoán phụ thuộc operation cycle.

Nếu mô tả kỹ hơn theo startup behaviour thực tế, DEM thường đi qua các pha sau:

1. **Pre-init phase**
	Một số implementation có pha `Dem_PreInit` hoặc cơ chế tương đương để chưa vào full service nhưng vẫn không bỏ lỡ các lỗi BSW quá sớm.
2. **Full init phase**
	DEM bind toàn bộ cấu hình, tạo runtime structures và chuẩn bị memory/state machine.
3. **Restore phase**
	DEM đọc lại các entry từ NvM như primary memory, counters, freeze frame metadata hoặc các record cần giữ sau reset.
4. **Reconciliation phase**
	DEM phân biệt dữ liệu nào là lịch sử cần giữ, dữ liệu nào là cycle-local cần reset hoặc đánh dấu lại.
5. **Startup stabilization phase**
	DEM phối hợp với enable conditions, storage conditions và mode state để tránh đánh giá monitor quá sớm.
6. **Operational phase**
	DEM chuyển sang xử lý event theo logic bình thường, bao gồm debounce, DTC update và event memory management.

```mermaid
sequenceDiagram
	participant ECU as ECU Startup
	participant Dem as DEM
	participant Nvm as NvM
	participant Mon as Monitors / BSW

	ECU->>Dem: Power-on startup
	Dem->>Dem: PreInit and basic internal state
	Dem->>Dem: Load configuration and initialize RAM
	Dem->>Nvm: Restore persistent diagnostic records
	Nvm-->>Dem: Event memory and metadata
	Dem->>Dem: Reconcile restored state with current operation cycle
	Dem->>Dem: Apply startup enable and storage policies
	Mon->>Dem: Early event reports
	Dem->>Dem: Buffer, defer or process depending on init state
	Dem->>Dem: Enter normal diagnostic operation
```

Ý nghĩa chức năng:

1. DEM phải phân biệt dữ liệu chỉ có hiệu lực trong một operation cycle với dữ liệu cần giữ sau reset nguồn.
2. DEM phải đảm bảo không làm mất các DTC confirmed cần tồn tại lâu dài.
3. Nếu khôi phục từ NvM thất bại, DEM phải có chiến lược fallback theo cấu hình hoặc vendor implementation.
4. DEM phải có chiến lược rõ ràng cho event đến sớm trong giai đoạn startup, đặc biệt là BSW faults.
5. DEM phải tránh việc source chưa ổn định ở startup gây set DTC, capture freeze frame hoặc bật indicator không mong muốn.

Một số tình huống startup cần xử lý cẩn thận:

1. **Nguồn chưa ổn định**
	Lỗi undervoltage hoặc communication timeout có thể xuất hiện ngắn hạn nhưng chưa chắc là fault thật cần lưu.
2. **Sensor chưa valid**
	Nhiều sensor cần thời gian warm-up hoặc cần một mode vận hành nhất định mới có ý nghĩa chẩn đoán.
3. **Bus chưa fully alive**
	Timeout của network ở vài chu kỳ đầu không nên luôn bị đối xử như fault confirmed.
4. **NvM restore chưa xong**
	Nếu DEM nhận event mới khi dữ liệu cũ chưa reconcile xong, trạng thái fault có thể bị sai nếu implementation không khóa hoặc đệm hợp lý.

Vì vậy, startup behaviour tốt trong DEM không chỉ là “gọi init”, mà là một chiến lược kiểm soát việc **khi nào được phép tin vào monitor**, **khi nào được phép lưu fault** và **khi nào mới chuyển sang trạng thái diagnostic operation đầy đủ**.

### 5.2 Tiếp nhận báo cáo lỗi từ monitor

Đây là cửa vào chính của DEM.

Nguồn báo cáo có thể là:

1. SWC thông qua RTE client/server hoặc interface được cấu hình.
2. BSW module thông qua API DEM tương ứng.
3. Một số monitor vendor-specific có thể gửi thêm thông tin hỗ trợ.

Khi nhận một báo cáo event status, DEM thực hiện logic ở mức tổng quát như sau:

1. Kiểm tra EventId hợp lệ và event availability.
2. Kiểm tra enable conditions.
3. Kiểm tra DTC setting có đang bị disable hay không.
4. Áp dụng debounce nếu event dùng DEM-managed debounce.
5. Tính toán trạng thái event mới.
6. Cập nhật DTC status bits liên quan.
7. Quyết định có cần tạo/cập nhật event memory entry hay không.
8. Kích hoạt notification cho module phụ thuộc nếu cần.
9. Đánh dấu dirty state để chuẩn bị ghi NvM nếu có dữ liệu cần persist.

```mermaid
sequenceDiagram
	participant Mon as Monitor SWC/BSW
	participant Dem as DEM
	participant Fim as FiM
	participant Bswm as BswM
	participant Nvm as NvM

	Mon->>Dem: SetEventStatus or ReportErrorStatus
	Dem->>Dem: Validate EventId and enable conditions
	Dem->>Dem: Debounce and update event state
	alt Event becomes qualified failed
		Dem->>Dem: Update DTC status byte
		Dem->>Dem: Create or update event memory entry
		Dem->>Fim: Notify inhibition basis
		Dem->>Bswm: Notify diagnostic state
		Dem->>Nvm: Schedule persistent storage
	else Event not yet qualified
		Dem->>Dem: Keep intermediate debounce state
	end
```

### 5.3 Debouncing và qualification của event

Đây là phần quyết định một lỗi có được coi là thực sự xảy ra hay chỉ là nhiễu ngắn hạn.

Luồng điển hình với counter-based debounce:

1. Monitor gửi `PREFAILED` khi thấy dấu hiệu lỗi.
2. DEM tăng debounce counter.
3. Nếu counter chưa tới ngưỡng, event vẫn chưa thành failed chính thức.
4. Khi counter vượt threshold fail, DEM chuyển event sang failed.
5. Nếu monitor gửi `PREPASSED`, DEM giảm counter.
6. Khi xuống dưới threshold pass, event chuyển sang passed.

Giá trị kiến trúc của cơ chế này:

1. Giảm false DTC.
2. Giảm ghi flash không cần thiết.
3. Tránh indicator chớp tắt liên tục.
4. Cho phép tune độ nhạy chẩn đoán theo từng event class.

### 5.4 Cập nhật trạng thái event và DTC

Sau khi event được qualify, DEM cập nhật các lớp trạng thái sau:

1. **Event internal status**: passed, failed, prefailed, prepassed, disabled, unavailable.
2. **DTC status byte**: 8 bit chuẩn hóa cho tester.
3. **Occurrence-related counters**: số lần lỗi xuất hiện, lần gần nhất, số cycle liên quan.
4. **Confirmation state**: lỗi mới chỉ pending hay đã confirmed.

Ví dụ diễn biến chức năng khi event chuyển sang failed:

1. Set `testFailed`.
2. Set `testFailedThisOperationCycle`.
3. Set `pendingDTC` nếu thỏa logic pending.
4. Set `testFailedSinceLastClear`.
5. Xóa các cờ "not completed" tương ứng nếu monitor đã hoàn tất.
6. Nếu đủ tiêu chí xác nhận, set `confirmedDTC`.
7. Nếu event được ánh xạ indicator, set `warningIndicatorRequested` theo rule class.

Ví dụ diễn biến khi event chuyển lại passed:

1. Clear `testFailed`.
2. Không nhất thiết xóa ngay `pendingDTC` hoặc `confirmedDTC`.
3. `confirmedDTC` thường chỉ bị xóa bởi clear operation hoặc aging hoàn tất tùy rule.
4. Indicator có thể tắt ngay hoặc chỉ tắt sau logic healing riêng.

Đây là điểm quan trọng: **DEM quản lý vòng đời chẩn đoán chứ không chỉ phản chiếu trạng thái instant của monitor**.

### 5.5 Confirmation logic

Không phải mọi lỗi failed một lần là trở thành confirmed DTC ngay lập tức.

DEM có thể dùng các tiêu chí như:

1. Số lần fail trong các operation cycle liên tiếp.
2. Số lần detect tích lũy.
3. Quy tắc OBD-specific hoặc emission-related.

Khi tiêu chí xác nhận đạt được:

1. DTC được đánh dấu `confirmedDTC`.
2. Entry trong event memory có thể được nâng mức ưu tiên hoặc lưu bền vững hơn.
3. Dữ liệu freeze frame/extended data quan trọng có thể được chốt lưu.

### 5.6 Quản lý event memory

Event memory là trái tim persistence của DEM. Đây là nơi chứa các fault records có giá trị chẩn đoán lâu dài.

Các chức năng cốt lõi:

1. **Allocate entry** khi một event lần đầu đạt tiêu chí lưu.
2. **Update entry** khi event tái diễn hoặc thay đổi trạng thái quan trọng.
3. **Displace entry** nếu bộ nhớ đầy và cần chọn entry bị thay thế theo priority/displacement strategy.
4. **Delete/clear entry** khi tester yêu cầu clear hoặc khi aging hoàn tất và policy cho phép.

Khi bộ nhớ đầy, DEM thường phải quyết định:

1. Giữ lại lỗi có priority cao hơn.
2. Giữ lỗi confirmed thay vì pending.
3. Giữ lỗi mới nhất hoặc lỗi quan trọng hơn về an toàn/emission.

Đây là một trong những chỗ ảnh hưởng mạnh đến khả năng chẩn đoán sau bán hàng.

```mermaid
flowchart TB
	ENTRY[Event Memory Entry] --> H[Header<br/>EventId / DTC / Origin]
	ENTRY --> ST[Status<br/>UDS status byte / Confirm / Pending]
	ENTRY --> CNT[Counters<br/>Occurrence / Aging / FDC]
	ENTRY --> FF[Freeze Frame Records]
	ENTRY --> EX[Extended Data Records]
	ENTRY --> META[Priority / Displacement Metadata]
```

### 5.7 Snapshot, Freeze Frame và Extended Data capture

Khi một event chuyển trạng thái theo trigger rule cấu hình, DEM có thể chụp dữ liệu đi kèm.

Các trigger thường gặp:

1. Khi event lần đầu failed.
2. Khi event được confirmed.
3. Khi event memory entry được tạo.
4. Khi occurrence counter tăng.

DEM không nhất thiết tự biết cách lấy mọi dữ liệu. Thay vào đó:

1. Dữ liệu có thể được định nghĩa qua data element class.
2. Một số data element được lấy từ callback, port, sensor abstraction hoặc API tương ứng.
3. DEM chỉ điều phối thời điểm và record structure.

```mermaid
sequenceDiagram
	participant Mon as Monitor
	participant Dem as DEM
	participant App as SWC Data Provider
	participant Nvm as NvM

	Mon->>Dem: Event reaches FAILED or CONFIRMED trigger
	Dem->>Dem: Check snapshot and extended-data trigger rules
	loop For each configured DID or data element
		Dem->>App: Request current value
		App-->>Dem: Return payload
	end
	Dem->>Dem: Build freeze frame and extended records
	Dem->>Nvm: Store event memory entry
```

### 5.8 Cung cấp dữ liệu chẩn đoán cho DCM

Khi tester gửi yêu cầu chẩn đoán, DCM đóng vai trò protocol server. Tuy nhiên dữ liệu nền thường nằm trong DEM.

Các yêu cầu điển hình mà DCM cần DEM hỗ trợ:

1. Đọc danh sách DTC.
2. Đọc status byte của DTC.
3. Đọc snapshot/freeze frame.
4. Đọc extended data.
5. Đọc số lượng DTC thỏa điều kiện lọc.
6. Clear DTC theo group hoặc cụ thể.

Ví dụ với UDS:

1. `0x19 ReadDTCInformation` phụ thuộc mạnh vào dữ liệu từ DEM.
2. `0x14 ClearDiagnosticInformation` thường yêu cầu DCM phối hợp với DEM để xóa record tương ứng.
3. Tùy stack và cấu hình, một số hành vi liên quan `ControlDTCSetting` cũng ảnh hưởng tới DEM.

```mermaid
sequenceDiagram
	participant Tester
	participant Dcm as DCM
	participant Dem as DEM

	Tester->>Dcm: UDS 0x19 ReadDTCInformation
	Dcm->>Dem: Request filtered DTC information
	Dem->>Dem: Filter by status mask, origin, group, severity
	alt Snapshot or extended data requested
		Dcm->>Dem: Request freeze frame or extended records
		Dem-->>Dcm: Return record payload
	else Only DTC status requested
		Dem-->>Dcm: Return DTC list and status bytes
	end
	Dcm-->>Tester: Positive response with diagnostic data
```

### 5.9 Clear DTC và reset logic

Khi có yêu cầu clear DTC, DEM không chỉ xóa một mã lỗi hiển thị. DEM còn phải xử lý toàn bộ dấu vết liên quan.

Một thao tác clear điển hình có thể bao gồm:

1. Xóa event memory entry tương ứng.
2. Reset status bits phù hợp.
3. Reset counters, confirmation state, aging-related data.
4. Xóa freeze frame và extended data liên quan.
5. Đồng bộ thay đổi xuống NvM.

Một số nuance quan trọng:

1. Không phải mọi bit đều được xóa giống nhau trong mọi release/vendor.
2. Clear theo group DTC khác với clear một DTC cụ thể.
3. Có thể có các DTC không được phép clear trong một số mode bảo vệ hoặc manufacturing constraints.

```mermaid
sequenceDiagram
	participant Tester
	participant Dcm as DCM
	participant Dem as DEM
	participant Nvm as NvM

	Tester->>Dcm: UDS 0x14 ClearDiagnosticInformation
	Dcm->>Dem: Clear selected DTC or DTC group
	Dem->>Dem: Reset status bits and counters
	Dem->>Dem: Remove memory entries and related records
	Dem->>Nvm: Persist cleared state
	Nvm-->>Dem: Write result
	Dem-->>Dcm: Clear result
	Dcm-->>Tester: Positive or negative response
```

### 5.10 Aging và healing

Khi lỗi không còn tái xuất hiện trong các cycle tiếp theo, DEM có thể thực hiện **aging**.

Aging thường có ý nghĩa:

1. Lỗi từng confirmed nhưng nay không còn xuất hiện.
2. Sau đủ số cycle không tái phát, DTC có thể mất trạng thái confirmed hoặc bị xóa khỏi bộ nhớ theo policy.

Healing thường liên quan đến việc indicator hoặc trạng thái phục hồi được xử lý mềm hơn so với clear thô.

Sự khác nhau giữa các khái niệm:

1. **Passed**: monitor hiện tại không thấy lỗi.
2. **Healed**: lỗi đã qua logic phục hồi nào đó.
3. **Aged**: lỗi đã qua đủ số cycle sạch để được coi là lỗi cũ có thể loại bỏ/hạ cấp.
4. **Cleared**: bị xóa chủ động bởi tester hoặc hệ thống.

```mermaid
stateDiagram-v2
	[*] --> FailedStored
	FailedStored --> PassedButStored: next cycles are clean
	PassedButStored --> AgingCounterRunning: aging enabled and no refailure
	AgingCounterRunning --> FailedStored: fault reappears before threshold
	AgingCounterRunning --> AgedOut: aging threshold reached
	AgedOut --> [*]
```

### 5.11 Indicator management

Nếu event hoặc DTC được cấu hình liên kết với indicator, DEM có thể duy trì trạng thái yêu cầu bật đèn cảnh báo.

Logic indicator thường phụ thuộc:

1. Event class hoặc DTC class.
2. Confirmation state.
3. OBD/emission rules nếu áp dụng.
4. Healing rules để tắt indicator.

DEM thường chỉ duy trì **logic request**, còn phần hiện thực hiển thị vật lý có thể đi qua BswM, application layer, IoHwAb hoặc cơ chế vendor-specific.

### 5.12 Enable/disable chẩn đoán trong runtime

DEM hỗ trợ một số cơ chế kiểm soát việc chẩn đoán có đang nên hoạt động hay không, ví dụ:

1. Enable conditions theo mode hệ thống.
2. Storage conditions theo pha nguồn hoặc service mode.
3. DTC setting enable/disable trong những ngữ cảnh chẩn đoán đặc biệt.
4. Availability/suppression cho một số event/DTC.

Điều này rất quan trọng vì không phải thời điểm nào ECU cũng nên ghi lỗi. Ví dụ:

1. Trong giai đoạn khởi động nguồn chưa ổn định, lỗi nguồn có thể không nên lưu ngay.
2. Trong flashing/programming session, một số DTC có thể tạm thời không được cập nhật.

### 5.13 Tính bền vững dữ liệu với NvM

Một lỗi chẩn đoán có giá trị hậu kiểm thường phải tồn tại qua reset nguồn. Vì vậy DEM phối hợp với NvM để lưu:

1. Event memory records.
2. DTC status liên quan nếu policy yêu cầu.
3. Counters và metadata cho aging/confirmation.

Về chức năng hệ thống:

1. DEM đánh dấu dữ liệu changed/dirty khi có cập nhật quan trọng.
2. Việc ghi NvM có thể được trì hoãn, gom nhóm hoặc kích hoạt theo chiến lược tối ưu tuổi thọ flash.
3. DEM phải cân bằng giữa độ bền dữ liệu và chi phí ghi nhớ.

### 5.14 Notification và callback ra ngoài

Khi trạng thái event thay đổi, DEM có thể phát ra notification cho các module khác hoặc callback nội bộ cấu hình sẵn.

Mục đích của notification:

1. Cập nhật logic inhibit của FiM.
2. Kích hoạt BswM phản ứng với fault state.
3. Báo cho application hoặc service tool hook nếu có yêu cầu dự án.

### 5.15 Đồng bộ, exclusive area và main processing

Trong ECU thực tế, nhiều monitor và dịch vụ chẩn đoán có thể truy cập DEM từ các context khác nhau. Vì vậy DEM phải xử lý:

1. Đồng bộ truy cập dữ liệu dùng chung.
2. Bảo vệ section quan trọng bằng SchM/exclusive area.
3. Các xử lý deferred trong main function nếu kiến trúc yêu cầu.

Điều này tránh các lỗi như:

1. Đọc DTC khi record đang bị cập nhật.
2. Mất đồng nhất giữa RAM state và NvM request queue.
3. Race condition giữa clear DTC và monitor report.

## 6. Luồng hoạt động điển hình của DEM

### 6.1 Luồng khi một lỗi mới xuất hiện

1. Monitor phát hiện điều kiện bất thường.
2. Monitor gửi `PREFAILED` hoặc `FAILED` cho DEM.
3. DEM kiểm tra enable conditions và event availability.
4. DEM áp dụng debouncing.
5. Khi đủ điều kiện fail, DEM set các status bits liên quan.
6. DEM tạo hoặc cập nhật event memory entry.
7. DEM chụp freeze frame / extended data theo trigger.
8. DEM cập nhật indicator request nếu rule yêu cầu.
9. DEM phát notification cho FiM/BswM/DCM-facing logic.
10. DEM lập kế hoạch ghi dữ liệu xuống NvM.

### 6.2 Luồng khi lỗi biến mất

1. Monitor gửi `PREPASSED` hoặc `PASSED`.
2. DEM debounce theo hướng phục hồi.
3. Khi đủ điều kiện pass, `testFailed` được xóa.
4. Một số trạng thái lịch sử vẫn được giữ lại, ví dụ `confirmedDTC` có thể chưa mất.
5. Aging/healing logic bắt đầu đếm cycle sạch.
6. Indicator có thể tắt ngay hoặc sau tiêu chí healing.

### 6.3 Luồng khi tester đọc DTC

1. Tester gửi request qua bus chẩn đoán.
2. DCM giải mã service và sub-function.
3. DCM gọi DEM để lấy danh sách DTC và trạng thái tương ứng.
4. DEM lọc dữ liệu theo request mask/group/origin.
5. DEM trả dữ liệu về DCM.
6. DCM xây response frame gửi ra ngoài.

### 6.4 Luồng khi tester clear DTC

1. Tester gửi yêu cầu clear.
2. DCM xác thực service/session/security nếu cần.
3. DCM yêu cầu DEM xóa DTC hoặc một nhóm DTC.
4. DEM reset event memory và status data theo phạm vi yêu cầu.
5. DEM đồng bộ thay đổi với NvM.
6. Các module như FiM hoặc BswM nhận trạng thái mới gián tiếp qua cập nhật DEM.

## 7. Module Dependencies của DEM

Phần này mô tả chi tiết các dependency của DEM trong một hệ thống AUTOSAR Classic điển hình.

### 7.1 Phân loại dependency

Có thể chia dependency của DEM thành 3 nhóm:

1. **Direct functional dependencies**: module mà DEM bắt buộc hoặc gần như bắt buộc phải tương tác để hoàn thành vai trò cốt lõi.
2. **Optional/feature-driven dependencies**: chỉ cần khi bật các tính năng tương ứng.
3. **Indirect platform dependencies**: không phải giao diện nghiệp vụ trực tiếp, nhưng cần cho vận hành đúng và an toàn.

### 7.2 Ma trận dependency chi tiết

| Module | Mức độ phụ thuộc | Hướng tương tác | DEM dùng để làm gì | Ý nghĩa thực tế |
|---|---|---|---|---|
| RTE / SWC diagnostic ports | Rất cao | SWC -> DEM | Nhận báo cáo event từ application monitors | Nếu không có đầu vào này, DEM không có dữ liệu lỗi từ ứng dụng |
| BSW monitors | Rất cao | BSW -> DEM | Nhận lỗi từ các module nền tảng như communication, memory, network stack | Giúp gom lỗi hệ thống cơ sở hạ tầng vào cùng cơ chế chẩn đoán |
| DCM | Rất cao | DEM <-> DCM | Cung cấp DTC, status, snapshot, clear services cho tester | Đây là dependency cốt lõi để xuất dữ liệu chẩn đoán ra ngoài xe |
| FiM | Cao | DEM -> FiM hoặc FiM truy vấn DEM | Cung cấp trạng thái lỗi để inhibit chức năng | Cho phép hệ thống ngăn hành vi nguy hiểm hoặc không hợp lệ khi lỗi tồn tại |
| NvM | Cao | DEM <-> NvM | Lưu và phục hồi event memory, counters, metadata | Giúp DTC tồn tại qua reset nguồn |
| SchM / OS synchronization | Cao | Hạ tầng nền | Bảo vệ vùng dữ liệu dùng chung và đồng bộ xử lý | Cần để tránh race condition trong môi trường đa ngữ cảnh |
| DET | Trung bình | DEM -> DET | Báo lỗi phát triển nếu API dùng sai hoặc cấu hình sai | Hữu ích ở giai đoạn phát triển và integration |
| BswM | Trung bình đến cao | DEM -> BswM | Báo trạng thái fault/indicator/mode-related info | Dùng khi dự án muốn system mode phản ứng theo trạng thái chẩn đoán |
| MemIf / Fee / Ea | Gián tiếp nhưng quan trọng | DEM -> NvM -> Mem stack | Hạ tầng lưu trữ vật lý của dữ liệu persistent | DEM không dùng trực tiếp trong mọi thiết kế, nhưng thực tế phụ thuộc chuỗi này để lưu bền vững |
| EcuM / power lifecycle | Gián tiếp | Hệ thống -> DEM | Ảnh hưởng thời điểm init/shutdown/operation cycle | Cần để DEM biết khi nào bắt đầu hoặc kết thúc các chu kỳ liên quan |
| Indicator handling layer | Tùy cấu hình | DEM -> tầng điều phối khác | Hiện thực hóa yêu cầu bật/tắt đèn cảnh báo | DEM giữ logic request, module khác có thể lái phần cứng |
| OBD-specific integration | Tùy tính năng | DEM <-> DCM / cycle managers | Thực hiện pending/confirmed/healing theo OBD | Chỉ cần với ECU có yêu cầu OBD/WWH-OBD |

### 7.3 Dependency với SWC và RTE

Đây là dependency ở đầu vào nghiệp vụ của DEM.

SWC monitor thường:

1. Kiểm tra điều kiện cảm biến, actuator, plausibility.
2. Đánh giá passed/failed.
3. Gọi API hoặc service tương ứng để báo event cho DEM.

DEM phụ thuộc vào chất lượng monitor ở các khía cạnh sau:

1. Nếu monitor quá nhạy, DEM sẽ nhận quá nhiều false fault.
2. Nếu monitor debounce nội bộ không nhất quán với cấu hình DEM, trạng thái fault có thể khó phân tích.
3. Nếu mapping event không hợp lý, DTC hiển thị cho tester sẽ thiếu ý nghĩa.

### 7.4 Dependency với DCM

Đây là dependency quan trọng nhất ở đầu ra chẩn đoán chuẩn hóa.

DCM phụ thuộc vào DEM để:

1. Lấy danh sách DTC hiện hành.
2. Lấy status byte theo mask.
3. Lấy snapshot record và extended data record.
4. Xóa DTC theo lệnh tester.

DEM phụ thuộc vào DCM ở chỗ:

1. DCM là gateway giao thức để tester tương tác với dữ liệu của DEM.
2. Nếu không có DCM, DEM vẫn có thể quản lý lỗi nội bộ nhưng không cung cấp dịch vụ UDS chuẩn ra bên ngoài.

### 7.5 Dependency với FiM

FiM (Function Inhibition Manager) dùng thông tin chẩn đoán để quyết định có cho phép một chức năng chạy hay không.

Ví dụ:

1. Nếu cảm biến tốc độ bánh xe lỗi, chức năng cruise control có thể bị inhibit.
2. Nếu điện áp nguồn không ổn định, một số test hoặc actuator action có thể bị khóa.

Trong quan hệ này:

1. DEM là nguồn sự thật về trạng thái lỗi.
2. FiM là nơi diễn giải trạng thái lỗi thành quyết định cho phép/không cho phép chức năng.

### 7.6 Dependency với NvM

NvM cung cấp persistence, còn DEM cung cấp nội dung cần lưu.

DEM cần NvM vì:

1. DTC hậu kiểm phải sống qua key-off/key-on.
2. Freeze frame có giá trị khi xe đã rời khỏi điều kiện lỗi ban đầu.
3. Aging/confirmation cần lịch sử chứ không chỉ trạng thái RAM tức thời.

Nếu không có NvM hoặc cấu hình persistence bị giới hạn:

1. Một số lỗi chỉ tồn tại trong runtime.
2. Khả năng chẩn đoán sau reset giảm mạnh.
3. Dữ liệu service workshop có thể không đầy đủ.

### 7.7 Dependency với BswM

BswM có thể dùng thông tin từ DEM để đổi mode hệ thống. Ví dụ:

1. Chuyển sang degraded mode khi có fault nghiêm trọng.
2. Tạm ngưng một số communication service.
3. Điều phối logic warning state ở cấp hệ thống.

Dependency này không phải lúc nào cũng bắt buộc, nhưng rất phổ biến ở các hệ thống có mode management phức tạp.

### 7.8 Dependency với DET

DET không tham gia nghiệp vụ chẩn đoán xe, nhưng rất hữu ích trong integration/development.

DEM có thể dùng DET để báo:

1. API gọi sai context.
2. EventId không hợp lệ.
3. Truy cập trước khi init.
4. Tham số không hợp lệ.

Điều này giúp phát hiện lỗi tích hợp sớm trước khi bước vào xác nhận chức năng chẩn đoán thực tế.

### 7.9 Dependency với SchM và OS

DEM thường chạy trong môi trường có nhiều context:

1. Task cyclic.
2. Callback từ communication stack.
3. DCM diagnostic service context.
4. Shutdown/storage phases.

Vì vậy DEM phụ thuộc mạnh vào cơ chế synchronization để:

1. Bảo vệ event memory.
2. Đồng bộ queue ghi NvM.
3. Ngăn xung đột giữa clear DTC và update event.

### 7.10 Dependency gián tiếp với memory stack

DEM thường không ghi flash trực tiếp. Chuỗi phụ thuộc thường là:

`DEM -> NvM -> MemIf -> Fee/Ea -> Flash/EEPROM driver`

Tác động của chuỗi này:

1. Tốc độ persistence phụ thuộc scheduling của NvM.
2. Mất dữ liệu có thể xảy ra nếu nguồn tắt trước khi commit hoàn tất.
3. Chính sách wear leveling ở Fee/Ea ảnh hưởng tuổi thọ lưu trữ dữ liệu chẩn đoán.

### 7.11 Dependency với operation cycle management

DEM cần biết ranh giới cycle để cập nhật chính xác các bit như:

1. `testFailedThisOperationCycle`
2. `testNotCompletedThisOperationCycle`
3. Các điều kiện pending/aging/confirm theo cycle

Nguồn cycle này có thể đến từ logic hệ thống hoặc service interface được cấu hình. Đây là dependency rất quan trọng nhưng thường bị đánh giá thấp khi tích hợp DEM.

## 8. Sơ đồ phụ thuộc chức năng

```mermaid
flowchart LR
	subgraph Producers[Fault Producers]
		SWC[SWC Monitors]
		BSW[BSW Monitors]
	end

	subgraph Core[Diagnostic Core]
		DEM[DEM]
	end

	subgraph Consumers[Consumers of DEM Data]
		DCM[DCM<br/>UDS 0x19 / 0x14]
		FIM[FiM]
		BSWM[BswM]
	end

	subgraph Persistence[Persistence Chain]
		NVM[NvM]
		MEMIF[MemIf]
		FEE[Fee / Ea]
		FLS[Flash / EEPROM]
	end

	subgraph Platform[Platform Support]
		ECUM[EcuM / Operation Cycle]
		OS[OS / SchM]
		DET[DET]
	end

	SWC -->|SetEventStatus| DEM
	BSW -->|ReportErrorStatus| DEM
	DEM <--> DCM
	DEM --> FIM
	DEM --> BSWM
	DEM <--> NVM
	NVM --> MEMIF --> FEE --> FLS
	ECUM --> DEM
	OS --> DEM
	DEM --> DET
```

Diễn giải sơ đồ:

1. **Monitor side** là nguồn phát sinh sự kiện.
2. **Consumer side** gồm DCM, FiM, BswM là nơi tiêu thụ thông tin chẩn đoán.
3. **Persistence side** là NvM và memory stack.
4. **Platform side** gồm SchM/OS/EcuM cung cấp nền vận hành và cycle semantics.

## 9. Các điểm cấu hình quan trọng ảnh hưởng trực tiếp đến hành vi DEM

| Nhóm cấu hình | Ảnh hưởng chức năng |
|---|---|
| Event configuration | Quyết định event nào tồn tại, thuộc class nào, có DTC hay không |
| DTC mapping | Quyết định tester thấy mã lỗi nào và cách gom nhóm lỗi |
| Debounce class | Quyết định độ nhạy phát hiện lỗi |
| Event memory class | Quyết định lỗi lưu ở memory nào, ưu tiên ra sao |
| Freeze frame class | Quyết định dữ liệu nào được chụp khi lỗi xảy ra |
| Extended data class | Quyết định dữ liệu hậu kiểm được lưu thêm |
| Indicator attributes | Quyết định khi nào yêu cầu bật/tắt warning lamp |
| Operation/aging cycle | Quyết định pending, confirm, aging và healing |
| NvM linkage | Quyết định dữ liệu nào sống qua reset |
| Enable/storage conditions | Quyết định lúc nào được đánh giá và lúc nào được lưu |

Một sai lệch nhỏ trong cấu hình có thể dẫn đến khác biệt lớn trong hành vi chẩn đoán. Ví dụ:

1. Ngưỡng debounce quá thấp làm DTC xuất hiện liên tục.
2. Không cấu hình NvM đúng làm mất DTC sau reset.
3. Mapping event-DTC không rõ ràng làm workshop khó chẩn đoán.
4. Operation cycle sai làm pending/confirmed không đúng chuẩn mong muốn.

## 10. DEM làm gì và không làm gì

### 10.1 DEM làm gì

1. Quản lý lifecycle của event và DTC.
2. Lưu trữ dữ liệu chẩn đoán.
3. Cung cấp dữ liệu cho tester qua DCM.
4. Hỗ trợ inhibition và mode reaction thông qua module khác.
5. Quản lý trạng thái warning indicator ở mức logic.

### 10.2 DEM không làm gì

1. Không tự đo cảm biến hoặc tự phát hiện lỗi vật lý.
2. Không tự truyền frame UDS ra bus, việc đó là của DCM và communication stack.
3. Không trực tiếp điều khiển hardware lamp trong mọi kiến trúc.
4. Không thay monitor quyết định bản chất vật lý của fault.
5. Không thay thế cho chính sách safety ở application level, dù nó là nguồn thông tin đầu vào quan trọng cho safety reactions.

## 11. Góc nhìn tích hợp hệ thống

Khi tích hợp DEM vào ECU thực tế, có một số nguyên tắc quan trọng:

1. **Thiết kế monitor tốt trước rồi mới tune DEM**. DEM không thể sửa một monitor kém chất lượng.
2. **Tách rõ event semantics và DTC semantics**. Event là nguồn kỹ thuật; DTC là ngôn ngữ chẩn đoán cho tester.
3. **Định nghĩa operation cycle chính xác**. Rất nhiều lỗi hành vi chẩn đoán xuất phát từ cycle model sai.
4. **Quy hoạch event memory theo priority**. Nếu mọi lỗi đều có cùng mức ưu tiên, bộ nhớ sẽ nhanh chóng kém giá trị.
5. **Kiểm soát tần suất ghi NvM**. Nếu không, hệ thống dễ đánh đổi tuổi thọ flash lấy dữ liệu chẩn đoán không thật sự cần thiết.
6. **Rà soát quan hệ với FiM/BswM ngay từ sớm**. Trạng thái fault không chỉ để hiển thị, mà còn có thể làm thay đổi hành vi ECU.

## 12. Kết luận

DEM là module trung tâm biến các kết quả chẩn đoán rời rạc từ monitor thành một **hệ thống quản trị lỗi chuẩn hóa, có trạng thái, có lịch sử và có khả năng giao tiếp với tester**. Giá trị lớn nhất của DEM không nằm ở việc "nhận lỗi" mà nằm ở việc:

1. Chuẩn hóa lỗi thành event và DTC có ý nghĩa hệ thống.
2. Quản lý vòng đời của lỗi qua debounce, confirmation, aging và clear.
3. Lưu lại bằng chứng chẩn đoán dưới dạng event memory, freeze frame và extended data.
4. Cấp dữ liệu cho DCM, FiM, BswM và các cơ chế điều phối khác.
5. Tạo nên cầu nối giữa monitor runtime bên trong ECU và hoạt động service diagnostics bên ngoài xe.

Nếu DCM là cánh cửa giao tiếp với tester, thì **DEM chính là kho logic và trạng thái chẩn đoán phía sau cánh cửa đó**.

## 13. Ghi chú cập nhật và nguồn tham khảo công khai

Phiên bản cập nhật này ưu tiên dùng **Mermaid tự vẽ** thay cho ảnh chụp từ web để tránh phụ thuộc vào bản quyền hình ảnh, liên kết chết và khác biệt giữa các vendor stack. Các sơ đồ được chỉnh lại dựa trên cách diễn giải chung xuất hiện nhất quán trong các nguồn công khai sau:

1. EmbeddedTutor: `AUTOSAR DEM Module`.
2. DeepWiki `openAUTOSAR/classic-platform`: `Diagnostic Services` và `Diagnostic Event Manager (DEM)`.
3. Các bài viết public về `UDS service overview` và `DCM module` dùng để đối chiếu luồng `ReadDTCInformation`, `ClearDiagnosticInformation` và quan hệ DCM <-> DEM.
4. AUTOSAR Classic Platform public architecture overview dùng để giữ đúng vị trí DEM trong Service Layer, quan hệ với NvM, FiM và communication path.

Do mỗi vendor AUTOSAR stack có thể triển khai khác nhau ở mức chi tiết API, chính sách event memory và naming convention, các sơ đồ trong tài liệu này nên được hiểu là **mô hình chức năng chuẩn hóa ở mức kiến trúc**, không phải ảnh chụp hay dump cấu hình của một implementation cụ thể.