---
layout: default
title: Unified Diagnostic Services
nav_title: Home
nav_order: 1
permalink: /
description: Tổng hợp tài liệu kỹ thuật về AUTOSAR Diagnostic Stack – DEM, DCM và các module liên quan.
---

Tổng hợp tài liệu kỹ thuật về **AUTOSAR Diagnostic Stack** bao gồm DEM, DCM và các module liên quan. Chọn module bên dưới để xem chi tiết, hoặc lọc theo tag.

{% assign all_module_pages = site.pages | where: "module", true | sort: "nav_order" %}
{% assign all_tags = "" | split: "" %}
{% for p in all_module_pages %}
  {% for t in p.tags %}
    {% unless all_tags contains t %}{% assign all_tags = all_tags | push: t %}{% endunless %}
  {% endfor %}
{% endfor %}

<div class="tag-filter" id="tag-filter">
  <button class="tag-btn is-active" data-tag="*">Tất cả</button>
  {% for tag in all_tags %}
  <button class="tag-btn" data-tag="{{ tag }}">{{ tag }}</button>
  {% endfor %}
</div>

<div class="doc-grid" id="module-grid">
  {% for p in all_module_pages %}
  <a class="doc-card" href="{{ p.url | relative_url }}" data-tags="{{ p.tags | join: ',' }}">
    <div class="doc-card__title">{{ p.title }}</div>
    <p class="doc-card__desc">{{ p.description }}</p>
    {% if p.tags %}
    <div class="doc-card__tags">{% for t in p.tags %}<span class="tag-badge">{{ t }}</span>{% endfor %}</div>
    {% endif %}
  </a>
  {% endfor %}
</div>

<script>
(function () {
  var filterBar = document.getElementById('tag-filter');
  var grid = document.getElementById('module-grid');
  if (!filterBar || !grid) return;
  filterBar.addEventListener('click', function (e) {
    var btn = e.target.closest('.tag-btn');
    if (!btn) return;
    filterBar.querySelectorAll('.tag-btn').forEach(function (b) { b.classList.remove('is-active'); });
    btn.classList.add('is-active');
    var tag = btn.dataset.tag;
    grid.querySelectorAll('.doc-card').forEach(function (card) {
      if (tag === '*') { card.style.display = ''; return; }
      var tags = card.dataset.tags ? card.dataset.tags.split(',') : [];
      card.style.display = tags.indexOf(tag) !== -1 ? '' : 'none';
    });
  });
})();
</script>
