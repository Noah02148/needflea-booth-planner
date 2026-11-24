// Recover drawing units for older portable projects whose conversion dropped the header.
self.onmessage = async ({ data }) => {
  let lib, ptr;
  try {
    importScripts('libredwg-web.umd.js');
    lib = await self['libredwg-web'].LibreDwg.create('.');
    ptr = lib.dwg_read_data(data, 0);
    self.postMessage(ptr ? Number(lib.dwg_dynapi_header_value(ptr, 'INSUNITS').data) : 0);
  } catch {
    self.postMessage(0);
  } finally {
    if (ptr) lib.dwg_free(ptr);
  }
};
