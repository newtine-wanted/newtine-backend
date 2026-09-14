export const CATEGORY_CODES = [
  'housing',
  'labor',
  'finance',
  'welfare',
  'education',
  'health',
  'climate',
  'security',
  'local',
  'politics',
] as const;

export type CategoryCode = (typeof CATEGORY_CODES)[number];

export interface CategoryCatalogEntry {
  readonly code: CategoryCode;
  readonly displayName: string;
  readonly displayOrder: number;
}

export const CATEGORY_CATALOG = [
  { code: 'housing', displayName: '주거', displayOrder: 1 },
  { code: 'labor', displayName: '일자리', displayOrder: 2 },
  { code: 'finance', displayName: '세금·금융', displayOrder: 3 },
  { code: 'welfare', displayName: '복지·연금', displayOrder: 4 },
  { code: 'education', displayName: '교육', displayOrder: 5 },
  { code: 'health', displayName: '보건·의료', displayOrder: 6 },
  { code: 'climate', displayName: '환경·기후', displayOrder: 7 },
  { code: 'security', displayName: '외교·안보', displayOrder: 8 },
  { code: 'local', displayName: '지역·교통', displayOrder: 9 },
  { code: 'politics', displayName: '정치·사법', displayOrder: 10 },
] as const satisfies readonly CategoryCatalogEntry[];

export function isCategoryCode(value: unknown): value is CategoryCode {
  return typeof value === 'string' && (CATEGORY_CODES as readonly string[]).includes(value);
}
