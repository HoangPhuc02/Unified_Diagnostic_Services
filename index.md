---
layout: default
title: Embedded Documentation Hub
nav_order: 1
permalink: /
description: Technical documentation for AUTOSAR Diagnostic Stack (UDS/DEM/DCM) and ESP32-S3 embedded development.
---

<div class="hero-section">
  <h1>📚 Embedded Documentation Hub</h1>
  <p class="hero-section__desc">Technical documentation for <strong>AUTOSAR UDS Diagnostic Stack</strong> and <strong>ESP32-S3</strong> embedded development.</p>
</div>

{% assign all_module_pages    = site.pages | where: "module", true | sort: "path" %}
{% assign uds_pages           = all_module_pages | where: "category", "uds" %}
{% assign esp32_pages         = all_module_pages | where: "category", "esp32s3" %}
{% assign uds_adaptive_pages  = all_module_pages | where: "category", "uds_adaptive" %}
{% assign communication_pages = all_module_pages | where: "category", "communication" %}

<!-- Quick Stats -->
<div class="stats-bar">
  <div class="stat-item">
    <div class="stat-item__value">{{ uds_pages | size }}</div>
    <div class="stat-item__label">UDS Classic</div>
  </div>
  <div class="stat-item">
    <div class="stat-item__value">{{ esp32_pages | size }}</div>
    <div class="stat-item__label">ESP32-S3 Docs</div>
  </div>
  <div class="stat-item">
    <div class="stat-item__value">{{ uds_adaptive_pages | size }}</div>
    <div class="stat-item__label">UDS Adaptive</div>
  </div>
  <div class="stat-item">
    <div class="stat-item__value">{{ communication_pages | size }}</div>
    <div class="stat-item__label">Communication</div>
  </div>
  <div class="stat-item">
    <div class="stat-item__value">ISO 14229</div>
    <div class="stat-item__label">Standard</div>
  </div>
</div>

<!-- Category Tabs -->
<div class="cat-tabs-wrapper">
<div class="cat-tabs" role="tablist">
  <button class="cat-tab is-active" data-cat="uds" role="tab" aria-selected="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    UDS Classic
    <span class="cat-tab__count">{{ uds_pages | size }}</span>
  </button>
  <button class="cat-tab" data-cat="esp32s3" role="tab" aria-selected="false">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2M8 11h.01M12 11h.01M16 11h.01"/></svg>
    ESP32-S3
    <span class="cat-tab__count">{{ esp32_pages | size }}</span>
  </button>
  <button class="cat-tab" data-cat="uds_adaptive" role="tab" aria-selected="false">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    UDS Adaptive
    <span class="cat-tab__count">{{ uds_adaptive_pages | size }}</span>
  </button>
  <button class="cat-tab" data-cat="communication" role="tab" aria-selected="false">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.36 11.8 19.79 19.79 0 011.3 3.18 2 2 0 013.28 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 8.5a16 16 0 006.4 6.4l1.67-1.94a2 2 0 012.1-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
    Communication
    <span class="cat-tab__count">{{ communication_pages | size }}</span>
  </button>
</div><!-- end .cat-tabs -->
</div><!-- end .cat-tabs-wrapper -->

<!-- ===== UDS Section ===== -->
<div class="cat-section" id="cat-uds">

  <!-- Quick Access -->
  <div class="section-header">
    <h3 class="section-header__title">
      <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      Quick Access
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
    <a class="quick-access__item" href="{{ '/pdur/' | relative_url }}">
      <div class="quick-access__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
      </div>
      <span class="quick-access__text">PduR Module</span>
    </a>
  </div>

  <!-- Search & Filter -->
  <div class="section-header">
    <h3 class="section-header__title">
      <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
      All UDS Modules
      <span class="section-header__count" id="modules-count">{{ uds_pages | size }} modules</span>
    </h3>
  </div>

  <div class="search-box">
    <svg class="search-box__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
    <input type="text" class="search-box__input" id="search-input" placeholder="Search modules...">
    <button class="search-box__clear" id="search-clear" title="Clear">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>

  {% assign uds_tags = "" | split: "" %}
  {% for p in uds_pages %}
    {% for t in p.tags %}
      {% unless uds_tags contains t %}{% assign uds_tags = uds_tags | push: t %}{% endunless %}
    {% endfor %}
  {% endfor %}

  <div class="tag-filter" id="tag-filter">
    <button class="tag-btn is-active" data-tag="*">All</button>
    {% for tag in uds_tags limit: 8 %}
    <button class="tag-btn" data-tag="{{ tag }}">{{ tag }}</button>
    {% endfor %}
  </div>

  <div class="doc-grid" id="module-grid">
    {% assign counter = 0 %}
    {% for p in uds_pages %}
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

  <div class="no-results" id="no-results" style="display: none;">
    <svg class="no-results__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M8 8l6 6M14 8l-6 6"/></svg>
    <p class="no-results__text">No matching modules found.<br>Try a different keyword or select "All".</p>
  </div>

