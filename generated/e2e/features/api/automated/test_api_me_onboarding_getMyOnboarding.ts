import typia from "typia";

import type { OnboardingStateResult } from "../../../../../apps/api/src/onboarding/type/onboarding.output";
import api from "../../../../api";

export const test_api_me_onboarding_getMyOnboarding = async (
  connection: api.IConnection,
) => {
  const output: OnboardingStateResult =
    await api.functional.me.onboarding.getMyOnboarding(connection);
  typia.assert(output);
};
