---
layout: default
title: Unified Diagnostic Services
nav_title: Home
nav_order: 1
description: Trang tong hop tai lieu AUTOSAR UDS va lien ket den cac file markdown duoc render tren GitHub Pages.
---

# Unified Diagnostic Services

Trang nay duoc dung lam homepage cho GitHub Pages. Cac file markdown nguon trong repo duoc giu nguyen, con cac trang ben duoi la wrapper page de Jekyll render noi dung va cho phep Mermaid chay tren GitHub Pages.

## Tai lieu hien co

<div class="doc-grid">
  {% assign nav_pages = site.pages | sort: "nav_order" %}
  {% for node in nav_pages %}
    {% if node.title and node.url != page.url and node.nav_exclude != true %}
      <a class="doc-card" href="{{ node.url | relative_url }}">
        <div class="doc-card__title">{{ node.title }}</div>
        {% if node.source_file %}
          <div class="doc-card__meta">File nguon: {{ node.source_file }}</div>
        {% endif %}
        {% if node.description %}
          <div class="doc-card__desc">{{ node.description }}</div>
        {% endif %}
      </a>
    {% endif %}
  {% endfor %}
</div>

## Cach hoat dong tren GitHub Pages

1. Layout chung trong `_layouts/default.html` se render toan bo noi dung va nap Mermaid tu CDN.
2. Cac trang `dem`, `dem-visual`, `dcm` la wrapper page, lay noi dung tu file markdown nguon bang `include_relative` roi chuyen thanh HTML qua `markdownify`.
3. Script Mermaid se tim cac fenced block co ngon ngu `mermaid` va doi thanh so do thuc te trong browser.
4. `index.md` dong vai tro homepage de liet ke cac tai lieu thay vi de GitHub Pages hien thi file raw.

## Lien ket file nguon

| File markdown nguon | Trang render |
|---|---|
| `DEM_DiagnosticEventManager.md` | [DEM]({{ '/dem/' | relative_url }}) |
| `DEM_DiagnosticEventManager1.md` | [DEM Visual]({{ '/dem-visual/' | relative_url }}) |
| `DCM_DiagnosticCommunicationManager.md` | [DCM]({{ '/dcm/' | relative_url }}) |

Neu can, toi co the tiep tuc them sidebar theo muc luc, auto table-of-contents hoac theme toi uu hon cho in an/xuat PDF.