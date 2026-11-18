/// <reference lib="webworker" />
// Hands freshly built texture noise (80 MB on a 2048 map) to the server to keep, on a thread of its own: uploading a body that size takes
// seconds of whichever thread does it, which must not be the main thread or the one that paints.
self.onmessage = async (e: MessageEvent<{ url: string; buf: ArrayBuffer }>) => {
  try {
    await fetch(e.data.url, { method: "PUT", body: e.data.buf, headers: { "content-type": "application/octet-stream" } });
  } catch { /* it will be worked out again next time */ }
  self.close();
};
