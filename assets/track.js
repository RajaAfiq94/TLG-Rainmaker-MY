// Meta Pixel loader. Does nothing until the meta-pixel-id tag holds a real numeric Pixel ID.
// Also hides any link whose href is still an unfilled {{PLACEHOLDER}}, so no broken links go live.
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('a[href*="{{"]'), function (a) {
    a.style.display = 'none';
    a.setAttribute('aria-hidden', 'true');
  });

  var tag = document.querySelector('meta[name="meta-pixel-id"]');
  var id = tag && tag.content;
  window.tlgTrack = function () {}; // safe no-op until a Pixel ID is set
  if (!id || !/^\d+$/.test(id)) return;

  /* Standard Meta Pixel base code */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', id);
  fbq('track', 'PageView');

  var standard = { Lead: 1, Schedule: 1, ViewContent: 1 };
  // No personal data is sent: only the event name and the application route.
  window.tlgTrack = function (name, params) {
    if (standard[name]) fbq('track', name, params || {});
    else fbq('trackCustom', name, params || {});
  };
})();
