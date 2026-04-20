---
layout: default
title: Unified Diagnostic Services
nav_order: 1
permalink: /
description: Tổng hợp tài liệu kỹ thuật về AUTOSAR Diagnostic Stack – DEM, DCM và các module liên quan.
---

<div class="hero-section">
  <h1>📚 Unified Diagnostic Services</h1>
  <p class="hero-section__desc">Tài liệu kỹ thuật chuyên sâu về <strong>AUTOSAR Diagnostic Stack</strong> - DEM, DCM, CanTp và các module liên quan.</p>
</div>

{% assign all_module_pages = site.pages | where: "module", true | sort: "path" %}
{% assign module_count = all_module_pages | size %}

<!-- Quick Stats -->
<div class="stats-bar">
  <div class="stat-item">
    <div class="stat-item__value">{{ module_count }}</div>
    <div class="stat-item__label">Modules</div>
  </div>
  <div class="stat-item">
    <div class="stat-item__value">6</div>
    <div class="stat-item__label">Chủ đề</div>
  </div>
  <div class="stat-item">
    <div class="stat-item__value">ISO 14229</div>
    <div class="stat-item__label">Tiêu chuẩn</div>
  </div>
</div>

<!-- Quick Access -->
<div class="section-header">
  <h3 class="section-header__title">
    <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    Truy cập nhanh
  </h3>
</div>

<div class="quick-access">
  <a class="quick-access__item" href="{{ '/uds-overview/' | relative_url }}">
    <div class="quick-access__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    </div>
    <span class="quick-access__text">UDS Overview</span>
  </a>
  <a class="quick-access__item" href="{{ '/dem-overview/' | relative_url }}">
    <div class="quick-access__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
    </div>
    <span class="quick-access__text">DEM Module</span>
  </a>
  <a class="quick-access__item" href="{{ '/dcm/' | relative_url }}">
    <div class="quick-access__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    </div>
    <span class="quick-access__text">DCM Module</span>
  </a>
  <a class="quick-access__item" href="{{ '/cantp/' | relative_url }}">
    <div class="quick-access__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
    </div>
    <span class="quick-access__text">CAN Transport</span>
  </a>
</div>

<!-- Search Box -->
<div class="section-header">
  <h3 class="section-header__title">
    <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
    Tất cả tài liệu
    <span class="section-header__count" id="modules-count">{{ module_count }} modules</span>
  </h3>
</div>

<div class="search-box">
  <svg class="search-box__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
  <input type="text" class="search-box__input" id="search-input" placeholder="Tìm kiếm module... (nhấn / để focus)">
  <button class="search-box__clear" id="search-clear" title="Xóa">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
  </button>
</div>

{% assign all_tags = "" | split: "" %}
{% for p in all_module_pages %}
  {% for t in p.tags %}
    {% unless all_tags contains t %}{% assign all_tags = all_tags | push: t %}{% endunless %}
  {% endfor %}
{% endfor %}

<!-- Tag Filter - Compact -->
<div class="tag-filter" id="tag-filter">
  <button class="tag-btn is-active" data-tag="*">Tất cả</button>
  {% for tag in all_tags limit: 8 %}
  <button class="tag-btn" data-tag="{{ tag }}">{{ tag }}</button>
  {% endfor %}
</div>

<div class="doc-grid" id="module-grid">
  {% assign counter = 0 %}
  {% for p in all_module_pages %}
  {% assign counter = counter | plus: 1 %}
  <a class="doc-card" href="{{ p.url | relative_url }}" data-tags="{{ p.tags | join: ',' }}">
    <span class="doc-card__number">{{ counter }}</span>
    <div class="doc-card__title">{{ p.title }}</div>
    <p class="doc-card__desc">{{ p.description }}</p>
    {% if p.tags %}
    <div class="doc-card__tags">
      {% for t in p.tags limit: 3 %}<span class="tag-badge">{{ t }}</span>{% endfor %}
      {% assign tag_count = p.tags | size %}
      {% if tag_count > 3 %}<span class="tag-badge">+{{ tag_count | minus: 3 }}</span>{% endif %}
    </div>
    {% endif %}
  </a>
  {% endfor %}
</div>

<!-- No Results Message -->
<div class="no-results" id="no-results" style="display: none;">
  <svg class="no-results__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M8 8l6 6M14 8l-6 6"/></svg>
  <p class="no-results__text">Không tìm thấy module phù hợp.<br>Thử từ khóa khác hoặc chọn "Tất cả".</p>
</div>

<hr>

<div style="text-align: center; color: var(--muted); font-size: 0.85rem;">
  <p>💡 <strong>Mẹo:</strong> Nhấn <kbd class="kbd">?</kbd> để xem các phím tắt hữu ích</p>
</div>
