import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanTranscript } from "../src/main/voice/stt";

describe("cleanTranscript", () => {
  it("strips whisper non-speech annotations", () => {
    assert.equal(cleanTranscript("[BLANK_AUDIO]"), "");
    assert.equal(cleanTranscript(" (clock ticking) hello there "), "hello there");
    assert.equal(cleanTranscript("♪♪ [MUSIC] ♪"), "");
    assert.equal(cleanTranscript("open [NOISE] the door"), "open the door");
  });

  it("collapses whitespace but keeps real speech intact", () => {
    assert.equal(cleanTranscript("  What's   the\nweather? "), "What's the weather?");
    assert.equal(cleanTranscript("Set a timer for 5 minutes."), "Set a timer for 5 minutes.");
  });
});
