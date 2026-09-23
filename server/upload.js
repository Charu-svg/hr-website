"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Busboy = require("busboy");
const config = require("./config");

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt"];

const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
  "text/rtf",
  "text/plain",
  "application/octet-stream"
];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/* Parse a multipart form and store one CV. Files land under a random name in
   the upload directory, which is never served statically. */
function parseApplicationForm(req) {
  return new Promise(function (resolve, reject) {
    let busboy;

    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          fileSize: config.limits.upload,
          files: 1,
          fields: 30,
          fieldSize: config.limits.field,
          parts: 40
        }
      });
    } catch (error) {
      reject(httpError(400, "Send this as a multipart form."));
      return;
    }

    const fields = {};
    let file = null;
    let fileWrite = Promise.resolve();
    let rejected = null;

    busboy.on("field", function (name, value) {
      fields[name] = String(value).slice(0, config.limits.field);
    });

    busboy.on("file", function (name, stream, info) {
      const original = path.basename(info.filename || "cv");
      const extension = path.extname(original).toLowerCase();

      if (!info.filename) {
        stream.resume();
        return;
      }

      if (ALLOWED_EXTENSIONS.indexOf(extension) === -1) {
        rejected = "That file type is not one we can open. Send a PDF, Word or ODT file.";
        stream.resume();
        return;
      }

      if (info.mimeType && ALLOWED_TYPES.indexOf(info.mimeType) === -1) {
        rejected = "That file type is not one we can open. Send a PDF, Word or ODT file.";
        stream.resume();
        return;
      }

      const stored = crypto.randomBytes(16).toString("hex") + extension;
      const target = path.join(config.uploadDir, stored);
      const write = fs.createWriteStream(target, { mode: 0o600 });
      let size = 0;
      let tooLarge = false;

      stream.on("data", function (chunk) {
        size += chunk.length;
      });

      stream.on("limit", function () {
        tooLarge = true;
      });

      stream.pipe(write);

      fileWrite = new Promise(function (done, fail) {
        write.on("finish", function () {
          if (tooLarge) {
            fs.unlink(target, function () {
              rejected = "That file is larger than 10MB. Send a smaller version.";
              done();
            });
            return;
          }
          file = {
            stored: stored,
            path: target,
            name: original,
            size: size
          };
          done();
        });
        write.on("error", fail);
      });
    });

    busboy.on("error", function () {
      reject(httpError(400, "That upload did not come through cleanly. Try again."));
    });

    busboy.on("close", function () {
      fileWrite
        .then(function () {
          if (rejected) {
            reject(httpError(400, rejected));
            return;
          }
          resolve({ fields: fields, file: file });
        })
        .catch(function () {
          reject(httpError(500, "We could not store that file."));
        });
    });

    req.pipe(busboy);
  });
}

module.exports = {
  parseApplicationForm: parseApplicationForm,
  ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS
};
