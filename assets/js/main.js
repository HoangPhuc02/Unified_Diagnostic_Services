/* ===== Theme toggle ===== */
(function () {
  var STORAGE_KEY = "uds-theme";

  function getPreferred() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    // Update icon inside toggle button
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.innerHTML = theme === "dark"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
    }
  }

  // Apply immediately to prevent flash
  apply(getPreferred());

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    // Re-apply to update icon after DOM ready
    apply(getPreferred());
    btn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme") || "light";
      apply(current === "dark" ? "light" : "dark");
    });
  });
})();

/* ===== Floating TOC ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var panel = document.getElementById("toc-panel");
    var toggleBtn = document.getElementById("toc-toggle");
    var shell = document.querySelector(".site-shell");
    if (!panel) return;

    // Build TOC from h2/h3 inside .page-card
    var card = document.querySelector(".page-card");
    if (!card) return;
    var headings = card.querySelectorAll("h2, h3");
    if (headings.length === 0) {
      panel.classList.add("is-hidden");
      if (toggleBtn) toggleBtn.style.display = "none";
      return;
    }

    var ul = document.createElement("ul");
    headings.forEach(function (h, i) {
      if (!h.id) h.id = "heading-" + i;
      var li = document.createElement("li");
      if (h.tagName === "H3") li.className = "toc-h3";
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      li.appendChild(a);
      ul.appendChild(li);
    });
    panel.querySelector(".toc-panel__list").appendChild(ul);

    // Show TOC by default on wide screens
    var isMobile = window.innerWidth <= 840;
    if (!isMobile) {
      panel.classList.remove("is-hidden");
      if (shell) shell.classList.add("has-toc");
    }

    var backdrop = document.getElementById("toc-backdrop");
    var closeBtn = document.getElementById("toc-close");

    function openToc() {
      panel.classList.remove("is-hidden");
      if (isMobile) {
        panel.classList.add("is-open");
        if (backdrop) backdrop.classList.add("is-visible");
      }
      if (shell && !isMobile) shell.classList.add("has-toc");
    }

    function closeToc() {
      panel.classList.add("is-hidden");
      panel.classList.remove("is-open");
      if (backdrop) backdrop.classList.remove("is-visible");
      if (shell) shell.classList.remove("has-toc");
    }

    // Toggle button in header
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        if (panel.classList.contains("is-hidden")) { openToc(); } else { closeToc(); }
      });
    }

    // Close button inside panel (mobile)
    if (closeBtn) { closeBtn.addEventListener("click", closeToc); }

    // Backdrop click
    if (backdrop) { backdrop.addEventListener("click", closeToc); }

    // Close on Escape key
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.classList.contains("is-hidden")) { closeToc(); }
    });

    // Highlight active heading on scroll
    var links = panel.querySelectorAll("a");
    var headingEls = Array.from(headings);
    function onScroll() {
      var scrollY = window.scrollY + 80;
      var active = null;
      for (var i = headingEls.length - 1; i >= 0; i--) {
        if (headingEls[i].offsetTop <= scrollY) { active = headingEls[i]; break; }
      }
      links.forEach(function (l) {
        l.classList.toggle("is-active", active && l.getAttribute("href") === "#" + active.id);
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  });
})();

/* ===== Mermaid init ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    if (typeof mermaid === "undefined") return;

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default"
    });

    var selectors = [
      "div.language-mermaid pre code",
      "pre > code.language-mermaid",
      "code.language-mermaid"
    ];

    document.querySelectorAll(selectors.join(", ")).forEach(function (codeBlock) {
      if (codeBlock.closest(".mermaid")) return;
      var wrapper =
        codeBlock.closest("div.language-mermaid.highlighter-rouge") ||
        codeBlock.closest("div.highlighter-rouge.language-mermaid") ||
        codeBlock.closest("pre") ||
        codeBlock.parentElement;
      if (!wrapper) return;

      var diagram = document.createElement("div");
      diagram.className = "mermaid";
      diagram.textContent = codeBlock.textContent.trim();
      wrapper.replaceWith(diagram);
    });

    try { mermaid.run(); } catch (e) { console.error("Mermaid render error", e); }
  });
})();

/* ===== Tag filter (home page) ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var filterBar = document.getElementById("tag-filter");
    var grid = document.getElementById("module-grid");
    if (!filterBar || !grid) return;

    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".tag-btn");
      if (!btn) return;
      filterBar.querySelectorAll(".tag-btn").forEach(function (b) { b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      var tag = btn.dataset.tag;
      grid.querySelectorAll(".doc-card").forEach(function (card) {
        if (tag === "*") { card.style.display = ""; return; }
        var tags = card.dataset.tags ? card.dataset.tags.split(",") : [];
        card.style.display = tags.indexOf(tag) !== -1 ? "" : "none";
      });
    });
  });
})();
