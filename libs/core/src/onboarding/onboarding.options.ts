import {
  AgeGroup,
  type OnboardingAgeOption,
  type OnboardingOptions,
  type OnboardingTopicOption,
  type RegionOption,
} from './onboarding.model.js';
import { CATEGORY_CATALOG } from '../common/category/category.catalog.js';

export const ONBOARDING_TOPICS: readonly OnboardingTopicOption[] = CATEGORY_CATALOG.map(
  ({ code, displayName, displayOrder }) => ({
    code,
    name: displayName,
    displayOrder,
  }),
);

export const ONBOARDING_AGE_GROUPS: readonly OnboardingAgeOption[] = [
  { code: AgeGroup.Age19To34, name: '19~34세', displayOrder: 1 },
  { code: AgeGroup.Age35To49, name: '35~49세', displayOrder: 2 },
  { code: AgeGroup.Age50To64, name: '50~64세', displayOrder: 3 },
  { code: AgeGroup.Age65Plus, name: '65세 이상', displayOrder: 4 },
] as const;

export const ONBOARDING_REGIONS: readonly RegionOption[] = [
  { code: 'SEOUL', name: '서울특별시', displayOrder: 1 },
  { code: 'BUSAN', name: '부산광역시', displayOrder: 2 },
  { code: 'DAEGU', name: '대구광역시', displayOrder: 3 },
  { code: 'INCHEON', name: '인천광역시', displayOrder: 4 },
  { code: 'GWANGJU', name: '광주광역시', displayOrder: 5 },
  { code: 'DAEJEON', name: '대전광역시', displayOrder: 6 },
  { code: 'ULSAN', name: '울산광역시', displayOrder: 7 },
  { code: 'SEJONG', name: '세종특별자치시', displayOrder: 8 },
  { code: 'GYEONGGI', name: '경기도', displayOrder: 9 },
  { code: 'GANGWON', name: '강원특별자치도', displayOrder: 10 },
  { code: 'CHUNGBUK', name: '충청북도', displayOrder: 11 },
  { code: 'CHUNGNAM', name: '충청남도', displayOrder: 12 },
  { code: 'JEONBUK', name: '전북특별자치도', displayOrder: 13 },
  { code: 'JEONNAM', name: '전라남도', displayOrder: 14 },
  { code: 'GYEONGBUK', name: '경상북도', displayOrder: 15 },
  { code: 'GYEONGNAM', name: '경상남도', displayOrder: 16 },
  { code: 'JEJU', name: '제주특별자치도', displayOrder: 17 },
] as const;

export const ONBOARDING_OPTIONS: OnboardingOptions = {
  topics: ONBOARDING_TOPICS,
  ageGroups: ONBOARDING_AGE_GROUPS,
  regions: ONBOARDING_REGIONS,
};
