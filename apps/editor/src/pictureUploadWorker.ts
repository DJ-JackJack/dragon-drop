/// <reference lib="webworker" />
// Sends one reference picture (up to 30 MB) to the server on a thread of its own, so the main thread never holds up the editor while
// it goes. The server checks the picture again and answers the name it was kept as, or a message for the person.
self.onmessage = async (e: MessageEvent<{ url: string; file: Blob; name: string }>) => {
  const { url, file, name } = e.data;
  try {
    const res = await fetch(url, { method: "POST", body: file, headers: { "x-file-name": encodeURIComponent(name), "content-type": file.type || "application/octet-stream" } });
    if (res.ok) self.postMessage({ ok: true, name: ((await res.json()) as { name: string }).name });
    else self.postMessage({ ok: false, message: (await res.text()) || `"${name}" couldn't be added (the server answered ${res.status}).` });
  } catch {
    self.postMessage({ ok: false, message: `"${name}" couldn't be added: Dragon Drop's server didn't answer.` });
  }
  self.close();
};
