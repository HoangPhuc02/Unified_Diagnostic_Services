---
layout: default
title: DCM - Diagnostic Communication Manager
nav_title: DCM
nav_order: 4
description: Ban render GitHub Pages cho tai lieu DCM trong cau truc modules/03-dcm, ho tro Mermaid va dieu huong site.
permalink: /dcm/
source_file: modules/03-dcm/content.md
---
{% capture dcm_source %}{% include_relative content.md %}{% endcapture %}
{{ dcm_source | markdownify }}