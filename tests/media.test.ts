import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_VIDEO_BYTES, isVideoFile, isVideoPath, videoPath, videoProblem } from "@/lib/media";

test("phone videos are accepted up to 50 MB", () => {
  assert.equal(videoProblem({ name: "leak.mov", type: "video/quicktime", size: 20_000_000 }), null);
  assert.equal(videoProblem({ name: "leak.mp4", type: "video/mp4", size: MAX_VIDEO_BYTES }), null);
  assert.match(videoProblem({ name: "long.mp4", type: "video/mp4", size: MAX_VIDEO_BYTES + 1 })!, /larger than 50 MB/);
  assert.match(videoProblem({ name: "clip.avi", type: "video/x-msvideo", size: 10 })!, /MP4, MOV or WebM/);
  assert.match(videoProblem({ name: "empty.mp4", type: "video/mp4", size: 0 })!, /empty/);
});

test("videos sit next to the photos and are told apart by extension", () => {
  const p = videoPath("ticket", "1b4e28ba-2fa1-11d2-883f-0016d3cca427", "IMG 0042 (1).MOV", "video/quicktime", 1700000000000);
  assert.equal(p, "ticket/1b4e28ba-2fa1-11d2-883f-0016d3cca427/1700000000000-IMG-0042-1.mov");
  assert.ok(isVideoPath(p));
  assert.ok(!isVideoPath("ticket/x/1-photo.jpg"));
  assert.ok(isVideoFile({ type: "video/mp4" }));
  assert.ok(!isVideoFile({ type: "image/jpeg" }));
  assert.equal(videoPath("incident", "abc", "", "video/webm", 1), "incident/abc/1-video.webm");
});
