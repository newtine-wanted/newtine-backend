import { generateUuidV7, type UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import { OnboardingException, OnboardingExceptionCode } from './onboarding.exception.js';
import { ONBOARDING_OPTIONS } from './onboarding.options.js';
import {
  EntityType,
  OnboardingStatus,
  type CompleteOnboardingCommand,
  type EntitySearchCommand,
  type EntitySearchResult,
  type OnboardingEntity,
  type OnboardingOptions,
  type OnboardingPreferenceSnapshot,
  type OnboardingRepository,
  type OnboardingStateWithPreferences,
} from './onboarding.model.js';

interface UserRecord {
  readonly userId: UuidV7;
  status: (typeof OnboardingStatus)[keyof typeof OnboardingStatus];
  completedAt: Date | null;
  ageGroup: OnboardingStateWithPreferences['ageGroup'];
  regionCodes: Set<string>;
  topicWeights: Map<string, number>;
  entityWeights: Map<string, number>;
  regionWeights: Map<string, number>;
}

/**
 * Reference adapter used by unit tests. Production wiring uses the PostgreSQL adapter;
 * this implementation intentionally exposes seed helpers for deterministic tests only.
 */
export class InMemoryOnboardingRepository implements OnboardingRepository {
  private readonly users = new Map<string, UserRecord>();
  private readonly entities = new Map<string, OnboardingEntity>();

  constructor(initialEntities: readonly OnboardingEntity[] = []) {
    for (const entity of initialEntities) {
      this.entities.set(entity.id, { ...entity });
    }
  }

  getOptions(): OnboardingOptions {
    return ONBOARDING_OPTIONS;
  }

  searchEntities(command: EntitySearchCommand): EntitySearchResult {
    const query = command.query?.trim().toLocaleLowerCase('ko-KR');
    const filtered = [...this.entities.values()]
      .filter((entity) => entity.isActive)
      .filter((entity) => command.type === undefined || entity.type === command.type)
      .filter(
        (entity) => query === undefined || entity.name.toLocaleLowerCase('ko-KR').startsWith(query),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, 'ko-KR') || left.id.localeCompare(right.id),
      );

    return {
      total: filtered.length,
      items: filtered.slice(command.offset, command.offset + command.limit),
      limit: command.limit,
      offset: command.offset,
    };
  }

  findOnboarding(userId: string): OnboardingStateWithPreferences | undefined {
    const user = this.users.get(userId);
    return user === undefined ? undefined : this.toSnapshot(user);
  }

  completeOnboarding(
    userId: string,
    command: CompleteOnboardingCommand,
  ): OnboardingStateWithPreferences {
    const user = this.requireUser(userId);
    this.validateSelection(command);

    const previousStatus = user.status;
    const previousCompletedAt = user.completedAt;
    user.topicWeights.clear();
    user.entityWeights.clear();
    user.regionWeights.clear();
    user.regionCodes.clear();
    for (const code of command.topicCodes) {
      user.topicWeights.set(code, 2);
    }
    for (const entityId of command.entityIds) {
      user.entityWeights.set(entityId, 2);
    }
    for (const regionCode of command.regionCodes) {
      user.regionCodes.add(regionCode);
      user.regionWeights.set(regionCode, 1);
    }
    user.ageGroup = command.ageGroup;
    user.status = OnboardingStatus.Completed;
    user.completedAt =
      previousStatus === OnboardingStatus.Completed && previousCompletedAt !== null
        ? previousCompletedAt
        : new Date();

    return this.toSnapshot(user);
  }

  skipOnboarding(userId: string): OnboardingStateWithPreferences {
    const user = this.requireUser(userId);
    if (user.status !== OnboardingStatus.Pending) {
      return this.toSnapshot(user);
    }

    user.status = OnboardingStatus.Skipped;
    user.completedAt = null;
    user.ageGroup = null;
    return this.toSnapshot(user);
  }

  seedUser(userId: UuidV7 = generateUuidV7()): UuidV7 {
    if (this.users.has(userId)) return userId;
    this.users.set(userId, {
      userId,
      status: OnboardingStatus.Pending,
      completedAt: null,
      ageGroup: null,
      regionCodes: new Set(),
      topicWeights: new Map(),
      entityWeights: new Map(),
      regionWeights: new Map(),
    });
    return userId;
  }

  seedEntity(input: Omit<OnboardingEntity, 'id'> & { id?: UuidV7 }): UuidV7 {
    const id = input.id ?? generateUuidV7();
    this.entities.set(id, { ...input, id });
    return id;
  }

  private requireUser(userId: string): UserRecord {
    const user = this.users.get(userId);
    if (user === undefined) {
      throw new OnboardingException(
        OnboardingExceptionCode.UserNotFound,
        '인증된 사용자를 찾을 수 없습니다.',
      );
    }
    return user;
  }

  private validateSelection(command: CompleteOnboardingCommand): void {
    const topicCodes = new Set(command.topicCodes);
    const entityIds = new Set(command.entityIds);
    const regionCodes = new Set(command.regionCodes);
    const validTopics = new Set(ONBOARDING_OPTIONS.topics.map((option) => option.code));
    const validAgeGroups = new Set(ONBOARDING_OPTIONS.ageGroups.map((option) => option.code));
    const validRegions = new Set(ONBOARDING_OPTIONS.regions.map((option) => option.code));

    if (
      topicCodes.size !== command.topicCodes.length ||
      topicCodes.size < 1 ||
      topicCodes.size > ONBOARDING_OPTIONS.topics.length ||
      [...topicCodes].some((code) => !validTopics.has(code))
    ) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '관심 주제 선택이 올바르지 않습니다.',
      );
    }
    if (command.ageGroup !== null && !validAgeGroups.has(command.ageGroup)) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '나이대 선택이 올바르지 않습니다.',
      );
    }
    if (
      entityIds.size !== command.entityIds.length ||
      entityIds.size > 100 ||
      [...entityIds].some((id) => {
        const entity = this.entities.get(id);
        return entity === undefined || !entity.isActive;
      })
    ) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '인물·정당·기관 선택이 올바르지 않습니다.',
      );
    }
    if (
      regionCodes.size !== command.regionCodes.length ||
      regionCodes.size > ONBOARDING_OPTIONS.regions.length ||
      [...regionCodes].some((code) => !validRegions.has(code))
    ) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '관심 지역 선택이 올바르지 않습니다.',
      );
    }
  }

  private toSnapshot(user: UserRecord): OnboardingStateWithPreferences {
    const preferences: OnboardingPreferenceSnapshot = {
      topicWeights: Object.fromEntries(user.topicWeights),
      entityWeights: Object.fromEntries(user.entityWeights),
      regionWeights: Object.fromEntries(user.regionWeights),
    };
    return {
      userId: user.userId,
      status: user.status,
      completedAt: user.completedAt === null ? null : new Date(user.completedAt),
      topicCodes: [...user.topicWeights.entries()]
        .filter(([, weight]) => weight > 0)
        .map(([code]) => code as OnboardingStateWithPreferences['topicCodes'][number])
        .sort(compareTopicCodes),
      entityIds: [...user.entityWeights.entries()]
        .filter(([, weight]) => weight > 0)
        .map(([entityId]) => entityId)
        .sort(),
      ageGroup: user.ageGroup,
      regionCodes: [...user.regionCodes].sort(),
      preferences,
    };
  }
}

function compareTopicCodes(
  left: OnboardingStateWithPreferences['topicCodes'][number],
  right: OnboardingStateWithPreferences['topicCodes'][number],
): number {
  const leftOrder = ONBOARDING_OPTIONS.topics.find((option) => option.code === left)?.displayOrder;
  const rightOrder = ONBOARDING_OPTIONS.topics.find(
    (option) => option.code === right,
  )?.displayOrder;
  return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
}

export const DEFAULT_ONBOARDING_ENTITY_FIXTURES: readonly OnboardingEntity[] = [
  {
    id: '0199f000-0000-7000-8000-000000000001' as UuidV7,
    name: '테스트 정당',
    type: EntityType.Party,
    subtitle: '테스트 fixture',
    aliases: [],
    isActive: true,
  },
];
