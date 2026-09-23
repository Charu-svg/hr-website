/* The brief form on the employers page. */

(function (WF, doc) {
  "use strict";

  var form = doc.getElementById("brief-form");
  if (!form) return;

  var status = doc.getElementById("brief-status");
  var submit = doc.getElementById("brief-submit");

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

  function lockForm() {
    Array.prototype.forEach.call(
      form.querySelectorAll(".input, .select, .textarea, input[type='checkbox'], button"),
      function (node) {
        node.disabled = true;
      }
    );
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    WF.clearValidation(form);

    var errors = WF.validate(form);

    var min = doc.getElementById("brief-band-min");
    var max = doc.getElementById("brief-band-max");
    var maxAlreadyInvalid = errors.some(function (error) {
      return error.input === max;
    });

    if (!maxAlreadyInvalid && min.value && max.value && Number(max.value) < Number(min.value)) {
      var message = "The top of the band sits below the bottom. Swap them, or widen the range.";
      setFieldError(max, message);
      errors.push({ input: max, message: message, label: "Band, to" });
    }

    if (errors.length) {
      WF.errorSummary(form, errors, status);
      return;
    }

    submit.setAttribute("data-loading", "true");
    submit.setAttribute("aria-busy", "true");
    submit.disabled = true;

    var desk = doc.getElementById("brief-desk");
    var deskName = desk.options[desk.selectedIndex].text;
    var band = "£" + Number(min.value).toLocaleString("en-GB") + " to £" + Number(max.value).toLocaleString("en-GB");

    window.setTimeout(function () {
      WF.setStatus(
        status,
        "success",
        "Brief noted for the " + deskName + " desk",
        "In a live build this would reach the desk now and you would have a reply inside one working day, " +
          "starting with the band check on " +
          band +
          ". Nothing was sent from this demo build, and no data left your browser."
      );
      lockForm();
      submit.removeAttribute("data-loading");
      submit.removeAttribute("aria-busy");
      status.focus();
    }, 900);
  });
})(window.WF, document);
