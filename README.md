# README.md

## Nguyen tac sap xep

1. Root chua file site-level: `_config.yml`, `index.md` (Home), `README.md`.
2. Moi module la mot file duy nhat trong `modules/`, vi du `modules/01-dem.md`.
3. Thu tu duoc kiem soat bang tien to so: `01-`, `02-`, `03-`.
4. Frontmatter chua `module: true` va `tags: [...]` de Home page tu dong hien thi.
5. Layout HTML, CSS, JS tach rieng trong `_layouts/` va `assets/`.

## Cau truc thu muc

```text
Unified_Diagnostic_Services/
├── _config.yml
├── _layouts/default.html
├── assets/
│   ├── css/style.css
│   └── js/main.js
├── index.md              ← Home page
├── modules/
│   ├── 01-dem.md         ← DEM module
│   └── 02-dcm.md         ← DCM module
└── README.md
```

## Cach them tai lieu moi

1. Tao file moi, vi du `modules/03-fim.md`.
2. Them frontmatter voi `layout: default`, `module: true`, `tags: [...]`, `permalink`, `nav_order`.
3. Viet noi dung truc tiep trong file.
4. Home page se tu dong hien thi module card voi tags.
