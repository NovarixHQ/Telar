"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SOUNDS = { finished: "telar-felt-done", blocked: "telar-felt-needs", failed: "telar-felt-error" };
const SOUND_FILES = Object.values(SOUNDS).map((name) => `${name}.caf`);
const DEV_SOUNDS = path.join(__dirname, "..", "..", "..", "web", "public", "sounds");

function unchanged(file, bytes) {
  try {
    return fs.readFileSync(file).equals(bytes);
  } catch {
    return false;
  }
}

function installSounds({ from, home, log = () => {} }) {
  const to = path.join(home, "Library", "Sounds");
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const file of fs.readdirSync(from)) {
      if (!SOUND_FILES.includes(file)) continue;
      try {
        const bytes = fs.readFileSync(path.join(from, file));
        const target = path.join(to, file);
        if (unchanged(target, bytes)) continue;
        const temp = path.join(to, `.${file}.${process.pid}.tmp`);
        fs.writeFileSync(temp, bytes);
        fs.renameSync(temp, target);
      } catch (error) {
        log(`installing ${file} into ${to} failed: ${error?.message || error}`);
      }
    }
  } catch (error) {
    log(`installing notification sounds into ${to} failed: ${error?.message || error}`);
  }
}

function createChime({ packaged, dir = DEV_SOUNDS, play = (file) => execFile("afplay", [file], () => {}) }) {
  return {
    install(locations) {
      if (packaged) installSounds(locations);
    },
    options: (kind) => (packaged && SOUNDS[kind] ? { sound: `${SOUNDS[kind]}.caf` } : { silent: true }),
    shown(kind) {
      if (!packaged && SOUNDS[kind]) play(path.join(dir, `${SOUNDS[kind]}.wav`));
    },
  };
}

module.exports = { SOUNDS, SOUND_FILES, DEV_SOUNDS, createChime };
