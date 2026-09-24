/* Wrenfield: shared behaviour. Plain script, no modules, so file:// works. */

window.WF = window.WF || {};

(function (WF, doc) {
  "use strict";

  var root = doc.documentElement;
  var FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "summary",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function focusable(container) {
    return Array.prototype.filter.call(container.querySelectorAll(FOCUSABLE), function (node) {
      if (node.hasAttribute("hidden") || node.closest("[hidden]")) return false;
      return node.offsetWidth > 0 || node.offsetHeight > 0 || node === doc.activeElement;
    });
  }

  /* Overlay: menu panel and role drawer share this. Traps focus, marks the rest
     of the page inert, restores focus and scroll on close. */
  WF.overlay = function (el, options) {
    var opts = options || {};
    var backdrop = opts.backdrop ? doc.querySelector(opts.backdrop) : null;
    var inertNodes = (opts.inert || []).map(function (sel) {
      return doc.querySelector(sel);
    });
    var openers = (opts.openers || []).map(function (sel) {
      return doc.querySelector(sel);
    }).filter(Boolean);
    var state = false;
    var lastFocus = null;

    function setInert(on) {
      inertNodes.forEach(function (node) {
        if (!node) return;
        if (on) node.setAttribute("inert", "");
        else node.removeAttribute("inert");
      });
    }

    function onKeydown(event) {
      if (!state) return;

      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }

      if (event.key !== "Tab") return;

      var items = focusable(el);
      if (!items.length) {
        event.preventDefault();
        return;
      }

      var first = items[0];
      var last = items[items.length - 1];
      var active = doc.activeElement;

      if (event.shiftKey && (active === first || !el.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function open(trigger) {
      if (state) return;
      state = true;
      lastFocus = trigger || doc.activeElement;

      el.hidden = false;
      el.removeAttribute("inert");
      void el.offsetWidth;

      el.classList.add("is-open");
      if (backdrop) backdrop.classList.add("is-open");

      setInert(true);
      doc.body.style.overflow = "hidden";

      var target =
        el.querySelector("[data-autofocus]") ||
        (el.getAttribute("tabindex") === "-1" ? el : null) ||
        focusable(el)[0];
      if (target) target.focus({ preventScroll: true });

      if (opts.onOpen) opts.onOpen();
    }

    function close() {
      if (!state) return;
      state = false;

      el.classList.remove("is-open");
      if (backdrop) backdrop.classList.remove("is-open");

      setInert(false);
      doc.body.style.overflow = "";

      var settle = function () {
        if (state) return;
        el.hidden = true;
        el.removeEventListener("transitionend", settle);
      };
      el.addEventListener("transitionend", settle);
      window.setTimeout(settle, 500);

      if (lastFocus && typeof lastFocus.focus === "function") {
        lastFocus.focus({ preventScroll: true });
      }

      if (opts.onClose) opts.onClose();
    }

    openers.forEach(function (opener) {
      opener.addEventListener("click", function (event) {
        event.preventDefault();
        open(opener);
      });
    });

    Array.prototype.forEach.call(el.querySelectorAll("[data-close]"), function (node) {
      node.addEventListener("click", function (event) {
        event.preventDefault();
        close();
      });
    });

    if (backdrop) {
      backdrop.addEventListener("click", close);
    }

    doc.addEventListener("keydown", onKeydown);

    return {
      open: open,
      close: close,
      isOpen: function () {
        return state;
      },
      element: el
    };
  };

  /* Scroll reveal. Elements are only hidden once the `js` class is present,
     so the page reads fine without JavaScript. */
  WF.reveal = function () {
    var nodes = Array.prototype.slice.call(doc.querySelectorAll(".reveal"));
    if (!nodes.length) return;

    var settleAll = function () {
      nodes.forEach(function (node) {
        node.classList.add("is-in");
      });
    };

    if (root.getAttribute("data-motion") === "none" || !("IntersectionObserver" in window)) {
      settleAll();
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var node = entry.target;
          var delay = node.style.getPropertyValue("--reveal-delay");

          if (!delay) {
            var siblings = node.parentNode ? node.parentNode.children : [];
            var index = Array.prototype.indexOf.call(siblings, node);
            delay = Math.max(index, 0) * 20 + Math.round(Math.random() * 10 - 5) + "ms";
          }

          node.style.transitionDelay = delay;
          node.classList.add("is-in");
          observer.unobserve(node);
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.1 }
    );

    nodes.forEach(function (node) {
      observer.observe(node);
    });

    WF.onMotionChange(function (level) {
      if (level === "none") settleAll();
    });
  };

  /* Motion level control in the footer. */
  WF.onMotionChange = function (handler) {
    WF._motionHandlers.push(handler);
  };

  WF._motionHandlers = [];

  WF.motionControl = function () {
    var inputs = Array.prototype.slice.call(doc.querySelectorAll('input[name="motion"]'));
    if (!inputs.length) return;

    var current = root.getAttribute("data-motion") || "standard";

    inputs.forEach(function (input) {
      input.checked = input.value === current;

      input.addEventListener("change", function () {
        if (!input.checked) return;
        root.setAttribute("data-motion", input.value);

        try {
          localStorage.setItem("wrenfield.motion", input.value);
        } catch (error) {
          /* storage is unavailable, the choice just does not persist */
        }

        WF._motionHandlers.forEach(function (handler) {
          handler(input.value);
        });
      });
    });
  };

  WF.motionValue = function () {
    return root.getAttribute("data-motion") || "standard";
  };

  WF.serialise = function (form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name) return;
      if (field.type === "checkbox") data[field.name] = field.checked;
      else if (field.type === "radio") {
        if (field.checked) data[field.name] = field.value;
      } else data[field.name] = field.value;
    });
    return data;
  };

  WF.debounce = function (fn, wait) {
    var timer;
    return function () {
      var args = arguments;
      var self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(self, args);
      }, wait);
    };
  };

  /* Field validation. Messages are attached to the field, not the whole form. */
  WF.validate = function (form) {
    var fields = Array.prototype.slice.call(form.querySelectorAll("[data-validate]"));
    var errors = [];

    fields.forEach(function (input) {
      var wrapper = input.closest(".field") || input.parentNode;
      var rules = (input.getAttribute("data-validate") || "").split(" ");
      var value = (input.type === "checkbox" ? (input.checked ? "on" : "") : input.value).trim();
      var message = "";

      if (rules.indexOf("required") > -1 && !value) {
        message = input.getAttribute("data-message-required") || "This is needed before we can send the form.";
      } else if (rules.indexOf("email") > -1 && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        message = input.getAttribute("data-message-type") || "That email address does not look complete.";
      } else if (rules.indexOf("tel") > -1 && value && !/^[0-9 +()-]{9,20}$/.test(value)) {
        message = input.getAttribute("data-message-type") || "Use digits, spaces, brackets or a plus sign.";
      } else if (rules.indexOf("min") > -1 && value && value.length < Number(input.getAttribute("data-min") || 20)) {
        message = input.getAttribute("data-message-min") || "A sentence or two is genuinely useful here.";
      }

      var errorNode = wrapper.querySelector(".field__error");

      if (message) {
        wrapper.setAttribute("data-invalid", "true");
        input.setAttribute("aria-invalid", "true");
        if (errorNode) {
          errorNode.textContent = message;
          input.setAttribute("aria-describedby", errorNode.id || "");
        }
        errors.push({ input: input, message: message, label: input.getAttribute("data-label") || input.name });
      } else {
        wrapper.removeAttribute("data-invalid");
        input.removeAttribute("aria-invalid");
      }
    });

    return errors;
  };

  WF.clearValidation = function (form) {
    Array.prototype.forEach.call(form.querySelectorAll("[data-invalid]"), function (wrapper) {
      wrapper.removeAttribute("data-invalid");
    });
    Array.prototype.forEach.call(form.querySelectorAll("[aria-invalid]"), function (input) {
      input.removeAttribute("aria-invalid");
    });
  };

  WF.errorSummary = function (form, errors, statusNode) {
    if (!statusNode) return;
    if (!errors.length) {
      statusNode.hidden = true;
      return;
    }

    var items = errors
      .map(function (error) {
        var target = error.input.id;
        return "<li><a href='#" + target + "'>" + error.label + ": " + error.message + "</a></li>";
      })
      .join("");

    statusNode.className = "form-status form-status--error";
    statusNode.innerHTML =
      "<p class='form-status__title'>" +
      errors.length +
      (errors.length === 1 ? " thing needs" : " things need") +
      " attention</p><ul class='form-status__list'>" +
      items +
      "</ul>";
    statusNode.hidden = false;

    var first = statusNode.querySelector("a");
    if (first) first.focus();
  };

  WF.setStatus = function (statusNode, kind, title, body) {
    if (!statusNode) return;
    statusNode.className = "form-status form-status--" + kind;
    statusNode.innerHTML =
      "<p class='form-status__title'></p><p class='form-status__body'></p>";
    statusNode.querySelector(".form-status__title").textContent = title;
    statusNode.querySelector(".form-status__body").innerHTML = body;
    statusNode.hidden = false;
  };

  /* Boot ------------------------------------------------------------------ */

  doc.addEventListener("DOMContentLoaded", function () {
    var header = doc.getElementById("site-header");

    if (header) {
      var mark = function () {
        header.setAttribute("data-scrolled", window.scrollY > 8 ? "true" : "false");
      };
      mark();
      window.addEventListener("scroll", mark, { passive: true });
    }

    var year = doc.getElementById("year");
    if (year) year.textContent = String(new Date().getFullYear());

    var navPanel = doc.getElementById("nav-panel");
    if (navPanel) {
      var menu = WF.overlay(navPanel, {
        openers: ["#menu-toggle"],
        inert: ["#site-header", "#main", ".site-footer"],
        onClose: function () {
          var toggle = doc.getElementById("menu-toggle");
          if (toggle) toggle.setAttribute("aria-expanded", "false");
        }
      });

      Array.prototype.forEach.call(navPanel.querySelectorAll("a[href]"), function (link) {
        link.addEventListener("click", function () {
          menu.close();
        });
      });

      var toggle = doc.getElementById("menu-toggle");
      if (toggle) {
        toggle.addEventListener("click", function () {
          toggle.setAttribute("aria-expanded", "true");
        });
      }
    }

    var toTop = doc.getElementById("to-top");
    if (toTop) {
      toTop.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: WF.motionValue() === "none" ? "auto" : "smooth" });
      });
    }

    var videoButton = doc.querySelector("[data-video-note]");
    var videoNote = doc.getElementById("video-note");
    if (videoButton && videoNote) {
      videoButton.addEventListener("click", function () {
        videoNote.hidden = false;
        videoNote.focus();
      });
    }

    var slides = Array.prototype.slice.call(doc.querySelectorAll("[data-slide]"));
    var dots = Array.prototype.slice.call(doc.querySelectorAll("[data-slide-to]"));

    if (slides.length > 1 && dots.length === slides.length) {
      var showSlide = function (index) {
        slides.forEach(function (slide) {
          slide.hidden = Number(slide.getAttribute("data-slide")) !== index;
        });
        dots.forEach(function (dot, dotIndex) {
          dot.setAttribute("aria-current", dotIndex === index ? "true" : "false");
        });
      };

      dots.forEach(function (dot) {
        dot.addEventListener("click", function () {
          showSlide(Number(dot.getAttribute("data-slide-to")));
        });
      });
    }

    /* Hero banner slider: the photographs rotate, the content does not. */
    var heroSlides = Array.prototype.slice.call(doc.querySelectorAll(".hero__slide"));

    if (heroSlides.length > 1) {
      var heroIndex = 0;
      var heroTimer = null;

      var showHeroSlide = function (index) {
        heroSlides.forEach(function (slide, slideIndex) {
          if (slideIndex === index) slide.classList.add("is-active");
          else slide.classList.remove("is-active");
        });
        heroIndex = index;
      };

      var stopHeroSlider = function () {
        if (heroTimer) {
          window.clearInterval(heroTimer);
          heroTimer = null;
        }
      };

      var startHeroSlider = function () {
        stopHeroSlider();

        var level = WF.motionValue();
        if (level === "none" || level === "reduced" || doc.hidden) return;

        heroTimer = window.setInterval(function () {
          showHeroSlide((heroIndex + 1) % heroSlides.length);
        }, 6000);
      };

      startHeroSlider();

      WF.onMotionChange(function () {
        showHeroSlide(0);
        startHeroSlider();
      });

      doc.addEventListener("visibilitychange", function () {
        if (doc.hidden) stopHeroSlider();
        else startHeroSlider();
      });
    }

    WF.motionControl();
    WF.reveal();
  });
})(window.WF, document);
