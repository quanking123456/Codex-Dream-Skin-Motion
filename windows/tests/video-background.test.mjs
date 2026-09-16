import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  attachBlobVideoToSession,
  loadPayload,
  loadTheme,
  planSessionPayloadApplication,
} from "../scripts/injector.mjs";
import { MAX_VIDEO_BYTES } from "../scripts/media-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, "../assets");

function mp4Fixture(marker = "AAAA") {
  const fileTypeBox = Buffer.alloc(24);
  fileTypeBox.writeUInt32BE(fileTypeBox.length, 0);
  fileTypeBox.write("ftyp", 4, "ascii");
  fileTypeBox.write("isom", 8, "ascii");
  fileTypeBox.writeUInt32BE(512, 12);
  fileTypeBox.write("isom", 16, "ascii");
  fileTypeBox.write("mp41", 20, "ascii");
  return Buffer.concat([fileTypeBox, Buffer.from(marker, "ascii")]);
}

async function makeTheme(video = "background.mp4") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dream-skin-video-theme-"));
  await fs.copyFile(
    path.join(assets, "dream-reference.jpg"),
    path.join(root, "dream-reference.jpg"),
  );
  await fs.writeFile(path.join(root, "theme.json"), JSON.stringify({
    schemaVersion: 1,
    id: "video-fixture",
    name: "Video fixture",
    image: "dream-reference.jpg",
    video,
    appearance: "auto",
  }));
  return root;
}

test("Windows theme loading validates and exposes a managed MP4", async () => {
  const root = await makeTheme();
  try {
    await fs.writeFile(path.join(root, "background.mp4"), mp4Fixture());
    const loaded = await loadTheme(root);
    assert.equal(loaded.theme.video, "background.mp4");
    assert.equal(loaded.videoPath, await fs.realpath(path.join(root, "background.mp4")));
    assert.match(loaded.sourceStamp, /:\d+(?:\.\d+)?:\d+(?:\.\d+)?:none$/);

    const payload = await loadPayload(root, loaded, { mode: "blob" });
    assert.equal(payload.videoTransport.mode, "blob");
    assert.equal(payload.videoPath, loaded.videoPath);
    assert.doesNotMatch(payload.payload, /__DREAM_SKIN_[A-Z0-9_]+_JSON__/);
    assert.doesNotThrow(() => new Function(payload.payload));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("invalid containers and nested video paths fail closed", async () => {
  const invalid = await makeTheme();
  const nested = await makeTheme("nested/background.mp4");
  try {
    await fs.writeFile(path.join(invalid, "background.mp4"), Buffer.from("not an mp4"));
    await assert.rejects(loadTheme(invalid), /valid MP4 container/);

    await fs.mkdir(path.join(nested, "nested"));
    await fs.writeFile(path.join(nested, "nested", "background.mp4"), mp4Fixture());
    await assert.rejects(loadTheme(nested), /invalid video field/);
  } finally {
    await Promise.all([
      fs.rm(invalid, { recursive: true, force: true }),
      fs.rm(nested, { recursive: true, force: true }),
    ]);
  }
});

test("the local picker limit accommodates the supplied 382 MiB video", () => {
  assert.equal(MAX_VIDEO_BYTES, 512 * 1024 * 1024);
  assert.ok(MAX_VIDEO_BYTES > 400_836_772);
});

test("video identity participates in the renderer payload revision", async () => {
  const root = await makeTheme();
  const videoPath = path.join(root, "background.mp4");
  try {
    await fs.writeFile(videoPath, mp4Fixture("AAAA"));
    const first = await loadPayload(root, await loadTheme(root), { mode: "blob" });
    const changedTime = new Date(Date.now() + 5000);
    await fs.writeFile(videoPath, mp4Fixture("BBBB"));
    await fs.utimes(videoPath, changedTime, changedTime);
    const second = await loadPayload(root, await loadTheme(root), { mode: "blob" });
    assert.notEqual(first.videoIdentity, second.videoIdentity);
    assert.notEqual(first.revision, second.revision);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("session application is idempotent for an already healthy video", () => {
  const loaded = {
    revision: "same-revision",
    theme: { id: "video-fixture" },
    videoPath: "C:\\managed\\background.mp4",
    videoTransport: { mode: "blob" },
  };
  assert.deepEqual(planSessionPayloadApplication({
    revision: "same-revision",
    themeId: "video-fixture",
    videoMode: "blob",
    videoReady: true,
    videoFailed: false,
  }, loaded), { evaluatePayload: false, attachVideo: false });
  assert.deepEqual(planSessionPayloadApplication({
    revision: "same-revision",
    themeId: "video-fixture",
    videoMode: "blob",
    videoReady: false,
    videoFailed: false,
  }, loaded), { evaluatePayload: false, attachVideo: true });
  assert.deepEqual(planSessionPayloadApplication({
    revision: "same-revision",
    themeId: "video-fixture",
    videoMode: "blob",
    videoReady: true,
    videoFailed: true,
  }, loaded), { evaluatePayload: true, attachVideo: true });
  assert.deepEqual(planSessionPayloadApplication({
    revision: "old-revision",
    themeId: "video-fixture",
    videoMode: "blob",
    videoReady: true,
    videoFailed: false,
  }, loaded), { evaluatePayload: true, attachVideo: true });
});

test("blob attachment awaits the async renderer result and mounts the file once", async () => {
  const evaluations = [];
  const commands = [];
  const session = {
    async evaluate(expression) {
      evaluations.push(expression);
      if (expression.includes("ensureVideoInput")) return true;
      if (expression.includes("Promise.resolve") && expression.includes("attachVideoFile")) return true;
      if (expression.includes("videoFailed")) return false;
      throw new Error(`Unexpected evaluation: ${expression}`);
    },
    async send(method, params = {}) {
      commands.push({ method, params });
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelector") return { nodeId: 2 };
      return {};
    },
  };
  const attached = await attachBlobVideoToSession(session, {
    videoTransport: { mode: "blob" },
    videoPath: "C:\\managed\\background.mp4",
  });
  assert.equal(attached, true);
  assert.equal(commands.filter(({ method }) => method === "DOM.setFileInputFiles").length, 1);
  assert.equal(evaluations.filter((expression) => expression.includes("attachVideoFile")).length, 1);
  assert.match(evaluations.find((expression) => expression.includes("attachVideoFile")),
    /Promise\.resolve/);
});
