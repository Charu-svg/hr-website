/* The board: roles from the API (falling back to the bundled ledger),
   filtering, sorting, states, and the role drawer with a real application. */

(function (WF, doc) {
  "use strict";

  var roles = window.WRENFIELD_ROLES || [];

  var els = {
    form: doc.getElementById("board-filters"),
    q: doc.getElementById("board-q"),
    sort: doc.getElementById("board-sort"),
    location: doc.getElementById("board-location"),
    contract: doc.getElementById("board-contract"),
    salary: doc.getElementById("board-salary"),
    filled: doc.getElementById("board-filled"),
    clear: doc.getElementById("board-clear"),
    deskInputs: Array.prototype.slice.call(doc.querySelectorAll('input[name="desk"]')),
    results: doc.getElementById("board-results"),
    loading: doc.getElementById("board-loading"),
    empty: doc.getElementById("board-empty"),
    error: doc.getElementById("board-error"),
    retry: doc.getElementById("board-retry"),
    emptyClear: doc.getElementById("board-empty-clear"),
    status: doc.getElementById("board-status"),
    count: doc.getElementById("board-count"),
    active: doc.getElementById("board-active"),
    excluded: doc.getElementById("board-excluded"),
    moreWrap: doc.getElementById("board-more-wrap"),
    more: doc.getElementById("board-more"),
    moreNote: doc.getElementById("board-more-note"),
    drawer: doc.getElementById("role-drawer"),
    drawerEyebrow: doc.getElementById("drawer-eyebrow"),
    drawerTitle: doc.getElementById("drawer-title"),
    drawerBody: doc.getElementById("drawer-body"),
    drawerFoot: doc.getElementById("drawer-foot"),
    applyLink: doc.getElementById("drawer-apply-link"),
    alertForm: doc.getElementById("alert-form"),
    alertStatus: doc.getElementById("alert-status")
  };

  var PAGE = 8;

  var state = {
    q: "",
    desks: [],
    location: "all",
    contract: "all",
    salary: "all",
    sort: "recent",
    filled: false,
    limit: PAGE
  };

  var bandRanges = {
    "0-500000": [0, 500000],
    "500000-1200000": [500000, 1200000],
    "1200000-2500000": [1200000, 2500000],
    "2500000-99999999": [2500000, 99999999]
  };

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function stageClass(stage) {
    return "stage stage--" + stage;
  }

  function salaryCeiling(role) {
    if (role.salaryMax !== null && role.salaryMax !== undefined) return role.salaryMax;
    return role.salaryMin;
  }

  function salaryFloor(role) {
    if (role.salaryMin !== null && role.salaryMin !== undefined) return role.salaryMin;
    return role.salaryMax;
  }

  function hasBand(role) {
    return role.salaryMin !== null && role.salaryMin !== undefined;
  }

  function matches(role) {
    if (!state.filled && role.stage === "placed") return false;

    if (state.desks.length && state.desks.indexOf(role.desk) === -1) return false;
    if (state.location !== "all" && String(role.location || "").indexOf(state.location) !== 0) return false;
    if (state.contract !== "all" && String(role.contract || "").indexOf(state.contract) !== 0) return false;

    if (state.salary !== "all") {
      if (!hasBand(role)) return false;
      var range = bandRanges[state.salary];
      if (salaryCeiling(role) < range[0] || salaryFloor(role) > range[1]) return false;
    }

    if (state.q) {
      var haystack = [
        role.title,
        role.deskName,
        role.location,
        role.pattern,
        role.contract,
        role.ref,
        role.summary,
        role.clientType,
        role.band
      ]
        .join(" ")
        .toLowerCase();
      if (haystack.indexOf(state.q.toLowerCase()) === -1) return false;
    }

    return true;
  }

  function excludedByBand() {
    if (state.salary === "all") return 0;
    return roles.filter(function (role) {
      var openOnly = state.filled || role.stage !== "placed";
      var deskOk = !state.desks.length || state.desks.indexOf(role.desk) > -1;
      var locationOk = state.location === "all" || String(role.location || "").indexOf(state.location) === 0;
      return openOnly && deskOk && locationOk && !hasBand(role);
    }).length;
  }

  function sortRoles(list) {
    var sorted = list.slice();

    sorted.sort(function (a, b) {
      if (state.sort === "recent") return a.daysOpen - b.daysOpen;
      if (state.sort === "oldest") return b.daysOpen - a.daysOpen;

      var aValue = hasBand(a) ? salaryCeiling(a) : null;
      var bValue = hasBand(b) ? salaryCeiling(b) : null;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (state.sort === "band-high") return bValue - aValue;
      return aValue - bValue;
    });

    return sorted;
  }

  function rowMarkup(role) {
    var bandClass = hasBand(role) ? "role-row__band" : "role-row__band role-row__band--none";
    var bandText = hasBand(role) ? role.band : "Band not set yet";

    return (
      '<li class="role-row" id="' + esc(role.ref) + '">' +
      '<div class="role-row__grid">' +
      '<div class="role-row__main">' +
      '<p class="role-row__meta">' +
      '<span class="mono">' + esc(role.ref) + "</span>" +
      '<span class="dot-sep" aria-hidden="true"></span>' +
      "<span>" + esc(role.deskName || role.desk) + "</span>" +
      '<span class="dot-sep" aria-hidden="true"></span>' +
      "<span>" + esc(role.location) + "</span>" +
      "</p>" +
      '<h3 class="role-row__title">' +
      '<a href="#' + esc(role.ref) + '" data-role="' + esc(role.ref) + '">' + esc(role.title) + "</a>" +
      "</h3>" +
      '<p class="role-row__summary">' + esc(role.summary) + "</p>" +
      '<p class="role-row__facts">' +
      "<span>" + esc(role.pattern) + "</span>" +
      '<span class="dot-sep" aria-hidden="true"></span>' +
      "<span>" + esc(role.contract) + "</span>" +
      '<span class="dot-sep" aria-hidden="true"></span>' +
      "<span>" + esc(role.hours) + "</span>" +
      "</p>" +
      "</div>" +
      '<div class="role-row__side">' +
      '<p class="' + bandClass + '">' + esc(bandText) + "</p>" +
      '<p class="role-row__days"><span class="num">' + esc(role.daysOpen) + "</span> days open</p>" +
      '<span class="' + stageClass(role.stage) + '">' + esc(role.stageLabel || role.stage) + "</span>" +
      "</div>" +
      "</div>" +
      "</li>"
    );
  }

  function chipMarkup(key, label, value) {
    return (
      '<li><button class="chip" type="button" data-filter-key="' + key + '" data-filter-value="' + esc(value) + '">' +
      "<span>" + esc(label) + "</span>" +
      '<svg class="chip__x" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>' +
      '<span class="visually-hidden">Remove this filter</span>' +
      "</button></li>"
    );
  }

  function renderActive() {
    if (!els.active) return;

    var chips = [];

    if (state.q) chips.push(chipMarkup("q", 'Search: "' + state.q + '"', state.q));

    state.desks.forEach(function (desk) {
      var match = roles.filter(function (role) {
        return role.desk === desk;
      })[0];
      chips.push(chipMarkup("desk", match ? match.deskName || match.desk : desk, desk));
    });

    if (state.location !== "all") chips.push(chipMarkup("location", state.location, state.location));
    if (state.contract !== "all") chips.push(chipMarkup("contract", state.contract, state.contract));
    if (state.salary !== "all") {
      var option = els.salary.querySelector('option[value="' + state.salary + '"]');
      chips.push(chipMarkup("salary", option ? option.textContent : state.salary, state.salary));
    }
    if (state.filled) chips.push(chipMarkup("filled", "Including filled roles", "true"));

    els.active.innerHTML = chips.join("");
  }

  function render() {
    if (!els.results) return;

    var matched = sortRoles(roles.filter(matches));
    var visible = matched.slice(0, state.limit);

    els.results.innerHTML = visible.map(rowMarkup).join("");

    if (els.count) {
      els.count.textContent =
        matched.length === 0
          ? "No roles match those filters."
          : matched.length +
            (matched.length === 1 ? " role matches" : " roles match") +
            (visible.length < matched.length ? ". Showing the first " + visible.length + "." : ".");
    }

    if (els.excluded) {
      var excluded = excludedByBand();
      els.excluded.hidden = excluded === 0;
      els.excluded.textContent =
        excluded === 1
          ? "1 role is hidden from that band filter because the client has not set a band yet."
          : excluded + " roles are hidden from that band filter because the client has not set a band yet.";
    }

    els.empty.hidden = matched.length !== 0;
    els.moreWrap.hidden = visible.length >= matched.length;

    if (els.moreNote && visible.length < matched.length) {
      els.moreNote.textContent = matched.length - visible.length + " more";
    }

    renderActive();
  }

  function syncStateFromForm() {
    state.q = els.q.value.trim();
    state.sort = els.sort.value;
    state.location = els.location.value;
    state.contract = els.contract.value;
    state.salary = els.salary.value;
    state.filled = els.filled.checked;
    state.desks = els.deskInputs
      .filter(function (input) {
        return input.checked;
      })
      .map(function (input) {
        return input.value;
      });
    state.limit = PAGE;
  }

  function rerender() {
    syncStateFromForm();
    render();
  }

  /* Drawer ----------------------------------------------------------------- */

  var drawer = els.drawer
    ? WF.overlay(els.drawer, {
        backdrop: "#board-backdrop",
        inert: ["#site-header", "#main", ".site-footer"]
      })
    : null;

  function fact(key, value) {
    if (!value) return "";
    return (
      '<div class="fact"><dt class="fact__k">' + key + '</dt><dd class="fact__v">' + esc(value) + "</dd></div>"
    );
  }

  function list(items) {
    return (
      '<ul class="ticklist">' +
      (items || [])
        .map(function (item) {
          return "<li>" + esc(item) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function applyFormMarkup(role) {
    return (
      '<form class="apply-form" id="apply-form" novalidate>' +
      '<div class="form-status" id="apply-status" tabindex="-1" hidden></div>' +
      '<p class="hp" aria-hidden="true"><label for="apply-website">Website</label>' +
      '<input type="text" id="apply-website" name="website" tabindex="-1" autocomplete="off"></p>' +
      '<input type="hidden" name="formStartedAt" value="">' +
      '<h3 class="drawer__subtitle" id="apply">Apply for this role</h3>' +
      '<p class="drawer__note">' + esc(role.consultant) + " reads every application for this desk. Expect a call inside two working days, including if the answer is no.</p>" +
      '<div class="field-row field-row--2">' +
      '<div class="field">' +
      '<label class="field__label" for="apply-name">Name <span class="field__req" aria-hidden="true">*</span></label>' +
      '<input class="input" type="text" id="apply-name" name="name" autocomplete="name" data-validate="required" data-label="Name" data-message-required="We need a name to call you by.">' +
      '<p class="field__error" id="apply-name-error"></p>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="apply-email">Email <span class="field__req" aria-hidden="true">*</span></label>' +
      '<input class="input" type="email" id="apply-email" name="email" autocomplete="email" data-validate="required email" data-label="Email" data-message-required="We need an address to reply to." data-message-type="Check the address, it looks incomplete.">' +
      '<p class="field__error" id="apply-email-error"></p>' +
      "</div>" +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="apply-phone">Phone</label>' +
      '<input class="input" type="tel" id="apply-phone" name="phone" autocomplete="tel" data-validate="tel" data-label="Phone" data-message-type="Use digits, spaces, brackets or a plus sign.">' +
      '<p class="field__error" id="apply-phone-error"></p>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="apply-cv">CV <span class="field__req" aria-hidden="true">*</span></label>' +
      '<label class="drop" id="apply-drop" for="apply-cv">' +
      '<span class="drop__title">Drop a file here, or choose one</span>' +
      '<span class="drop__meta">PDF, Word or ODT, up to 10MB</span>' +
      '<input type="file" id="apply-cv" name="cv" accept=".pdf,.doc,.docx,.odt,.rtf,.txt" data-validate="required" data-label="CV" data-message-required="Attach a CV, or paste a link to your profile in the note below and attach a one-page summary.">' +
      "</label>" +
      '<p class="drop__file" id="apply-file" hidden></p>' +
      '<p class="field__error" id="apply-cv-error"></p>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="apply-note">Anything we should know before we call</label>' +
      '<textarea class="textarea" id="apply-note" name="note" data-validate="min" data-min="20" data-label="Note" data-message-min="Even one line about what would make this role worth leaving for helps us."></textarea>' +
      '<p class="field__hint">Notice period, what you are on now, or what you did not like about the last place. It all helps.</p>' +
      '<p class="field__error" id="apply-note-error"></p>' +
      "</div>" +
      '<label class="check" for="apply-consent">' +
      '<input type="checkbox" id="apply-consent" name="consent" data-validate="required" data-label="Permission to hold your details" data-message-required="We cannot hold your details without this.">' +
      "<span>I am happy for Wrenfield to hold my details and contact me about this role.</span>" +
      "</label>" +
      '<button class="btn btn--primary btn--block" type="submit" id="apply-submit">' +
      '<span class="btn__label">Send my application</span>' +
      "</button>" +
      '<p class="note">We never send your details to a client without asking you first, and you will know the client name before we do. <a href="about.html#compliance">How we handle data</a>.</p>' +
      "</form>"
    );
  }

  function drawerMarkup(role) {
    var bandRow = hasBand(role)
      ? fact("Band", role.band + (role.salaryNote ? ". " + role.salaryNote : ""))
      : fact("Band", "Not set yet");

    return (
      '<section class="drawer__section">' +
      "<p>" + esc(role.summary) + "</p>" +
      '<dl class="fact-list">' +
      fact("Location", role.location + ". " + (role.pattern || "")) +
      fact("Contract", (role.contract || "") + ", " + (role.hours || "")) +
      bandRow +
      fact("Desk", (role.deskName || role.desk) + ", " + (role.consultant || "")) +
      fact("Client", role.clientType) +
      fact("Days open", role.daysOpen + " days") +
      "</dl>" +
      "</section>" +
      '<section class="drawer__section">' +
      "<h3 class=\"drawer__subtitle\">Where this one is</h3>" +
      '<p class="drawer__status">' + esc(role.status) + "</p>" +
      '<dl class="fact-list">' +
      fact("Longlist by", role.slaLonglist) +
      fact("Shortlist by", role.slaShortlist) +
      "</dl>" +
      "</section>" +
      '<section class="drawer__section">' +
      "<h3 class=\"drawer__subtitle\">What the job involves</h3>" +
      list(role.responsibilities) +
      "</section>" +
      '<section class="drawer__section">' +
      "<h3 class=\"drawer__subtitle\">What they are asking for</h3>" +
      list(role.requirements) +
      '<p class="note">If you match most of this and not all of it, apply anyway. Clients write the list they think they want, and we are the ones who tell them what they actually need.</p>' +
      "</section>" +
      '<section class="drawer__section">' +
      applyFormMarkup(role) +
      "</section>"
    );
  }

  function markFieldInvalid(id, message) {
    var input = doc.getElementById(id);
    if (!input) return null;
    var wrapper = input.closest(".field");
    if (!wrapper) return null;
    wrapper.setAttribute("data-invalid", "true");
    input.setAttribute("aria-invalid", "true");
    var errorNode = wrapper.querySelector(".field__error");
    if (errorNode) errorNode.textContent = message;
    return {
      input: input,
      label: input.getAttribute("data-label") || id,
      message: message
    };
  }

  function wireApplyForm(role) {
    var form = doc.getElementById("apply-form");
    if (!form) return;

    var status = doc.getElementById("apply-status");
    var drop = doc.getElementById("apply-drop");
    var fileInput = doc.getElementById("apply-cv");
    var fileNote = doc.getElementById("apply-file");
    var submit = doc.getElementById("apply-submit");
    var honeypot = doc.getElementById("apply-website");
    var started = form.querySelector("[name='formStartedAt']");

    if (started) started.value = String(Date.now());

    function resetSubmit() {
      if (!submit) return;
      submit.removeAttribute("data-loading");
      submit.removeAttribute("aria-busy");
      submit.disabled = false;
    }

    if (drop && fileInput) {
      var showFile = function (file) {
        if (!file || !fileNote) return;
        var size = file.size / 1048576;
        fileNote.textContent = file.name + " · " + (size < 0.1 ? "under 0.1" : size.toFixed(1)) + "MB";
        fileNote.hidden = false;
      };

      fileInput.addEventListener("change", function () {
        showFile(fileInput.files[0]);
      });

      ["dragenter", "dragover"].forEach(function (name) {
        drop.addEventListener(name, function (event) {
          event.preventDefault();
          drop.setAttribute("data-drag", "true");
        });
      });

      ["dragleave", "drop"].forEach(function (name) {
        drop.addEventListener(name, function (event) {
          event.preventDefault();
          drop.removeAttribute("data-drag");
        });
      });

      drop.addEventListener("drop", function (event) {
        var files = event.dataTransfer && event.dataTransfer.files;
        if (!files || !files.length) return;
        try {
          fileInput.files = files;
        } catch (error) {
          /* some browsers refuse, the picker still works */
        }
        showFile(files[0]);
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      WF.clearValidation(form);

      var errors = WF.validate(form);
      if (errors.length) {
        WF.errorSummary(form, errors, status);
        return;
      }

      if (honeypot) honeypot.value = "";

      submit.setAttribute("data-loading", "true");
      submit.setAttribute("aria-busy", "true");
      submit.disabled = true;

      var data = new FormData(form);
      data.set("roleRef", role.ref);
      data.set("roleTitle", role.title);

      fetch("/api/applications", { method: "POST", body: data })
        .then(function (response) {
          return response.json().then(function (body) {
            return { status: response.status, body: body };
          });
        })
        .then(function (result) {
          if (result.body && result.body.fields && result.body.fields.length) {
            var listed = result.body.fields
              .map(function (item) {
                return markFieldInvalid(item.field, item.message);
              })
              .filter(Boolean);
            WF.errorSummary(form, listed, status);
            resetSubmit();
            return;
          }

          if (!result.body || result.body.ok !== true) {
            WF.setStatus(
              status,
              "error",
              "That did not go through",
              (result.body && result.body.error) || "Something went wrong on our side. Try again in a moment."
            );
            resetSubmit();
            return;
          }

          WF.setStatus(
            status,
            "success",
            "Application sent for " + role.ref,
            esc(role.consultant) +
              " reads every application for this desk, and you will get a reply inside two working days, including if the answer is no."
          );

          Array.prototype.forEach.call(
            form.querySelectorAll(".input, .textarea, .select, input[type='checkbox'], button"),
            function (node) {
              node.disabled = true;
            }
          );
          resetSubmit();
          if (status) status.focus();
        })
        .catch(function () {
          resetSubmit();
          WF.setStatus(
            status,
            "error",
            "We could not reach our server",
            "Nothing was lost, but it was not sent either. Call 0161 555 0142 or email " +
              '<a href="mailto:hello@wrenfield.co.uk">hello@wrenfield.co.uk</a> and we will pick it up straight away.'
          );
        });
    });
  }

  function openRole(ref, trigger) {
    var role = roles.filter(function (item) {
      return item.ref === ref;
    })[0];
    if (!role || !drawer) return;

    els.drawerEyebrow.innerHTML =
      '<span class="mono">' + esc(role.ref) + "</span>" +
      '<span class="dot-sep" aria-hidden="true"></span>' +
      "<span>" + esc(role.deskName || role.desk) + "</span>" +
      '<span class="' + stageClass(role.stage) + '">' + esc(role.stageLabel || role.stage) + "</span>";

    els.drawerTitle.textContent = role.title;
    els.drawerBody.innerHTML = drawerMarkup(role);
    els.drawerFoot.textContent = role.location + " · " + (hasBand(role) ? role.band : "band not set");

    drawer.open(trigger);
    wireApplyForm(role);
  }

  /* Wiring ----------------------------------------------------------------- */

  function wireBoard() {
    if (els.form) {
      els.form.addEventListener("submit", function (event) {
        event.preventDefault();
      });
      els.form.addEventListener("change", rerender);
      els.form.addEventListener("input", WF.debounce(rerender, 160));
      els.form.addEventListener("reset", function () {
        window.setTimeout(rerender, 0);
      });
    }

    if (els.more) {
      els.more.addEventListener("click", function () {
        state.limit += PAGE;
        render();
      });
    }

    var clearAll = function () {
      if (els.form) els.form.reset();
      rerender();
      if (els.q) els.q.focus();
    };

    if (els.clear) els.clear.addEventListener("click", clearAll);
    if (els.emptyClear) els.emptyClear.addEventListener("click", clearAll);

    if (els.retry) {
      els.retry.addEventListener("click", function () {
        els.error.hidden = true;
        els.loading.hidden = false;
        loadFromApi().then(function (ok) {
          els.loading.hidden = true;
          if (ok) {
            els.error.hidden = true;
            render();
          } else {
            els.error.hidden = false;
          }
        });
      });
    }

    if (els.results) {
      els.results.addEventListener("click", function (event) {
        var row = event.target.closest(".role-row");
        if (!row) return;
        event.preventDefault();
        openRole(row.id, row.querySelector("[data-role]") || row);
      });
    }

    if (els.active) {
      els.active.addEventListener("click", function (event) {
        var button = event.target.closest("[data-filter-key]");
        if (!button) return;

        var key = button.getAttribute("data-filter-key");
        var value = button.getAttribute("data-filter-value");

        if (key === "q") els.q.value = "";
        if (key === "location") els.location.value = "all";
        if (key === "contract") els.contract.value = "all";
        if (key === "salary") els.salary.value = "all";
        if (key === "filled") els.filled.checked = false;
        if (key === "desk") {
          els.deskInputs.forEach(function (input) {
            if (input.value === value) input.checked = false;
          });
        }

        rerender();
        var focusTarget =
          key === "q" ? els.q : key === "desk" ? doc.getElementById("desk-" + value) : els[key];
        if (focusTarget) focusTarget.focus();
      });
    }

    if (els.applyLink) {
      els.applyLink.addEventListener("click", function (event) {
        event.preventDefault();
        var heading = doc.getElementById("apply");
        if (heading) {
          heading.scrollIntoView({
            block: "start",
            behavior: WF.motionValue() === "none" ? "auto" : "smooth"
          });
        }
        var first = doc.getElementById("apply-name");
        if (first) {
          window.setTimeout(function () {
            first.focus({ preventScroll: true });
          }, 260);
        }
      });
    }

    /* Role alert ------------------------------------------------------------ */

    if (els.alertForm) {
      var alertStarted = els.alertForm.querySelector("[name='formStartedAt']");
      if (alertStarted) alertStarted.value = String(Date.now());

      els.alertForm.addEventListener("submit", function (event) {
        event.preventDefault();
        WF.clearValidation(els.alertForm);

        var errors = WF.validate(els.alertForm);
        if (errors.length) {
          WF.errorSummary(els.alertForm, errors, els.alertStatus);
          return;
        }

        var submit = doc.getElementById("alert-submit");
        submit.setAttribute("data-loading", "true");
        submit.setAttribute("aria-busy", "true");
        submit.disabled = true;

        var data = {};
        Array.prototype.forEach.call(els.alertForm.elements, function (field) {
          if (!field.name) return;
          data[field.name] = field.type === "checkbox" ? (field.checked ? "on" : "") : field.value;
        });
        data.roleInterest = data.desk;

        fetch("/api/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data)
        })
          .then(function (response) {
            return response.json().then(function (body) {
              return { status: response.status, body: body };
            });
          })
          .then(function (result) {
            if (result.body && result.body.fields && result.body.fields.length) {
              var listed = result.body.fields
                .map(function (item) {
                  var input = doc.getElementById(item.field);
                  var wrapper = input && input.closest(".field");
                  if (wrapper) {
                    wrapper.setAttribute("data-invalid", "true");
                    var node = wrapper.querySelector(".field__error");
                    if (node) node.textContent = item.message;
                  }
                  return {
                    input: input || els.alertForm,
                    label: (input && input.getAttribute("data-label")) || item.field,
                    message: item.message
                  };
                })
                .filter(Boolean);
              WF.errorSummary(els.alertForm, listed, els.alertStatus);
            } else if (!result.body || result.body.ok !== true) {
              WF.setStatus(
                els.alertStatus,
                "error",
                "That did not go through",
                (result.body && result.body.error) || "Something went wrong on our side."
              );
            } else {
              WF.setStatus(
                els.alertStatus,
                "success",
                "Alert saved",
                "You will hear from us when something on the board matches. One email, and you can stop it in a click."
              );
              els.alertStatus.focus();
            }

            submit.removeAttribute("data-loading");
            submit.removeAttribute("aria-busy");
            submit.disabled = false;
          })
          .catch(function () {
            submit.removeAttribute("data-loading");
            submit.removeAttribute("aria-busy");
            submit.disabled = false;
            WF.setStatus(
              els.alertStatus,
              "error",
              "We could not reach our server",
              "Call 0161 555 0142 or email <a href=\"mailto:hello@wrenfield.co.uk\">hello@wrenfield.co.uk</a> and we will set the alert from here."
            );
          });
      });
    }

    render();
    fromHash();
    window.addEventListener("hashchange", fromHash);
  }

  /* Data ------------------------------------------------------------------- */

  function loadFromApi() {
    return fetch("/api/roles", { headers: { accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) return false;
        return response.json().then(function (body) {
          if (!body || body.ok !== true || !Array.isArray(body.roles) || !body.roles.length) {
            return false;
          }
          roles = body.roles;
          return true;
        });
      })
      .catch(function () {
        return false;
      });
  }

  if (!els.loading && !els.results) return;

  /* The bundled ledger renders straight away so the board is never empty on a
     slow connection, then the API replaces it with whatever is live. */
  if (roles.length) {
    if (els.loading) els.loading.hidden = true;
    if (els.error) els.error.hidden = true;
    wireBoard();
    loadFromApi().then(function (ok) {
      if (ok) render();
    });
    return;
  }

  loadFromApi().then(function (ok) {
    if (els.loading) els.loading.hidden = true;

    if (!ok) {
      if (els.error) els.error.hidden = false;
      if (els.status) els.status.hidden = true;
      return;
    }

    if (els.error) els.error.hidden = true;
    wireBoard();
  });

  /* Deep links: #WF-2416 opens the role, #desk-eng applies the desk filter. */

  function fromHash() {
    var hash = window.location.hash.replace("#", "");
    if (!hash) return;

    if (/^WF-\d+$/.test(hash)) {
      var role = roles.filter(function (item) {
        return item.ref === hash;
      })[0];
      if (!role) return;

      if (role.stage === "placed") {
        state.filled = true;
        if (els.filled) els.filled.checked = true;
      }

      state.limit = roles.length;
      render();

      var row = doc.getElementById(hash);
      if (row && WF.motionValue() !== "none") {
        row.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      openRole(hash, row ? row.querySelector("[data-role]") : null);
      return;
    }

    var deskMatch = hash.match(/^desk-(eng|cln|ind|fin)$/);
    if (deskMatch) {
      var input = doc.getElementById("desk-" + deskMatch[1]);
      if (input) {
        input.checked = true;
        rerender();
      }
    }
  }
})(window.WF, document);
