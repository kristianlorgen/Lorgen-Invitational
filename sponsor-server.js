'use strict';

const fs = require('fs');
const path = require('path');
const expressPath = require.resolve('express');
const express = require(expressPath);
const originalExpress = express;

const SPONSOR_SCRIPT = '<script src="/js/sponsor-ads.js?v=sponsor-admin-20260603" defer></script>';
const INJECT_PATHS = new Set(['/', '/index.html', '/scoreboard', '/scoreboard.html', '/enter-score', '/enter-score.html', '/admin', '/admin.html']);

function injectSponsorScript(html) {
  if (html.includes('/js/sponsor-ads.js')) return html;
  return html.replace(/<\/body>/i, `${SPONSOR_SCRIPT}\n</body>`);
}

function sendInjectedFile(res, filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(injectSponsorScript(html));
}

function wrappedExpress(...args) {
  const app = originalExpress(...args);

  app.use((req, res, next) => {
    if (INJECT_PATHS.has(req.path)) {
      const clean = req.path === '/' ? 'index' : req.path.replace(/^\//, '').replace(/\.html$/, '');
      const filePath = path.join(__dirname, 'public', `${clean}.html`);
      if (fs.existsSync(filePath)) return sendInjectedFile(res, filePath);
    }

    const originalSendFile = res.sendFile.bind(res);
    res.sendFile = (filePath, ...sendArgs) => {
      if (typeof filePath === 'string' && filePath.endsWith('.html') && INJECT_PATHS.has(req.path) && fs.existsSync(filePath)) {
        return sendInjectedFile(res, filePath);
      }
      return originalSendFile(filePath, ...sendArgs);
    };
    next();
  });

  const originalListen = app.listen.bind(app);
  let sponsorRoutesAttached = false;

  app.listen = (...listenArgs) => {
    if (!sponsorRoutesAttached) {
      sponsorRoutesAttached = true;
      require('./sponsor-routes')(app);
    }
    return originalListen(...listenArgs);
  };

  return app;
}

Object.assign(wrappedExpress, originalExpress);
require.cache[expressPath].exports = wrappedExpress;
require('./server');