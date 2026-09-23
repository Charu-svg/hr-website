"use strict";

const config = require("./config");

let transporter = null;
let transporterChecked = false;

function getTransporter() {
  if (transporterChecked) return transporter;
  transporterChecked = true;

  if (!config.mailEnabled) return null;

  try {
    const nodemailer = require("nodemailer");
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined
    });
  } catch (error) {
    console.warn(
      "[notify] SMTP is configured but nodemailer is not installed. Run: npm install nodemailer"
    );
    transporter = null;
  }

  return transporter;
}

async function postWebhook(payload) {
  if (!config.notifyWebhook) return false;

  try {
    const response = await fetch(config.notifyWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    return response.ok;
  } catch (error) {
    console.warn("[notify] webhook failed:", error.message);
    return false;
  }
}

async function sendMail(payload) {
  const mailer = getTransporter();
  if (!mailer) return false;

  try {
    await mailer.sendMail({
      from: config.mail.from,
      to: config.mail.to.join(", "),
      subject: payload.subject,
      text: payload.text
    });
    return true;
  } catch (error) {
    console.warn("[notify] email failed:", error.message);
    return false;
  }
}

/* Notifications are best effort. The submission is already saved by the time
   this runs, so a failure here must never fail the request. */
async function notify(payload) {
  const webhook = await postWebhook(payload);
  const mail = await sendMail(payload);

  if (!webhook && !mail) {
    console.log("[notify] " + payload.subject);
  }

  return { webhook: webhook, mail: mail };
}

module.exports = { notify: notify };
