# Unified_Diagnostic_Services

Thu muc nay da duoc tai cau truc de de quan ly, de mo rong va de publish len GitHub Pages ma khong bi lon xon.

## Cau truc hien tai

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

## Nguyen tac sap xep

1. Root chi chua file site-level va entry points.
2. Moi module tai lieu nam trong mot folder rieng duoi `modules/`.
3. Thu tu duoc kiem soat bang tien to so nhu `01-`, `02-`, `03-`.
4. `content.md` la file noi dung nguon.
5. `index.md` la wrapper page de Jekyll render noi dung len github.io.

## Cach them tai lieu moi

1. Tao folder moi, vi du `modules/04-fim/`.
2. Them noi dung vao `modules/04-fim/content.md`.
3. Tao `modules/04-fim/index.md` theo mau cua cac module hien co.
4. Dat `nav_order` va `permalink` phu hop.
5. Site se tu dong hien trang moi o navigation va homepage.

## Cac trang hien co

1. `modules/01-dem/` cho DEM co ban.
2. `modules/02-dem-visual/` cho DEM ban mo rong, nhieu Mermaid hon.
3. `modules/03-dcm/` cho DCM.
