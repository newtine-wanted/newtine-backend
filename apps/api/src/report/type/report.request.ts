import type { tags } from 'typia';
export type ReportUuid = string &
  tags.Pattern<'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'>;
export interface ReportRequest {
  periodStart: string & tags.Pattern<'^\\d{4}-\\d{2}-\\d{2}$'>;
}
