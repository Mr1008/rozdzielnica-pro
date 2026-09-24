import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from "./draft-storage";

const schema = z.object({ name: z.string() });

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function throwingStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const fail = () => {
    throw new Error("storage unavailable");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("draft storage", () => {
  it("round-trips a draft under its key and clears it", () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage() });
    writeStoredDraft("device-draft:new", { name: "RCD" });
    expect(readStoredDraft("device-draft:new", schema)).toEqual({ name: "RCD" });
    expect(readStoredDraft("device-draft:other", schema)).toBeNull();
    clearStoredDraft("device-draft:new");
    expect(readStoredDraft("device-draft:new", schema)).toBeNull();
  });

  it("treats a draft that fails the schema or is not JSON as absent", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    storage.setItem("a", JSON.stringify({ name: 7 }));
    storage.setItem("b", "{not json");
    expect(readStoredDraft("a", schema)).toBeNull();
    expect(readStoredDraft("b", schema)).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("window", { sessionStorage: throwingStorage() });
    expect(() => {
      writeStoredDraft("k", { name: "x" });
      clearStoredDraft("k");
    }).not.toThrow();
    expect(readStoredDraft("k", schema)).toBeNull();
  });

  it("never throws without a window at all", () => {
    vi.stubGlobal("window", undefined);
    expect(readStoredDraft("k", schema)).toBeNull();
    expect(() => {
      writeStoredDraft("k", {});
    }).not.toThrow();
  });
});
