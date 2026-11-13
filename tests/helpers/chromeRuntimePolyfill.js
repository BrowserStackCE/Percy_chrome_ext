// chrome.runtime / chrome.storage polyfill for loading the extension pages from
// the Vite dev server (npm run dev in percy-local-manager-extension, port 5173)
// without --load-extension. Inject it with page.addInitScript before navigating.
//
// chrome.runtime.getURL() resolves to the dev server URL, and chrome.storage is
// an in-memory store that supports both callback and promise styles (the
// extension uses `await chrome.storage.local.get(...)`).

const EXTENSION_DEV_URL = process.env.EXTENSION_DEV_URL || 'http://localhost:5173';

const CHROME_RUNTIME_POLYFILL = `
  (function() {
    var BASE = '${EXTENSION_DEV_URL}';
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.getURL = function(p) {
      return BASE + '/' + p.replace(/^\\//, '');
    };
    window.chrome.tabs = window.chrome.tabs || { create: function() {} };
    function makeArea() {
      var data = {};
      return {
        get: function(k, cb) {
          var out = {};
          var keys = k == null ? Object.keys(data)
                   : Array.isArray(k) ? k
                   : typeof k === 'string' ? [k] : Object.keys(k);
          keys.forEach(function(key) { if (key in data) out[key] = data[key]; });
          if (cb) { cb(out); return; }
          return Promise.resolve(out);
        },
        set: function(items, cb) {
          Object.assign(data, items);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: function(k, cb) {
          [].concat(k).forEach(function(key) { delete data[key]; });
          if (cb) cb();
          return Promise.resolve();
        },
      };
    }
    window.chrome.storage = window.chrome.storage || {
      local: makeArea(),
      sync: makeArea(),
      onChanged: { addListener: function() {}, removeListener: function() {} },
    };
  })();
`;

module.exports = { EXTENSION_DEV_URL, CHROME_RUNTIME_POLYFILL };
