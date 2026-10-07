class ChordScopes {
  constructor() {
    this.byOwner = new Map();
  }

  get(owner) {
    return this.byOwner.get(owner) ?? [];
  }

  setOwner(owner, chords) {
    const next = onlyStrings(chords);
    const previous = this.get(owner);
    if (same(previous, next)) return false;
    if (next.length === 0) this.byOwner.delete(owner);
    else this.byOwner.set(owner, next);
    return true;
  }

  forget(owner) {
    return this.byOwner.delete(owner);
  }

  of(owners) {
    const chords = [];
    for (const chord of owners.flatMap((owner) => this.get(owner))) {
      if (!chords.includes(chord)) chords.push(chord);
    }
    return chords;
  }
}

function onlyStrings(chords) {
  return Array.isArray(chords) ? chords.filter((chord) => typeof chord === "string") : [];
}

function same(a, b) {
  return a.length === b.length && a.every((chord, at) => chord === b[at]);
}

module.exports = { ChordScopes };
