import {
  AgeGroup,
  type OnboardingAgeOption,
  type OnboardingOptions,
  type OnboardingTopicOption,
  type RegionOption,
} from './onboarding.model.js';

export const ONBOARDING_TOPICS: readonly OnboardingTopicOption[] = [
  { code: 'HOUSING', name: '주거', displayOrder: 1 },
  { code: 'LABOR', name: '노동', displayOrder: 2 },
  { code: 'FINANCE_TAX', name: '금융·세제', displayOrder: 3 },
  { code: 'EDUCATION', name: '교육', displayOrder: 4 },
  { code: 'WELFARE', name: '복지', displayOrder: 5 },
  { code: 'DIPLOMACY_SECURITY', name: '외교·안보', displayOrder: 6 },
  { code: 'ENVIRONMENT_ENERGY', name: '환경·에너지', displayOrder: 7 },
  { code: 'LOCAL', name: '지역', displayOrder: 8 },
  { code: 'YOUTH_GENERATION', name: '청년·세대', displayOrder: 9 },
  { code: 'JUDICIARY', name: '사법·검찰', displayOrder: 10 },
  { code: 'ASSEMBLY_PARTY', name: '국회·정당', displayOrder: 11 },
  { code: 'MEDIA', name: '미디어', displayOrder: 12 },
] as const;

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
