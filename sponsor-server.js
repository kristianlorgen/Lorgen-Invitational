'use strict';

const expressPath = require.resolve('express');
const express = require(expressPath);
const originalExpress = express;

function wrappedExpress(...args) {
  const app = originalExpress(...args);
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
