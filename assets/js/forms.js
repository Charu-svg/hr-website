/* Forms: the employer brief, the newsletter panel, and the footer signup.
   They post to the API when it is there, and say so plainly when it is not. */

(function (WF, doc) {
  "use strict";

  var FALLBACK_CONTACT =
    "We could not reach our server just then. Nothing was lost: call 0161 555 0142 or email " +
    "<a href=\"mailto:hello@wrenfield.co.uk\">hello@wrenfield.co.uk</a> and we will pick it up straight away.";

  function setFieldError(input, message) {
    if (!input) return;
    var wrapper = input.closest(".field");
    if (!wrapper) return;
    var errorNode = wrapper.querySelector(".field__error");

    if (!message) {
      wrapper.removeAttribute("data-invalid");
      input.removeAttribute("aria-invalid");
      return;
    }

    wrapper.setAttribute("data-invalid", "true");
    input.setAttribute("aria-invalid", "true");
    if (errorNode) errorNode.textContent = message;
  }

  function lock(form) {
    Array.prototype.forEach.call(
      form.querySelectorAll(".input, .select, .textarea, input[type='checkbox'], button"),
      function (node) {
        node.disabled = true;
      }
    );
  }

  function markStart(form) {
    var field = form.querySelector("[name='formStartedAt']");
    if (field) field.value = String(Date.now());
  }

  function payloadOf(form) {
    var data = {};

    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name) return;
      if (field.type === "checkbox") {
        if (field.checked) data[field.name] = "on";
        return;
      }
      if (field.type === "file") return;
      data[field.name] = field.value;
    });

    return data;
  }

  function applyFieldErrors(form, fields) {
    var summary = [];

    fields.forEach(function (item) {
      var input = doc.getElementById(item.field);
      if (input) setFieldError(input, item.message);
      summary.push({
        input: input || form,
        label: (input && input.getAttribute("data-label")) || item.field,
        message: item.message
      });
    });

    return summary;
  }

  function submitJson(form, endpoint, options) {
    var status = doc.getElementById(options.status);
    var submit = doc.getElementById(options.submit);
    var started = Date.now();

    if (submit) {
      submit.setAttribute("data-loading", "true");
      submit.setAttribute("aria-busy", "true");
      submit.disabled = true;
    }

    return fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadOf(form))
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { status: response.status, body: body };
        });
      })
      .then(function (result) {
        var settle = Math.max(0, 600 - (Date.now() - started));

        window.setTimeout(function () {
          if (submit) {
            submit.removeAttribute("data-loading");
            submit.removeAttribute("aria-busy");
            submit.disabled = false;
          }

          if (result.body && result.body.fields && result.body.fields.length) {
            WF.errorSummary(form, applyFieldErrors(form, result.body.fields), status);
            return;
          }

          if (!result.body || result.body.ok !== true) {
            WF.setStatus(
              status,
              "error",
              "That did not go through",
              (result.body && result.body.error) ||
                "Something went wrong on our side. Try again in a moment."
            );
            return;
          }

          WF.setStatus(status, "success", options.title(form), options.body(form));
          lock(form);
          if (status) status.focus();
        }, settle);
      })
      .catch(function () {
        if (submit) {
          submit.removeAttribute("data-loading");
          submit.removeAttribute("aria-busy");
          submit.disabled = false;
        }
        WF.setStatus(status, "error", "We could not reach our server", FALLBACK_CONTACT);
      });
  }

  function handle(form, options) {
    if (!form) return;

    var status = doc.getElementById(options.status);
    var honeypot = form.querySelector("[name='website']");

    markStart(form);

    form.addEventListener("focusin", function () {
      if (honeypot && honeypot.value) honeypot.value = "";
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      WF.clearValidation(form);

      var errors = WF.validate(form);

      if (options.extraCheck) {
        var extra = options.extraCheck(form, errors);
        if (extra) {
          setFieldError(extra.input, extra.message);
          errors.push(extra);
        }
      }

      if (errors.length) {
        WF.errorSummary(form, errors, status);
        return;
      }

      if (honeypot && honeypot.value) {
        WF.setStatus(status, "success", options.title(form), options.body(form));
        return;
      }

      submitJson(form, options.endpoint, options);
    });
  }

  /* Employer brief ---------------------------------------------------------- */

  handle(doc.getElementById("brief-form"), {
    endpoint: "/api/briefs",
    status: "brief-status",
    submit: "brief-submit",
    title: function () {
      var desk = doc.getElementById("brief-desk");
      var name = desk && desk.options[desk.selectedIndex] ? desk.options[desk.selectedIndex].text : "desk";
      return "Brief sent to the " + name;
    },
    body: function () {
      var min = doc.getElementById("brief-band-min");
      var max = doc.getElementById("brief-band-max");
      var band = "£" + Number(min.value).toLocaleString("en-GB") + " to £" + Number(max.value).toLocaleString("en-GB");
      return (
        "You will have a reply inside one working day, starting with the band check on " +
        band +
        ". If the number is wrong we will say so in writing before you owe us anything."
      );
    },
    extraCheck: function (form, errors) {
      var min = doc.getElementById("brief-band-min");
      var max = doc.getElementById("brief-band-max");
      if (!min || !max) return null;

      var maxAlreadyInvalid = errors.some(function (error) {
        return error.input === max;
      });
      if (maxAlreadyInvalid || !min.value || !max.value) return null;
      if (Number(max.value) >= Number(min.value)) return null;

      return {
        input: max,
        label: "Band, to",
        message: "The top of the band sits below the bottom. Swap them, or widen the range."
      };
    }
  });

  /* Newsletter panel -------------------------------------------------------- */

  handle(doc.getElementById("subscribe-form"), {
    endpoint: "/api/subscribe",
    status: "subscribe-status",
    submit: "subscribe-submit",
    title: function () {
      return "You are on the list";
    },
    body: function () {
      return "One note a month from the desks, starting with the next one. Unsubscribe takes one click.";
    }
  });

  /* Footer signup ----------------------------------------------------------- */

  handle(doc.getElementById("footer-newsletter"), {
    endpoint: "/api/subscribe",
    status: "footer-status",
    submit: "footer-submit",
    title: function () {
      return "Signed up";
    },
    body: function () {
      return "You will get the next monthly note from the desks.";
    }
  });
})(window.WF, document);
