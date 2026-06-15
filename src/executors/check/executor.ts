import type { ExecutorContext } from "@nx/devkit";
import type { BaseCargoOptions } from "../../models/base-options";
import { buildCargoArgs } from "../../utils/build-command";
import { cargoCommand } from "../../utils/cargo";

export interface CheckExecutorSchema extends BaseCargoOptions {
  "all-targets"?: boolean;
  tests?: boolean;
}

const CHECK_KEYS = new Set(["all-targets", "tests"]);

export default async function checkExecutor(
  options: CheckExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args = buildCargoArgs("check", options, context, CHECK_KEYS);
  return cargoCommand(...args);
}
