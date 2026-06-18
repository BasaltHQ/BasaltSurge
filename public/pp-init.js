// PortalPay Static Initialization & Polyfills (pp-init.js)
// Loaded via strategy="beforeInteractive" to execute as early as possible.

(function() {
  var doc = document.documentElement;
  var isDebug = doc.getAttribute('data-pp-debug') === 'true';
  var env = doc.getAttribute('data-pp-env') || 'production';

  // 1. Error.cause Polyfill
  try {
    if (typeof Error !== 'undefined') {
      var errorTypes = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError];
      if (typeof AggregateError !== 'undefined') errorTypes.push(AggregateError);
      if (typeof DOMException !== 'undefined') errorTypes.push(DOMException);
      
      var errorProtos = [];
      for (var i = 0; i < errorTypes.length; i++) {
        if (errorTypes[i] && errorTypes[i].prototype) {
          errorProtos.push(errorTypes[i].prototype);
        }
      }

      var isErrorProto = function(obj) {
        for (var j = 0; j < errorProtos.length; j++) {
          if (obj === errorProtos[j]) return true;
        }
        return false;
      };

      var origDefine = Object.defineProperty;
      Object.defineProperty = function(obj, prop, desc) {
        if (prop === 'cause' && isErrorProto(obj)) {
          return obj;
        }
        return origDefine.apply(this, arguments);
      };

      var origDefineProps = Object.defineProperties;
      Object.defineProperties = function(obj, props) {
        if (props && 'cause' in props && isErrorProto(obj)) {
          var newProps = {};
          for (var k in props) {
            if (Object.prototype.hasOwnProperty.call(props, k) && k !== 'cause') {
              newProps[k] = props[k];
            }
          }
          return origDefineProps.call(this, obj, newProps);
        }
        return origDefineProps.apply(this, arguments);
      };

      for (var i = 0; i < errorProtos.length; i++) {
        var proto = errorProtos[i];
        try {
          if ('cause' in proto) {
            delete proto.cause;
          }
        } catch(e) {}
        try {
          origDefine(proto, 'cause', {
            configurable: true,
            get: function() {
              return this;
            },
            set: function(val) {
              if (isErrorProto(this)) return;
              try {
                origDefine(this, 'cause', {
                  configurable: true,
                  enumerable: true,
                  writable: true,
                  value: val
                });
              } catch(e) {}
            }
          });
        } catch(e) {}
      }
    }
  } catch(e) {}

  // 2. Silence Console (when not in debug mode)
  if (!isDebug) {
    try {
      var _l = console.log.bind(console);
      console.log = function() {};
      console._log = _l;
    } catch(e) {}
  }

  // 3. Preset CSS Theme Variables
  try {
    var dp = doc.getAttribute('data-pp-brand-primary') || '#1f2937';
    var da = doc.getAttribute('data-pp-brand-accent') || '#F54029';
    var dh = doc.getAttribute('data-pp-brand-header') || '#ffffff';
    var db = doc.getAttribute('data-pp-brand-body') || '#e5e7eb';
    doc.style.setProperty('--pp-primary', dp);
    doc.style.setProperty('--pp-secondary', da);
    doc.style.setProperty('--pp-text', dh);
    doc.style.setProperty('--pp-text-header', dh);
    doc.style.setProperty('--pp-text-body', db);
    doc.style.setProperty('--primary', dp);
    doc.style.setProperty('--primary-foreground', dh);
  } catch(e) {}

  // 4. Pre-lock Theme & Routing setup
  try {
    var url = new URL(window.location.href);
    var path = url.pathname || "";
    // Strip any shop-related query hints when on /terminal to prevent unintended shop navigation
    try {
      if (path.indexOf("/terminal") === 0 || path.indexOf("/pricing") === 0) {
        var changed = false;
        if (url.searchParams.has("slug")) { url.searchParams.delete("slug"); changed = true; }
        if (url.searchParams.has("shop")) { url.searchParams.delete("shop"); changed = true; }
        if (changed) { window.history.replaceState({}, "", url.toString()); }
      }
    } catch(e) {}
    var forcePortal = url.searchParams.get("forcePortalTheme") === "1";
    var r = String(url.searchParams.get("recipient")||"").trim();
    var w = String(url.searchParams.get("wallet")||"").trim();
    var hasRecipient = /^0x[a-fA-F0-9]{40}$/i.test(r) || /^0x[a-fA-F0-9]{40}$/i.test(w);
    var lock = doc.getAttribute("data-pp-theme-lock") || "user";
    if (path.startsWith("/portal")) { lock = forcePortal ? "portalpay-default" : (hasRecipient ? "merchant" : lock); }
    else if (path.startsWith("/shop")) { lock = "merchant"; }
    else if (path.startsWith("/terminal")) { lock = "user"; }
    else if (path.startsWith("/pricing")) { lock = hasRecipient ? "merchant" : "user"; }
    else if (path.startsWith("/developers") || path.startsWith("/docs")) {
      var ct = doc.getAttribute("data-pp-container-type") || "platform";
      if (path.startsWith("/developers/dashboard") || path.startsWith("/developers/products")) {
        lock = ct === "platform" ? "portalpay-default" : lock;
      } else {
        lock = "portalpay-default";
      }
    }
    doc.setAttribute("data-pp-theme-lock", lock);
    // mark merchant expected state for readiness gate
    var isPricing = path.startsWith("/pricing");
    doc.setAttribute("data-pp-theme-merchant-expected", (lock === "merchant" || isPricing) ? "1" : "0");
    // annotate current route for downstream CSS/JS guards
    doc.setAttribute("data-pp-route", path.startsWith("/portal") ? "portal" : (path.startsWith("/shop") ? "shop" : ((path.startsWith("/terminal") || path.startsWith("/pricing")) ? "terminal" : "other")));
    // hide global background gradient on portal pages to avoid duplicate decorative layers
    try { if (path.startsWith("/portal")) { var gg = document.querySelector(".global-gradient-layer"); if (gg) gg.setAttribute("hidden", ""); } } catch(e) {}
    if (lock === "portalpay-default" || path === "/") {
      doc.setAttribute("data-pp-theme-stage", "init");
      doc.setAttribute("data-pp-theme-ready", "1");
    }
    // Device routes: mark ready immediately – merchant branding is applied
    if (path.indexOf("/touchpoint") === 0 || path.indexOf("/terminal") === 0 || path.indexOf("/handheld") === 0 || path.indexOf("/kiosk") === 0 || path.indexOf("/kitchen") === 0 || path.indexOf("/legacy") === 0) {
      doc.setAttribute("data-pp-theme-stage", "init");
      doc.setAttribute("data-pp-theme-ready", "1");
    }
  } catch(e) {}

  // 5. iOS WebView Polyfill
  try {
    if (typeof window !== "undefined" && !window.webkit) {
      window.webkit = { messageHandlers: {} };
    }
  } catch(e) {}

  // 6. Suppress Ethereum redefine errors
  try {
    window.addEventListener('error', function (e) {
      try {
        var msg = (e && e.message) ? String(e.message) : '';
        if (msg.indexOf('Cannot redefine property: ethereum') !== -1) {
          e.stopImmediatePropagation && e.stopImmediatePropagation();
          e.preventDefault && e.preventDefault();
          return false;
        }
      } catch {}
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      try {
        var reason = e && (e.reason || e.detail);
        var msg = reason && (reason.message || (reason.toString && reason.toString())) || '';
        if (String(msg).indexOf('Cannot redefine property: ethereum') !== -1) {
          e.stopImmediatePropagation && e.stopImmediatePropagation();
          e.preventDefault && e.preventDefault();
          return false;
        }
      } catch {}
    }, true);
  } catch {}

  // 7. Suppress general extension/Link errors
  try {
    window.addEventListener('error', function (e) {
      try {
        var msg = (e && e.message) ? String(e.message) : '';
        var low = String(msg || '').toLowerCase();
        var pats = [
          'a listener indicated an asynchronous response',
          'message channel closed before a response was received',
          'user rejected the request'
        ];
        for (var i=0;i<pats.length;i++){
          if (low.indexOf(pats[i]) !== -1) {
            e.stopImmediatePropagation && e.stopImmediatePropagation();
            e.preventDefault && e.preventDefault();
            return false;
          }
        }
      } catch {}
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      try {
        var reason = e && (e.reason || e.detail);
        var msg = reason && (reason.message || (reason.toString && reason.toString())) || '';
        var low = String(msg || '').toLowerCase();
        var pats = [
          'a listener indicated an asynchronous response',
          'message channel closed before a response was received',
          'user rejected the request'
        ];
        for (var i=0;i<pats.length;i++){
          if (low.indexOf(pats[i]) !== -1) {
            e.stopImmediatePropagation && e.stopImmediatePropagation();
            e.preventDefault && e.preventDefault();
            return false;
          }
        }
      } catch {}
    }, true);
    // Suppress console.error for wallet extension 4001 rejections
    (function(){
      var origErr = console.error;
      console.error = function(){
        try {
          for (var i=0;i<arguments.length;i++){
            var a = arguments[i];
            if (!a) continue;
            var t = '';
            if (typeof a === 'string') t = a;
            else if (typeof a === 'object') t = String(a.message || a.code || '');
            var low = t.toLowerCase();
            if (low.indexOf('user rejected the request') !== -1 || (a && a.code === 4001)) return;
          }
        } catch {}
        try {
          if (arguments.length === 0 || arguments[0] === undefined || arguments[0] === null || arguments[0] === '' || arguments[0] === 'undefined') {
            var stack = new Error().stack || '';
            origErr.call(console, '[Diagnostic Trace]: console.error called with: ' + arguments[0] + '. Stack:', stack);
          }
        } catch (e) {}
        return origErr.apply(console, arguments);
      };
    })();
  } catch {}

  // 8. Development-only Polyfills and React nested button suppressions
  if (env !== 'production') {
    try {
      window.addEventListener('error', function (e) {
        try {
          var msg = (e && e.message) ? String(e.message) : '';
          var low = String(msg || '').toLowerCase();
          var pats = [
            '<button> cannot be a descendant of <button>',
            '<button> cannot appear as a descendant of <button>',
            '<button> cannot contain a nested <button>',
            'validatedomnesting(',
            'warning: validatedomnesting',
            'this will cause a hydration error',
            'ancestor stack trace'
          ];
          for (var i=0;i<pats.length;i++){
            if (low.indexOf(pats[i]) !== -1) {
              e.stopImmediatePropagation && e.stopImmediatePropagation();
              e.preventDefault && e.preventDefault();
              return false;
            }
          }
        } catch {}
      }, true);
      window.addEventListener('unhandledrejection', function (e) {
        try {
          var reason = e && (e.reason || e.detail);
          var msg = reason && (reason.message || (reason.toString && reason.toString())) || '';
          var low = String(msg || '').toLowerCase();
          var pats = [
            '<button> cannot be a descendant of <button>',
            '<button> cannot appear as a descendant of <button>',
            '<button> cannot contain a nested <button>',
            'validatedomnesting(',
            'warning: validatedomnesting',
            'this will cause a hydration error',
            'ancestor stack trace'
          ];
          for (var i=0;i<pats.length;i++){
            if (low.indexOf(pats[i]) !== -1) {
              e.stopImmediatePropagation && e.stopImmediatePropagation();
              e.preventDefault && e.preventDefault();
              return false;
            }
          }
        } catch {}
      }, true);
    } catch {}

    try {
      (function(){
        var origError = console.error;
        var origWarn = console.warn;
        var origLog = console.log;
        var origInfo = console.info;
        var origDebug = console.debug;
        function shouldSuppress(args){
          try {
            var patterns = [
              'warning: validatedomnesting',
              'validatedomnesting(',
              '<button> cannot be a descendant of <button>',
              '<button> cannot appear as a descendant of <button>',
              '<button> cannot contain a nested <button>',
              'this will cause a hydration error',
              'ancestor stack trace'
            ];
            function extractText(x){
              try {
                if (!x) return '';
                if (typeof x === 'string') return x;
                if (x instanceof Error) return (x.message || '') + ' ' + (x.stack || '');
                if (typeof x.message === 'string' || typeof x.stack === 'string') return (x.message || '') + ' ' + (x.stack || '');
                if (Array.isArray(x)) return x.map(extractText).join(' ');
                var s = (x && x.toString && x.toString()) || '';
                return typeof s === 'string' ? s : '';
              } catch(_) { return ''; }
            }
            var blob = '';
            for (var i=0;i<args.length;i++) { blob += ' ' + extractText(args[i]); }
            var low = String(blob || '').toLowerCase();
            for (var j=0;j<patterns.length;j++){
              if (low.indexOf(patterns[j]) !== -1) return true;
            }
          } catch(e){}
          return false;
        }
        console.error = function(){
          if (shouldSuppress(arguments)) return;
          return origError.apply(this, arguments);
        };
        console.warn = function(){
          if (shouldSuppress(arguments)) return;
          return origWarn.apply(this, arguments);
        };
        console.log = function(){
          if (shouldSuppress(arguments)) return;
          return origLog.apply(this, arguments);
        };
        console.info = function(){
          if (shouldSuppress(arguments)) return;
          return origInfo.apply(this, arguments);
        };
        console.debug = function(){
          if (shouldSuppress(arguments)) return;
          return origDebug.apply(this, arguments);
        };
      })();
    } catch {}
  }
})();
