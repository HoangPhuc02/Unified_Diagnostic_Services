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
      filterCards(tag, "");
    });
    
    // Search functionality
    var searchInput = document.getElementById("search-input");
    var clearBtn = document.getElementById("search-clear");
    if (searchInput) {
      searchInput.addEventListener("input", function() {
        var query = this.value.toLowerCase().trim();
        if (clearBtn) {
          clearBtn.classList.toggle("is-visible", query.length > 0);
        }
        var activeTag = filterBar.querySelector(".tag-btn.is-active");
        var tag = activeTag ? activeTag.dataset.tag : "*";
        filterCards(tag, query);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function() {
        searchInput.value = "";
        clearBtn.classList.remove("is-visible");
        var activeTag = filterBar.querySelector(".tag-btn.is-active");
        var tag = activeTag ? activeTag.dataset.tag : "*";
        filterCards(tag, "");
        searchInput.focus();
      });
    }
    
    function filterCards(tag, query) {
      var cards = grid.querySelectorAll(".doc-card");
      var visibleCount = 0;
      cards.forEach(function(card) {
        var tags = card.dataset.tags ? card.dataset.tags.split(",") : [];
        var title = (card.querySelector(".doc-card__title")?.textContent || "").toLowerCase();
        var desc = (card.querySelector(".doc-card__desc")?.textContent || "").toLowerCase();
        
        var matchesTag = tag === "*" || tags.indexOf(tag) !== -1;
        var matchesQuery = !query || title.includes(query) || desc.includes(query);
        
        if (matchesTag && matchesQuery) {
          card.style.display = "";
          visibleCount++;
        } else {
          card.style.display = "none";
        }
      });
      
      // Show/hide no results message
      var noResults = document.getElementById("no-results");
      if (noResults) {
        noResults.style.display = visibleCount === 0 ? "block" : "none";
      }
      
      // Update count
      var countEl = document.getElementById("modules-count");
      if (countEl) {
        countEl.textContent = visibleCount + " modules";
      }
    }
  });
})();

