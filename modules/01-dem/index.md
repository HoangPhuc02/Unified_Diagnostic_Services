---
layout: default
title: DEM - Diagnostic Event Manager
nav_title: DEM
nav_order: 2
description: Ban render GitHub Pages cho tai lieu DEM trong cau truc modules/01-dem, ho tro Mermaid va mo rong de dang.
permalink: /dem/
source_file: modules/01-dem/content.md
---
{% capture dem_source %}{% include_relative content.md %}{% endcapture %}
{{ dem_source | markdownify }}