/**
 * Stub for `react-dom` on React Native.
 * Gluestack → react-aria pulls animation helpers that `require('react-dom')` for `flushSync`.
 * Metro cannot resolve the real package here; running the callback synchronously matches this usage.
 *
 * @format
 */

'use strict';

function flushSync(fn) {
  return fn();
}

function createPortal(children) {
  return children;
}

module.exports = {
  createPortal,
  flushSync,
  version: 'stub',
};
