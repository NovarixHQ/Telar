function createTerminalReaders({ onOrphaned }) {
  const readers = new Map();
  const watched = new WeakSet();

  function release(sender) {
    for (const [id, reader] of readers) {
      if (reader !== sender) continue;
      readers.delete(id);
      onOrphaned(id);
    }
  }

  return {
    attach(id, sender) {
      readers.set(id, sender);
      if (watched.has(sender)) return;
      watched.add(sender);
      sender.once("destroyed", () => release(sender));
    },
    detach(id, sender) {
      if (sender === undefined || readers.get(id) === sender) readers.delete(id);
    },
    reads(id, sender) {
      return readers.get(String(id ?? "")) === sender;
    },
    deliver(id, channel, payload) {
      const reader = readers.get(id);
      if (reader && !reader.isDestroyed()) reader.send(channel, payload);
    },
  };
}

module.exports = { createTerminalReaders };
