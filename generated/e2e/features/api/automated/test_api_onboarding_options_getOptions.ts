import typia from "typia";

import type { OnboardingOptionsResult } from "../../../../../apps/api/src/onboarding/type/onboarding.output";
import api from "../../../../api";

export const test_api_onboarding_options_getOptions = async (
  connection: api.IConnection,
) => {
  const output: OnboardingOptionsResult =
    await api.functional.onboarding.options.getOptions(connection);
  typia.assert(output);
};
