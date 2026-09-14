import typia from "typia";

import type { OnboardingStateResult } from "../../../../../apps/api/src/onboarding/type/onboarding.output";
import type { CompleteOnboardingRequest } from "../../../../../apps/api/src/onboarding/type/onboarding.request";
import api from "../../../../api";

export const test_api_me_onboarding_complete = async (
  connection: api.IConnection,
) => {
  const output: OnboardingStateResult =
    await api.functional.me.onboarding.complete(
      connection,
      typia.random<CompleteOnboardingRequest>(),
    );
  typia.assert(output);
};
