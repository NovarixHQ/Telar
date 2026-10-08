import { describe, expect, test } from "bun:test";
import { CircleDotIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GitHubSnapshot, GitHubUnavailable } from "@telar/engine-client";
import type { GitHubList } from "../hooks/use-github-list";
import { ForgeList } from "./forge-list";

const draw = (unavailable: GitHubUnavailable) => {
  const list = { snapshot: { unavailable } as GitHubSnapshot } as GitHubList;
  return renderToStaticMarkup(<ForgeList kind="issues" label="issues" icon={CircleDotIcon} list={list} openNumbers={[]} onOpen={() => undefined} />);
};

describe("an Issues list gh cannot read", () => {
  test("a repository with no remote says the remote is what is missing", () => {
    const markup = draw("no_remote");
    expect(markup).toContain("This repository has no GitHub remote");
    expect(markup).not.toContain("Not a repository");
  });

  test("only a folder that is not a repository is called one", () => {
    expect(draw("no_repository")).toContain("Not a repository");
  });
});