</div><!-- end #cat-uds -->

<!-- ===== ESP32-S3 Section ===== -->
<div class="cat-section is-hidden" id="cat-esp32s3">

  <div class="section-header">
    <h3 class="section-header__title">
      <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2M8 11h.01M12 11h.01M16 11h.01"/></svg>
      ESP32-S3 Guides
      <span class="section-header__count">{{ esp32_pages | size }} guides</span>
    </h3>
  </div>

  <div class="doc-grid">
    {% assign counter = 0 %}
    {% for p in esp32_pages %}
    {% assign counter = counter | plus: 1 %}
    <a class="doc-card" href="{{ p.url | relative_url }}" data-tags="{{ p.tags | join: ',' }}">
      <span class="doc-card__number">{{ counter }}</span>
      <div class="doc-card__title">{{ p.title }}</div>
      <p class="doc-card__desc">{{ p.description }}</p>
      {% if p.tags %}
      <div class="doc-card__tags">
        {% for t in p.tags limit: 3 %}<span class="tag-badge">{{ t }}</span>{% endfor %}
      </div>
      {% endif %}
    </a>
    {% endfor %}
  </div>

</div><!-- end #cat-esp32s3 -->

<!-- ===== UDS Adaptive Section ===== -->
<div class="cat-section is-hidden" id="cat-uds_adaptive">

  <div class="section-header">
    <h3 class="section-header__title">
      <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      UDS Adaptive (AUTOSAR AP)
      <span class="section-header__count">{{ uds_adaptive_pages | size }} parts</span>
    </h3>
  </div>

  <div class="cat-section-intro">
    <p>Tài liệu về <strong>UDS trên AUTOSAR Adaptive Platform</strong> – kiến trúc <code>ara::diag</code>,
    Diagnostic Manager (DM), DoIP transport, và ví dụ C++. Chuẩn tham chiếu:
    <a href="https://www.autosar.org/fileadmin/standards/R25-11/AP/AUTOSAR_AP_SWS_Diagnostics.pdf" target="_blank" rel="noopener">AUTOSAR_AP_SWS_Diagnostics R25-11</a>
    &amp; ISO 14229-1:2020.</p>
  </div>

  <div class="doc-grid">
    {% assign counter = 0 %}
    {% for p in uds_adaptive_pages %}
    {% assign counter = counter | plus: 1 %}
    <a class="doc-card" href="{{ p.url | relative_url }}" data-tags="{{ p.tags | join: ',' }}">
      <span class="doc-card__number">{{ counter }}</span>
      <div class="doc-card__title">{{ p.title }}</div>
      <p class="doc-card__desc">{{ p.description }}</p>
      {% if p.tags %}
      <div class="doc-card__tags">
        {% for t in p.tags limit: 3 %}<span class="tag-badge">{{ t }}</span>{% endfor %}
      </div>
      {% endif %}
    </a>
    {% endfor %}
  </div>

</div><!-- end #cat-uds_adaptive -->

<!-- ===== Communication Section ===== -->
<div class="cat-section is-hidden" id="cat-communication">

  <div class="section-header">
    <h3 class="section-header__title">
      <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.36 11.8 19.79 19.79 0 011.3 3.18 2 2 0 013.28 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 8.5a16 16 0 006.4 6.4l1.67-1.94a2 2 0 012.1-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
      Communication Stack
      <span class="section-header__count">{{ communication_pages | size }} modules</span>
    </h3>
  </div>

  <div class="cat-section-intro">
    <p>Tài liệu về <strong>AUTOSAR Communication Stack</strong> – PDU Router (PduR), CAN Transport Protocol (CanTp),
    và Diagnostics over IP (DoIP). Covers ISO 15765-2 (CanTp) và ISO 13400-2 (DoIP).</p>
  </div>

  <!-- Quick Access -->
  <div class="section-header">
    <h3 class="section-header__title">
      <svg class="section-header__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      Quick Access
    </h3>
  </div>

  <div class="quick-access">
    <a class="quick-access__item" href="{{ '/pdur/' | relative_url }}">
      <div class="quick-access__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
      </div>
      <span class="quick-access__text">PduR Module</span>
    </a>
    <a class="quick-access__item" href="{{ '/cantp/' | relative_url }}">
      <div class="quick-access__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      </div>
      <span class="quick-access__text">CAN Transport</span>
    </a>
    <a class="quick-access__item" href="{{ '/doip/' | relative_url }}">
      <div class="quick-access__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
      </div>
      <span class="quick-access__text">DoIP Overview</span>
    </a>
  </div>

  <div class="doc-grid">
    {% assign counter = 0 %}
    {% for p in communication_pages %}
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

</div><!-- end #cat-communication -->

<hr>

<div style="text-align: center; color: var(--muted); font-size: 0.85rem;">
  <p>💡 <strong>Tip:</strong> Press <kbd class="kbd">?</kbd> for keyboard shortcuts</p>
</div>
