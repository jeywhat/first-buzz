import { describe, expect, it } from "vitest";
import { extractVideoId } from "./youtube";

describe("extractVideoId", () => {
  it("parses standard watch URLs", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("parses watch URLs with extra parameters in any order", () => {
    expect(
      extractVideoId(
        "https://www.youtube.com/watch?t=120&v=dQw4w9WgXcQ&list=PL0123456789ab&si=xyz",
      ),
    ).toBe("dQw4w9WgXcQ");
  });

  it("parses youtu.be short links with parameters", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe("dQw4w9WgXcQ");
  });

  it("parses embed URLs", () => {
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ?start=30")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("parses shorts and live URLs", () => {
    expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("accepts mobile, music and nocookie hosts", () => {
    expect(extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("accepts http and scheme-less tolerance is NOT provided", () => {
    expect(extractVideoId("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("accepts a bare 11-character video id", () => {
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects non-YouTube hosts", () => {
    expect(extractVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractVideoId("https://youtu.be.fake/dQw4w9WgXcQ")).toBeNull();
  });

  it("rejects malformed or missing ids", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQXYZ")).toBeNull();
    expect(extractVideoId("https://www.youtube.com/embed/")).toBeNull();
    expect(extractVideoId("https://www.youtube.com/watch?list=PL123")).toBeNull();
  });

  it("rejects empty, random and non-URL input", () => {
    expect(extractVideoId("")).toBeNull();
    expect(extractVideoId("   ")).toBeNull();
    expect(extractVideoId("not a url")).toBeNull();
    expect(extractVideoId("javascript:alert(1)")).toBeNull();
    expect(extractVideoId("ftp://youtu.be/dQw4w9WgXcQ")).toBeNull();
  });
});
