// Pozvánka do Watch Party; dříve inline v party.html, kvůli CSP script-src 'self' (WEB-N30).
'use strict';
const match = /^\/party\/([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})$/.exec(location.pathname);
if (!match) {
  document.querySelector('main').textContent = 'Pozvánka nemá platný kód.';
} else {
  const code = match[1];
  document.getElementById('code').textContent = code;
  document.getElementById('open').href = `movly://party/${code}`;
}

