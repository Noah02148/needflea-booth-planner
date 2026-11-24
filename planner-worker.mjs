import './vendor/polygon-clipping/polygon-clipping.umd.min.js';
import { searchDrafts } from './local-drafts.mjs';

self.onmessage = ({ data }) => {
  try {
    searchDrafts(data, (result) => self.postMessage(result));
  } catch (error) {
    self.postMessage({ done: true, error: error.message });
  }
};