/* ===== Scroll-to-Top Button ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("scroll-top-btn");
    if (!btn) return;
    
    var threshold = 300;
    
    function checkScroll() {
      if (window.scrollY > threshold) {
        btn.classList.add("is-visible");
      } else {
        btn.classList.remove("is-visible");
      }
    }
    
    window.addEventListener("scroll", checkScroll, { passive: true });
    checkScroll();
    
    btn.addEventListener("click", function() {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
})();

/* ===== Reading Progress Bar ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var progressBar = document.getElementById("reading-progress");
    var pageCard = document.querySelector(".page-card");
    if (!progressBar || !pageCard) return;
    
    function updateProgress() {
      var cardRect = pageCard.getBoundingClientRect();
      var cardTop = pageCard.offsetTop;
      var cardHeight = pageCard.offsetHeight;
      var windowHeight = window.innerHeight;
      var scrollY = window.scrollY;
      
      var start = cardTop;
      var end = cardTop + cardHeight - windowHeight;
      var progress = 0;
      
      if (scrollY <= start) {
        progress = 0;
      } else if (scrollY >= end) {
        progress = 100;
      } else {
        progress = ((scrollY - start) / (end - start)) * 100;
      }
      
      progressBar.style.width = Math.min(100, Math.max(0, progress)) + "%";
    }
    
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress, { passive: true });
    updateProgress();
  });
})();

/* ===== Keyboard Shortcuts ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var modal = document.getElementById("shortcuts-modal");
    var closeBtn = document.getElementById("shortcuts-close");
    
    function showModal() {
      if (modal) modal.classList.add("is-visible");
    }
    
    function hideModal() {
      if (modal) modal.classList.remove("is-visible");
    }
    
    if (closeBtn) {
      closeBtn.addEventListener("click", hideModal);
    }
    
    if (modal) {
      modal.addEventListener("click", function(e) {
        if (e.target === modal) hideModal();
      });
    }
    
    document.addEventListener("keydown", function(e) {
      // Don't trigger if typing in input
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      
      // ? - Show shortcuts modal
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (modal && modal.classList.contains("is-visible")) {
          hideModal();
        } else {
          showModal();
        }
      }
      
      // Escape - Close modal
      if (e.key === "Escape") {
        hideModal();
      }
      
      // g + h - Go home
      if (e.key === "h" && !e.ctrlKey && !e.metaKey) {
        var homeBtn = document.querySelector(".home-btn");
        if (homeBtn) {
          e.preventDefault();
          homeBtn.click();
        }
      }
      
      // t - Toggle TOC
      if (e.key === "t" && !e.ctrlKey && !e.metaKey) {
        var tocToggle = document.getElementById("toc-toggle");
        if (tocToggle) {
          e.preventDefault();
          tocToggle.click();
        }
      }
      
      // d - Toggle dark mode
      if (e.key === "d" && !e.ctrlKey && !e.metaKey) {
        var themeToggle = document.getElementById("theme-toggle");
        if (themeToggle) {
          e.preventDefault();
          themeToggle.click();
        }
      }
      
      // / or s - Focus search
      if ((e.key === "/" || e.key === "s") && !e.ctrlKey && !e.metaKey) {
        var searchInput = document.getElementById("search-input");
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
      }
      
      // j - Next page
      if (e.key === "j" && !e.ctrlKey && !e.metaKey) {
        var nextLink = document.querySelector(".page-nav__link--next:not(.page-nav__link--placeholder)");
        if (nextLink) {
          e.preventDefault();
          nextLink.click();
        }
      }
      
      // k - Previous page
      if (e.key === "k" && !e.ctrlKey && !e.metaKey) {
        var prevLink = document.querySelector(".page-nav__link--prev:not(.page-nav__link--placeholder)");
        if (prevLink) {
          e.preventDefault();
          prevLink.click();
        }
      }
      
      // g + t - Scroll to top
      if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });
})();

/* ===== Mobile FAB Menu ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var fab = document.getElementById("mobile-fab");
    var fabToggle = document.getElementById("mobile-fab-toggle");
    var fabMenu = document.getElementById("mobile-fab-menu");
    var iconMenu = document.getElementById("mobile-fab-icon-menu");
    var iconClose = document.getElementById("mobile-fab-icon-close");
    
    if (!fabToggle || !fabMenu) return;
    
    var isOpen = false;
    
    function toggleMenu() {
      isOpen = !isOpen;
      fabMenu.classList.toggle("is-open", isOpen);
      if (iconMenu) iconMenu.style.display = isOpen ? "none" : "block";
      if (iconClose) iconClose.style.display = isOpen ? "block" : "none";
    }
    
    function closeMenu() {
      isOpen = false;
      fabMenu.classList.remove("is-open");
      if (iconMenu) iconMenu.style.display = "block";
      if (iconClose) iconClose.style.display = "none";
    }
    
    fabToggle.addEventListener("click", function(e) {
      e.stopPropagation();
      toggleMenu();
    });
    
    // Close menu when clicking outside
    document.addEventListener("click", function(e) {
      if (!fab.contains(e.target)) {
        closeMenu();
      }
    });
    
    // Home button
    var homeBtn = document.getElementById("mobile-home-btn");
    if (homeBtn) {
      homeBtn.addEventListener("click", function() {
        closeMenu();
        window.location.href = document.querySelector(".home-btn")?.href || "/";
      });
    }
    
    // TOC button
    var tocBtn = document.getElementById("mobile-toc-btn");
    if (tocBtn) {
      tocBtn.addEventListener("click", function() {
        closeMenu();
        document.getElementById("toc-toggle")?.click();
      });
    }
    
    // Theme button
    var themeBtn = document.getElementById("mobile-theme-btn");
    if (themeBtn) {
      themeBtn.addEventListener("click", function() {
        closeMenu();
        document.getElementById("theme-toggle")?.click();
      });
    }
    
    // Previous page button
    var prevBtn = document.getElementById("mobile-prev-btn");
    if (prevBtn) {
      prevBtn.addEventListener("click", function() {
        closeMenu();
        var prevLink = document.querySelector(".page-nav__link--prev:not(.page-nav__link--placeholder)");
        if (prevLink) {
          prevLink.click();
        }
      });
    }
    
    // Next page button
    var nextBtn = document.getElementById("mobile-next-btn");
    if (nextBtn) {
      nextBtn.addEventListener("click", function() {
        closeMenu();
        var nextLink = document.querySelector(".page-nav__link--next:not(.page-nav__link--placeholder)");
        if (nextLink) {
          nextLink.click();
        }
      });
    }
  });
})();

/* ===== Mobile Scroll Buttons ===== */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var scrollTopBtn = document.getElementById("mobile-scroll-top");
    var scrollBottomBtn = document.getElementById("mobile-scroll-bottom");
    
    if (!scrollTopBtn || !scrollBottomBtn) return;
    
    var threshold = 200;
    
    function checkScroll() {
      var scrollY = window.scrollY;
      var docHeight = document.documentElement.scrollHeight;
      var windowHeight = window.innerHeight;
      var atBottom = scrollY + windowHeight >= docHeight - 100;
      
      // Show scroll-to-top when scrolled down
      if (scrollY > threshold) {
        scrollTopBtn.classList.add("is-visible");
      } else {
        scrollTopBtn.classList.remove("is-visible");
      }
      
      // Show scroll-to-bottom when not at bottom
      if (!atBottom && scrollY < docHeight - windowHeight - threshold) {
        scrollBottomBtn.classList.add("is-visible");
      } else {
        scrollBottomBtn.classList.remove("is-visible");
      }
    }
    
    window.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll, { passive: true });
    checkScroll();
    
    // Scroll to top
    scrollTopBtn.addEventListener("click", function() {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    
    // Scroll to bottom
    scrollBottomBtn.addEventListener("click", function() {
      window.scrollTo({ 
        top: document.documentElement.scrollHeight, 
        behavior: "smooth" 
      });
    });
  });
})();

// ===== Category Tabs =====
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var tabs = document.querySelectorAll('.cat-tab');
    if (!tabs.length) return;
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        var cat = tab.getAttribute('data-cat');
        document.querySelectorAll('.cat-section').forEach(function(sec) {
          sec.classList.add('is-hidden');
        });
        var target = document.getElementById('cat-' + cat);
        if (target) target.classList.remove('is-hidden');
      });
    });
  });
})();
