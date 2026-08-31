import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';

// Panel IIFEs externalize these packages and read the matching globals.
Object.assign(globalThis, {
  React,
  ReactDOM,
  ReactDOMClient,
  JSXRuntime,
  JSXDevRuntime
});
