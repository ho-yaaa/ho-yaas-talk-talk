import { describe, expect, it } from 'vitest';
import { clearMeetings, listMeetings, saveMeeting } from '../../src/storage/meetings';

describe('meeting storage', () => {
  it('saves and lists meeting records in IndexedDB', async () => {
    await clearMeetings();
    await saveMeeting({
      id: 'meeting-1',
      title: '테스트',
      startedAt: 1,
      endedAt: 2,
      mode: 'earbud',
      languages: ['ko', 'ja'],
      briefing: '일반 미팅',
      entries: [],
      errors: [],
    });
    const meetings = await listMeetings();
    expect(meetings[0]?.id).toBe('meeting-1');
  });
});
