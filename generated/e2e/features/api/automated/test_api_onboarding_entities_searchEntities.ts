import typia from "typia";

import type { OnboardingEntitySearchResult } from "../../../../../apps/api/src/onboarding/type/onboarding.output";
import type { OnboardingEntityQuery } from "../../../../../apps/api/src/onboarding/type/onboarding.request";
import api from "../../../../api";

export const test_api_onboarding_entities_searchEntities = async (
  connection: api.IConnection,
) => {
  const output: OnboardingEntitySearchResult =
    await api.functional.onboarding.entities.searchEntities(
      connection,
      typia.random<OnboardingEntityQuery>(),
    );
  typia.assert(output);
};
