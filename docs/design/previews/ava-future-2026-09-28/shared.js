/* AVA · Future previews: shared backdrop and helpers. Classic script so pages also open from disk. */
(function () {
  "use strict";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.AVAF = {
    reduced: reduced,
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, reduced ? 0 : ms); }); },
    /** Types text into an element, character by character (instant under reduced motion). */
    type: async function (el, text, speed) {
      if (reduced) { el.textContent = text; return; }
      el.textContent = "";
      for (var i = 0; i < text.length; i++) {
        el.textContent += text[i];
        await new Promise(function (r) { setTimeout(r, speed || 16); });
      }
    },
    esc: function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); },
  };

  // Nocturne starfield: three depths, gentle drift, the odd shooting star.
  function starfield() {
    var canvas = document.getElementById("stars");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var stars = [], shooting = null, w = 0, h = 0;
    function resize() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var count = w < 700 ? 220 : 520;
      stars = [];
      for (var i = 0; i < count; i++) {
        var depth = Math.random();
        stars.push({ x: Math.random() * w, y: Math.random() * h, r: 0.3 + depth * 1.3, d: depth, tw: Math.random() * Math.PI * 2 });
      }
    }
    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (!reduced) { s.x -= 0.03 + s.d * 0.16; if (s.x < -2) { s.x = w + 2; s.y = Math.random() * h; } }
        var a = 0.35 + 0.5 * s.d + (reduced ? 0 : 0.18 * Math.sin(t / 900 + s.tw));
        ctx.fillStyle = "rgba(225,232,255," + Math.max(0.08, Math.min(1, a)) + ")";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduced) {
        if (!shooting && Math.random() < 0.004) shooting = { x: Math.random() * w * 0.8 + w * 0.2, y: Math.random() * h * 0.4, life: 1 };
        if (shooting) {
          var g = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x + 90, shooting.y - 30);
          g.addColorStop(0, "rgba(255,255,255," + shooting.life + ")"); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x + 90, shooting.y - 30); ctx.stroke();
          shooting.x -= 7; shooting.y += 2.4; shooting.life -= 0.02;
          if (shooting.life <= 0) shooting = null;
        }
        requestAnimationFrame(frame);
      }
    }
    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", starfield); else starfield();
})();
