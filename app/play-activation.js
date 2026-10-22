/* Shared by the browser and the ES5 TV client. Hold consumes the matching click. */
(function (root) {
  "use strict";
  var heldKey = null, releaseHeldKey = null;
  function activationKey(event) {
    var key = event.key || event.keyCode;
    return key === "Enter" || key === 13 ? "Enter" : key === " " || key === 32 ? "Space" : null;
  }
  function clearHeldKey() {
    heldKey = null;
    var release = releaseHeldKey; releaseHeldKey = null;
    if (release) release();
  }
  // The picker can move focus while OK is still held. Consume repeats/release
  // before they reach the newly focused source or the TV document key handler.
  document.addEventListener("keydown", function (event) {
    if (heldKey && activationKey(event) === heldKey) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("keyup", function (event) {
    if (heldKey && activationKey(event) === heldKey) {
      clearHeldKey(); event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  root.addEventListener("blur", clearHeldKey);
  function attachPlayChoice(button, choose, label) {
    var timer = null, held = false, keyActive = false, pointerActive = false;
    var origin = null, menu = null, activeKey = null;
    function chooseFromKeyboard() {
      heldKey = activeKey;
      releaseHeldKey = function () { keyActive = false; held = false; cancel(); };
      choose();
    }
    function cancel() { if (timer !== null) clearTimeout(timer); timer = null; pointerActive = false; }
    function begin() {
      cancel(); held = false;
      timer = setTimeout(function () {
        timer = null;
        if (!document.documentElement.contains(button) || button.disabled) return;
        held = true;
        if (keyActive) chooseFromKeyboard(); else choose();
      }, 650);
    }
    function closeMenu(restore) {
      if (menu) { menu.parentNode.removeChild(menu); menu = null; }
      if (restore && document.documentElement.contains(button)) button.focus();
    }
    function openMenu(event) {
      event.preventDefault(); cancel();
      if (held || button.disabled) return;
      closeMenu(false);
      menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.className = "popover play-choice-menu";
      var item = document.createElement("button");
      item.type = "button"; item.className = "button secondary";
      item.setAttribute("role", "menuitem"); item.textContent = label;
      item.addEventListener("click", function () { closeMenu(false); choose(); });
      menu.appendChild(item);
      // A modal dialog makes nodes outside it inert, including a body-level menu.
      var host = button.parentNode;
      while (host && host.tagName !== "DIALOG") host = host.parentNode;
      (host || document.body).appendChild(menu);
      var bounds = button.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(event.clientX || bounds.left, root.innerWidth - menu.offsetWidth - 8)) + "px";
      menu.style.top = Math.max(8, Math.min(event.clientY || bounds.bottom, root.innerHeight - menu.offsetHeight - 8)) + "px";
      menu.addEventListener("keydown", function (e) { if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeMenu(true); } });
      menu.addEventListener("focusout", function () { setTimeout(function () { if (menu && !menu.contains(document.activeElement)) closeMenu(false); }, 0); });
      item.focus();
    }
    button.title = label + " · Shift+Enter";
    button.setAttribute("aria-keyshortcuts", "Shift+Enter");
    button.style.touchAction = "manipulation";
    button.style.webkitUserSelect = "none";
    button.style.userSelect = "none";
    button.addEventListener("contextmenu", openMenu);
    button.addEventListener("click", function (event) {
      if (held) { held = false; event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    function down(event) {
      if (event.button !== undefined && event.button !== 0) return;
      var point = event.touches ? event.touches[0] : event;
      origin = { x: point.clientX, y: point.clientY };
      begin(); pointerActive = true;
    }
    function move(event) {
      if (!pointerActive) return;
      var point = event.touches ? event.touches[0] : event;
      if (Math.abs(point.clientX - origin.x) > 10 || Math.abs(point.clientY - origin.y) > 10) cancel();
    }
    if (root.PointerEvent) {
      button.addEventListener("pointerdown", down);
      button.addEventListener("pointermove", move);
      button.addEventListener("pointerup", cancel);
      button.addEventListener("pointercancel", cancel);
      button.addEventListener("pointerleave", cancel);
    } else {
      button.addEventListener("mousedown", down);
      button.addEventListener("mousemove", move);
      button.addEventListener("mouseup", cancel);
      button.addEventListener("mouseleave", cancel);
      button.addEventListener("touchstart", down);
      button.addEventListener("touchmove", move);
      button.addEventListener("touchend", cancel);
      button.addEventListener("touchcancel", cancel);
    }
    button.addEventListener("keydown", function (event) {
      var key = event.key || event.keyCode;
      if (event.shiftKey && (key === "F10" || key === 121)) { event.stopPropagation(); openMenu(event); return; }
      if (key !== "Enter" && key !== " " && key !== 13 && key !== 32) return;
      event.preventDefault(); event.stopPropagation();
      if (keyActive) return;
      keyActive = true; activeKey = activationKey(event);
      if (event.shiftKey) { cancel(); held = true; chooseFromKeyboard(); }
      else begin();
    }, true);
    button.addEventListener("keyup", function (event) {
      var key = event.key || event.keyCode;
      if (key !== "Enter" && key !== " " && key !== 13 && key !== 32) return;
      event.preventDefault(); event.stopPropagation();
      var wasActive = keyActive;
      keyActive = false; cancel();
      if (wasActive && !held) button.click();
      held = false;
    }, true);
    button.addEventListener("blur", function () { cancel(); keyActive = false; });
    return function () { cancel(); closeMenu(false); };
  }
  root.attachPlayChoice = attachPlayChoice;
  if (typeof module !== "undefined" && module.exports) module.exports = attachPlayChoice;
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
