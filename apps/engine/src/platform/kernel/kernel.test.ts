import { expect, test } from "bun:test";
import { editSessionDocument } from "../../../test/store-internals";
import { useTempStores } from "../../../test/temp-store";

const { readyStore } = useTempStores();

test("a v1 document names the version break instead of reading as corruption", () => {
  const { store } = readyStore();
  editSessionDocument(store, "queue.json", (queue) => { queue.version = 1; });
  // A bare schema failure here would read as disk corruption and send an
  // operator looking in the wrong place.
  expect(() => store.queries.turns("session_one")).toThrow(/protocol v1/);
});
