// TLG R(AI)nmaker funnel v2: fade-up reveals and the floating apply button. No pulse, no timers.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fade sections up once on entry. Elements in a [data-stagger] group get an 80ms step.
  var groups = document.querySelectorAll('[data-stagger]');
  Array.prototype.forEach.call(groups, function (g) {
    Array.prototype.forEach.call(g.children, function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = (i * 80) + 'ms';
    });
  });
  var targets = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(targets, function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
  }

  // Floating CTA: shows once the hero is out of view, hides while the closing CTA is on screen.
  var cta = document.querySelector('.float-cta');
  var hero = document.querySelector('[data-hero]');
  var closing = document.querySelector('[data-closing]');
  if (cta && hero && 'IntersectionObserver' in window) {
    var heroVisible = true, closingVisible = false;
    var update = function () { cta.classList.toggle('show', !heroVisible && !closingVisible); };
    new IntersectionObserver(function (e) { heroVisible = e[0].isIntersecting; update(); }).observe(hero);
    if (closing) new IntersectionObserver(function (e) { closingVisible = e[0].isIntersecting; update(); }).observe(closing);
  }
})();
