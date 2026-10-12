'use strict';
/**
 * JernihHD — Logger minimal (timestamp + level)
 */

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function out(level, color, args) {
  const msg = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  // eslint-disable-next-line no-console
  console.log(`${ts()} ${color}[${level}]${'\x1b[0m'} ${msg}`);
}

const log = {
  info: (...a) => out('INFO', '\x1b[32m', a),
  warn: (...a) => out('WARN', '\x1b[33m', a),
  error: (...a) => out('ERROR', '\x1b[31m', a),
  debug: (...a) => out('DEBUG', '\x1b[36m', a),
};

module.exports = { log };
