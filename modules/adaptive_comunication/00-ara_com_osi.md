OSI and Adaptive communcation

# Overview

```plaintext
+---+---------------------------+---------------------------------------------------+
| L | MÔ HÌNH OSI (7 LỚP)       | THÀNH PHẦN ADAPTIVE AUTOSAR & GIAO THỨC TƯƠNG ỨNG |
+---+---------------------------+---------------------------------------------------+
| 7 | Ứng dụng (Application)    | ara::com, Adaptive Applications, DoIP             |
+---+---------------------------+---------------------------------------------------+
| 6 | Trình diễn (Presentation) | SOME/IP (Khối Serialization / Deserialization)    |
+---+---------------------------+---------------------------------------------------+
| 5 | Phiên (Session)           | SOME/IP-SD (Service Discovery)                    |
+---+---------------------------+---------------------------------------------------+
| 4 | Giao vận (Transport)      | TCP, UDP (Thông qua ngăn xếp mạng POSIX OS)       |
+---+---------------------------+---------------------------------------------------+
| 3 | Mạng (Network)            | IPv4, IPv6, ICMP, ARP (Ngăn xếp mạng POSIX OS)    |
+---+---------------------------+---------------------------------------------------+
| 2 | Liên kết dữ liệu (Data L.)| Ethernet MAC, VLAN, Các chuẩn TSN (IEEE 802.1AS)  |
+---+---------------------------+---------------------------------------------------+
| 1 | Vật lý (Physical)         | Automotive Ethernet (100BASE-T1, 1000BASE-T1...)  |
+---+---------------------------+---------------------------------------------------+

[Lớp 5 - 6 - 7]: Thuộc tầm kiểm soát trực tiếp của bộ middleware Adaptive AUTOSAR.

[Lớp 3 - 4]: AUTOSAR sẽ gọi xuống các socket API tiêu chuẩn của hệ điều hành POSIX (như Linux/QNX) để xử lý.

[Lớp 1 - 2]: Được thực thi bởi các phần cứng vật lý (Transceiver, Switch) và trình điều khiển (Driver) mạng bên dưới.

# Physical Layer
