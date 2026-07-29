"use strict";

/** Shared graph constants — see spec/agent.md "Tools & Tool Calling" / retry budget. */
const MAX_CODE_RETRIES = 2; // i.e. up to 3 total generate_code attempts per run

module.exports = { MAX_CODE_RETRIES };
