/** @module regex */
"use strict";

/**
 * A regular expression that is for checking for ISO formatted date strings.
 * @type {RegExp}
 */
exports.ISOTime = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2]\d|3[0-1])T([0-1]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

/**
 * A regular expression that is for checking for correctly formatted email strings this will not
 * pass if there are any characters before or after the email. see looseEMail for that behavior
 *
 * @type {RegExp}
 */
exports.email   = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+$/;

/**
 * A regular expression that is for checking for correctly formatted sha256 hashes
 * @type {RegExp}
 */
exports.sha256  = /^[a-zA-Z0-9]{64}$/;

/**
 * A regular expression that is for checking for correctly formatted names
 * @type {RegExp}
 */
exports.name    = /^[a-zA-Z]{2,}$/;

/**
 * A regular expression that is for checking for emails that also accepts characters after the
 * email and before
 *
 * @type {RegExp}
 */
exports.looseEmail = /[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+/;

/**
 * A regular expression that is for checking for emails that will also select an empty string
 * @type {RegExp}
 */
exports.optionalEmail = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+$|^$/;
