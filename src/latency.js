// TCP connect latency. Three tries, median wins. No magic — a plain socket.

import net from "node:net";

function connectOnce(host, port, timeout) {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok ? Math.round(performance.now() - start) : null);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export async function tcpPing(host, port, { timeout = 3000, tries = 3 } = {}) {
  const results = [];
  for (let i = 0; i < tries; i++) {
    results.push(await connectOnce(host, port, timeout));
  }
  const ok = results.filter((r) => r !== null);
  return {
    ms: ok.length ? median(ok) : null,
    loss: Math.round(((tries - ok.length) / tries) * 100),
  };
}

// Small fixed-concurrency pool over an item list.
export async function pool(items, conc, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(conc, items.length)) }, worker),
  );
  return results;
}
