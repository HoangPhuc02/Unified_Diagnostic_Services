---
layout: default
title: DCM - Diagnostic Communication Manager
nav_title: DCM
nav_order: 3
nav_exclude: true
module: true
tags: [autosar, dcm, diagnostics, uds, communication]
description: Tài liệu kỹ thuật về DCM – điều phối giao tiếp chẩn đoán UDS/KWP/OBD giữa tester và ECU.
permalink: /dcm/
source_file: modules/02-dcm/content.md
---
{% capture dcm_source %}{% include_relative content.md %}{% endcapture %}
{{ dcm_source | markdownify }}