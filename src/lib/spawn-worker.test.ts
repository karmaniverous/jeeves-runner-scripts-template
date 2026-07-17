import { describe, expect, it } from 'vitest';

import {
  getTokensFromTranscript,
  isSessionCompleted,
  parseArgs,
  parseResultLine,
} from './spawn-worker.js';

describe('parseArgs', () => {
  it('parses --key=value pairs', () => {
    const result = parseArgs(['--job-id=abc123', '--label=test']);
    expect(result).toEqual({
      'job-id': 'abc123',
      label: 'test',
    });
  });

  it('ignores non-flag arguments', () => {
    const result = parseArgs(['positional', '--key=val', 'another']);
    expect(result).toEqual({ key: 'val' });
  });

  it('handles empty value', () => {
    const result = parseArgs(['--key=']);
    expect(result).toEqual({ key: '' });
  });

  it('handles value with equals sign', () => {
    const result = parseArgs(['--key=a=b']);
    expect(result).toEqual({ key: 'a=b' });
  });

  it('returns empty object for no args', () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe('isSessionCompleted', () => {
  it('returns false for empty messages', () => {
    expect(isSessionCompleted([])).toEqual({ completed: false });
  });

  it('returns true when assistant has terminal stopReason', () => {
    const messages = [{ role: 'assistant', stopReason: 'endTurn' }];
    expect(isSessionCompleted(messages)).toEqual({ completed: true });
  });

  it('returns false when assistant stopReason is toolUse', () => {
    const messages = [{ role: 'assistant', stopReason: 'toolUse' }];
    expect(isSessionCompleted(messages)).toEqual({ completed: false });
  });

  it('returns false when assistant stopReason is error', () => {
    const messages = [{ role: 'assistant', stopReason: 'error' }];
    expect(isSessionCompleted(messages)).toEqual({ completed: false });
  });

  it('detects stale toolResult as completed', () => {
    const now = Date.now();
    const messages = [{ role: 'toolResult', timestamp: now - 120_000 }];
    expect(isSessionCompleted(messages, now, 60_000)).toEqual({
      completed: true,
    });
  });

  it('does not treat fresh toolResult as completed', () => {
    const now = Date.now();
    const messages = [{ role: 'toolResult', timestamp: now - 10_000 }];
    expect(isSessionCompleted(messages, now, 60_000)).toEqual({
      completed: false,
    });
  });

  it('handles toolResult without timestamp', () => {
    const messages = [{ role: 'toolResult' }];
    expect(isSessionCompleted(messages)).toEqual({ completed: false });
  });

  it('returns false for user message', () => {
    const messages = [{ role: 'user' }];
    expect(isSessionCompleted(messages)).toEqual({ completed: false });
  });
});

describe('parseResultLine', () => {
  it('parses valid WORKER_RESULT line', () => {
    const line =
      'WORKER_RESULT:{"sessionKey":"abc","tokens":100,"durationMs":5000}';
    expect(parseResultLine(line)).toEqual({
      sessionKey: 'abc',
      tokens: 100,
      durationMs: 5000,
    });
  });

  it('parses line with model', () => {
    const line =
      'WORKER_RESULT:{"sessionKey":"abc","tokens":100,"durationMs":5000,"model":"claude-3"}';
    expect(parseResultLine(line)).toEqual({
      sessionKey: 'abc',
      tokens: 100,
      durationMs: 5000,
      model: 'claude-3',
    });
  });

  it('returns null for non-WORKER_RESULT line', () => {
    expect(parseResultLine('some log line')).toBeNull();
  });

  it('returns null for invalid JSON after prefix', () => {
    expect(parseResultLine('WORKER_RESULT:{broken')).toBeNull();
  });

  it('returns null for JSON missing required fields', () => {
    expect(parseResultLine('WORKER_RESULT:{"foo":"bar"}')).toBeNull();
  });
});

describe('getTokensFromTranscript', () => {
  it('returns 0 for non-existent file', () => {
    expect(getTokensFromTranscript('/nonexistent/path.jsonl')).toBe(0);
  });
});
