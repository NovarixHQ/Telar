"use client";

import { ArrowUpFromLineIcon, GitPullRequestArrowIcon } from "lucide-react";
import { ActionRow, RowMeta, SplitRow, SplitRowChevron, SplitRowMain } from "@/ui/action-row";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { usePublish, type PublishVerbs } from "../hooks/use-publish";
import { PublishStatus, PullRequestForm, PushConfirm } from "./publish-box";

/** Push and open-a-pull-request as Workspace card rows; each still asks for a second press before it sends. */
export function PublishRows({
  sendPush,
  sendPullRequest,
  github,
  branch,
  ahead,
  commitsSinceBase,
  busy,
  onPublished,
  suggestion,
}: PublishVerbs & {
  github?: boolean;
  branch: string;
  ahead?: number;
  commitsSinceBase: number;
  busy: boolean;
  onPublished: () => void;
  suggestion: string;
}) {
  const publish = usePublish({ sendPush, sendPullRequest, onPublished, suggestion });
  const published = ahead !== undefined;
  const count = published ? ahead : commitsSinceBase;
  const pushable = !busy && (!published || ahead > 0);
  const pullable = github === true && !publish.opened;
  const pushTitle = busy ? "A turn is running — the agent may be mid-write" : !pushable ? "origin has every commit on this branch" : undefined;

  const main = (
    <>
      <ArrowUpFromLineIcon />
      <span className="min-w-0 flex-1 truncate">{published ? "Push" : "Publish branch"}</span>
      {count > 0 && <RowMeta>↑{count}</RowMeta>}
    </>
  );

  return (
    <>
      {pullable ? (
        <SplitRow
          menu={
            <DropdownMenu>
              <DropdownMenuTrigger render={<SplitRowChevron aria-label="More ways to publish" />} />
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem
                  disabled={busy || !published}
                  title={!published ? "Push the branch first — a pull request needs a branch the remote has" : undefined}
                  onClick={publish.armPull}
                >
                  <GitPullRequestArrowIcon />
                  Open pull request
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          <SplitRowMain disabled={!pushable} {...(pushTitle ? { title: pushTitle } : {})} onClick={publish.armPush}>
            {main}
          </SplitRowMain>
        </SplitRow>
      ) : (
        <ActionRow disabled={!pushable} {...(pushTitle ? { title: pushTitle } : {})} onClick={publish.armPush}>
          {main}
        </ActionRow>
      )}
      {(publish.armed || publish.opened || publish.pushProblem || publish.pullProblem) && (
        <div className="px-2.5 py-1.5">
          <PublishStatus publish={publish} />
          {publish.armed === "push" && <PushConfirm publish={publish} branch={branch} count={count} published={published} />}
          {publish.armed === "pull" && <PullRequestForm publish={publish} />}
        </div>
      )}
    </>
  );
}
