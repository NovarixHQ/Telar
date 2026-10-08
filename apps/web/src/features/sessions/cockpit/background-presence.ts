import { countsAsActivity, isBackgroundWork, type Task } from "@telar/engine-client";

type BannerTask = Pick<Task, "id" | "kind" | "backgrounded" | "state" | "ambient">;

/** The tasks the banner counts — the same predicates the cockpit uses. */
export function stillWorking<T extends BannerTask>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => isBackgroundWork(task) && countsAsActivity(task));
}
