---
layout: default
title: Unified Diagnostic Services
nav_title: Home
nav_order: 1
description: Trang tong hop tai lieu AUTOSAR UDS va lien ket den cac file markdown duoc render tren GitHub Pages.
---

# Unified Diagnostic Services

Trang nay duoc dung lam homepage cho GitHub Pages. Toan bo thu muc da duoc tai cau truc theo **thu tu module** de root gon gang, de tim, de mo rong va de giu file markdown nguon tach biet voi file render.

## Cau truc thu muc moi

```text
Unified_Diagnostic_Services/
├── _config.yml
├── _layouts/
│   └── default.html
├── index.md
├── README.md
└── modules/
  ├── 01-dem/
  │   ├── content.md
  │   └── index.md
  ├── 02-dem-visual/
  │   ├── content.md
  │   └── index.md
  └── 03-dcm/
    ├── content.md
    └── index.md
```

Nguyen tac cua cau truc nay:

1. `root` chi giu cac file site-level nhu `_config.yml`, `_layouts`, `index.md`, `README.md`.
2. Moi tai lieu lon duoc dat trong mot thu muc rieng ben duoi `modules/`.
3. Ten thu muc co tien to so de giu **thu tu ro rang** khi so module tang len.
4. `content.md` la file markdown nguon.
5. `index.md` la file wrapper co front matter de Jekyll render len GitHub Pages.

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
2. Moi thu muc module co mot `index.md` wrapper, lay noi dung tu `content.md` bang `include_relative` roi chuyen thanh HTML qua `markdownify`.
3. Script Mermaid se tim cac fenced block co ngon ngu `mermaid` va doi thanh so do thuc te trong browser.
4. `index.md` dong vai tro homepage de liet ke cac tai lieu thay vi de GitHub Pages hien thi file raw.

## Trinh tu tai lieu hien tai

| Thu tu | File markdown nguon | Trang render |
|---|---|
| `01` | `modules/01-dem/content.md` | [DEM]({{ '/dem/' | relative_url }}) |
| `02` | `modules/02-dem-visual/content.md` | [DEM Visual]({{ '/dem-visual/' | relative_url }}) |
| `03` | `modules/03-dcm/content.md` | [DCM]({{ '/dcm/' | relative_url }}) |

## Cach them mot file markdown moi

De them tai lieu moi ma khong lam thu muc root bi lon xon, chi can lam theo pattern sau:

1. Tao thu muc moi ben duoi `modules/`, vi du `modules/04-fim/`.
2. Dat noi dung markdown nguon vao `modules/04-fim/content.md`.
3. Tao `modules/04-fim/index.md` voi front matter `title`, `nav_title`, `nav_order`, `permalink`, `source_file`.
4. Trong `index.md`, dung pattern:

```liquid
{% capture page_source %}{% include_relative content.md %}{% endcapture %}
{{ page_source | markdownify }}
```

5. Homepage va top navigation se tu dong nhan page moi khi file co `title` va `nav_order` hop le.