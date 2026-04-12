---
layout: default
title: DEM - Diagnostic Event Manager Visual
nav_title: DEM Visual
nav_order: 2
nav_exclude: true
module: true
tags: [autosar, dem, diagnostics, event-manager]
description: Tài liệu kỹ thuật về DEM – quản lý vòng đời lỗi, DTC, freeze frame và indicator trong AUTOSAR Classic.
permalink: /dem/
source_file: modules/01-dem/content.md
---
{% capture dem_visual_source %}{% include_relative content.md %}{% endcapture %}
{{ dem_visual_source | markdownify }}