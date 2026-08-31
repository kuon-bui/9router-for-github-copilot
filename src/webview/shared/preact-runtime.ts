import * as React from 'preact/compat';
import * as ReactDOM from 'preact/compat';
import * as ReactDOMClient from 'preact/compat/client';
import * as JSXRuntime from 'preact/jsx-runtime';
import * as JSXDevRuntime from 'preact/jsx-dev-runtime';

// Panel IIFEs still import the React package names and read these globals.
Object.assign(globalThis, {
  React,
  ReactDOM,
  ReactDOMClient,
  JSXRuntime,
  JSXDevRuntime
});
